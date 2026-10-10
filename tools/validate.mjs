#!/usr/bin/env node
/**
 * validate.mjs — static integrity checks for the Form 909-WARP single-file app.
 *
 * The project deliberately has no build step, which normally means no compiler
 * standing between a typo and a runtime crash. These checks are the cheap
 * substitute: they catch the class of bug that a single-file, no-bundler app is
 * most exposed to — a DOM id referenced from script but absent from markup.
 *
 * Checks
 *   1. Exactly one inline <script> block, and it parses as a script.
 *   2. Every static getElementById('x') resolves to an id="x" in the markup.
 *   3. Every dynamic id template (id="foo-${i}") has a matching query builder.
 *   4. Every <label for="x"> resolves to a real control id.
 *   5. CSS custom properties referenced via var(--x) are all declared in :root.
 *   6. Preset keys match the archive selector and all step data is in range.
 *   7. Tag balance sanity for the top-level structural elements.
 *
 * Exit code 0 on success, 1 on any failure.
 *
 * Usage: node tools/validate.mjs [path/to/app.html]
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import vm from 'node:vm';

const target = process.argv[2] ?? 'Form-909 Warp IDM Drum Machine.html';

const problems = [];
const notes = [];

const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

if (!existsSync(target)) {
  console.error(`✗ File not found: ${target}`);
  process.exit(1);
}

const html = readFileSync(target, 'utf8');
const fileName = basename(target);

/* ------------------------------------------------------------------ 1. script */
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
if (scripts.length === 0) fail('No inline <script> block found — the engine is missing.');
if (scripts.length > 1) note(`${scripts.length} <script> blocks found; expected 1.`);

for (const [index, match] of scripts.entries()) {
  try {
    new vm.Script(match[1], { filename: `${fileName}#script[${index}]` });
    note(`script[${index}] parses cleanly (${match[1].split('\n').length} lines).`);
  } catch (err) {
    fail(`script[${index}] failed to parse: ${err.message}`);
  }
}

/* ---------------------------------------------------------------- 2. id refs */
const declaredIds = new Set([...html.matchAll(/\sid="([^"$]+)"/g)].map((m) => m[1]));
const staticRefs = new Set([...html.matchAll(/getElementById\('([^'$]+)'\)/g)].map((m) => m[1]));
const missingRefs = [...staticRefs].filter((id) => !declaredIds.has(id));
if (missingRefs.length) {
  fail(`getElementById() references with no matching id: ${missingRefs.sort().join(', ')}`);
} else {
  note(`${staticRefs.size} static element references all resolve.`);
}

/* ------------------------------------------------- 3. dynamic id templates */
// Ids minted inside template literals, e.g. id="mute-${tIdx}".
const dynamicIds = new Set([...html.matchAll(/\sid="([^"]*\$\{[^"]*)"/g)].map((m) => m[1]));
// Template-literal lookups, e.g. getElementById(`mute-${tIdx}`).
const dynamicRefs = new Set([...html.matchAll(/getElementById\(`([^`]*\$\{[^`]*)`\)/g)].map((m) => m[1]));
// An id minted from a template is legitimate if script queries it *or* a
// <label for="…"> points at it — the length inputs are labelled, not queried.
const dynamicLabelTargets = new Set(
  [...html.matchAll(/<label[^>]*\sfor="([^"]*\$\{[^"]*)"/g)].map((m) => m[1])
);
const unmatchedDynamic = [...dynamicIds].filter((id) => {
  const queried = [...dynamicRefs].some((ref) => ref.replace(/\s/g, '') === id.replace(/\s/g, ''));
  const labelled = [...dynamicLabelTargets].some((l) => l.replace(/\s/g, '') === id.replace(/\s/g, ''));
  return !queried && !labelled;
});
if (unmatchedDynamic.length) {
  fail(`Dynamically minted ids are neither queried nor labelled: ${unmatchedDynamic.sort().join(', ')}`);
} else {
  note(`${dynamicIds.size} dynamic id templates all have a matching query or label.`);
}

/* ------------------------------------------------------------------ 4. labels */
const labelTargets = new Set([...html.matchAll(/<label[^>]*\sfor="([^"$]+)"/g)].map((m) => m[1]));
const orphanLabels = [...labelTargets].filter((id) => !declaredIds.has(id));
if (orphanLabels.length) {
  fail(`<label for="…"> points at a non-existent id: ${orphanLabels.sort().join(', ')}`);
} else {
  note(`${labelTargets.size} explicit label associations all resolve.`);
}

/* ------------------------------------------------------------- 5. CSS vars */
const rootBlock = html.match(/:root\s*\{([\s\S]*?)\}/);
const declaredVars = new Set(
  rootBlock ? [...rootBlock[1].matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]) : []
);
const usedVars = new Set([...html.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
const undeclaredVars = [...usedVars].filter((v) => !declaredVars.has(v));
if (undeclaredVars.length) {
  fail(`var() references undeclared custom properties: ${undeclaredVars.sort().join(', ')}`);
} else {
  note(`${usedVars.size} CSS custom properties all declared in :root.`);
}

/* ------------------------------------------------------------ 6. preset data */
const presetStart = html.indexOf('const PRESETS = {');
const presetEnd = html.indexOf('\n    function loadPreset', presetStart);
if (presetStart < 0 || presetEnd < 0) {
  fail('Could not locate the declarative PRESETS object or its end marker.');
} else {
  try {
    const presetSource = html.slice(presetStart, presetEnd)
      .trim()
      .replace(/^const PRESETS =/, 'globalThis.PRESETS =');
    const sandbox = {};
    vm.runInNewContext(presetSource, sandbox, { timeout: 1000 });
    const presets = sandbox.PRESETS;
    const dropdown = html.match(/<select id="presetSelect"[\s\S]*?<\/select>/);
    const optionKeys = dropdown
      ? [...dropdown[0].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])
      : [];
    const presetKeys = Object.keys(presets || {});

    if (!dropdown) fail('The preset archive selector is missing.');
    const missingOptions = presetKeys.filter((key) => !optionKeys.includes(key));
    const missingPresets = optionKeys.filter((key) => !Object.hasOwn(presets || {}, key));
    if (missingOptions.length || missingPresets.length) {
      fail(`Preset/archive selector mismatch; missing options: ${missingOptions.join(', ') || 'none'}; ` +
           `missing presets: ${missingPresets.join(', ') || 'none'}.`);
    }

    const invalidSteps = [];
    for (const [key, preset] of Object.entries(presets || {})) {
      if (!Array.isArray(preset.lengths) || !Array.isArray(preset.data) ||
          preset.lengths.length !== 6 || preset.data.length !== 6) {
        invalidSteps.push(`${key}: expected six lane lengths and six data arrays`);
        continue;
      }
      preset.data.forEach((lane, laneIndex) => {
        const length = preset.lengths[laneIndex];
        if (!Number.isInteger(length) || length < 1 || length > 32 || !Array.isArray(lane)) {
          invalidSteps.push(`${key}: invalid lane ${laneIndex} length or data`);
          return;
        }
        lane.forEach((step) => {
          if (!Number.isInteger(step.i) || step.i < 0 || step.i >= length ||
              (step.r != null && (step.r < 1 || step.r > 4)) ||
              (step.p != null && (step.p < -24 || step.p > 24)) ||
              (step.v != null && (step.v < 0 || step.v > 127)) ||
              (step.pr != null && (step.pr < 0 || step.pr > 100))) {
            invalidSteps.push(`${key}: invalid step data in lane ${laneIndex}`);
          }
        });
      });
    }
    if (invalidSteps.length) fail(`Invalid preset step data: ${invalidSteps.join('; ')}`);
    else note(`${presetKeys.length} presets match the archive selector; lane lengths and step locks are in range.`);
  } catch (err) {
    fail(`Preset data could not be validated: ${err.message}`);
  }
}

/* ------------------------------------------------------------ 7. tag balance */
// Count structural tags only in the markup itself: <script> and <style> bodies
// legitimately contain things like "<body>" inside comments and strings, and
// counting those would produce false positives.
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '');

for (const tag of ['html', 'head', 'body', 'style', 'script', 'header', 'main']) {
  const open = (markup.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
  const close = (markup.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
  if (open !== close) fail(`Unbalanced <${tag}>: ${open} open, ${close} close.`);
}
if (!/^<!DOCTYPE html>/i.test(markup.trim())) fail('Missing <!DOCTYPE html> declaration.');
if (!/<html[^>]*\slang="[a-z-]+"/i.test(markup)) fail('<html> is missing a lang attribute.');

/* ------------------------------------------------------------------- report */
console.log(`\nForm 909-WARP — static validation of ${fileName}\n${'─'.repeat(52)}`);
for (const n of notes) console.log(`  ✓ ${n}`);

if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n✗ ${problems.length} problem(s) found.\n`);
  process.exit(1);
}

console.log(`\n✓ All checks passed.\n`);
