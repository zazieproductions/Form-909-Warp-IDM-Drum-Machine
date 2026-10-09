#!/usr/bin/env node
/**
 * check-links.mjs — verify that every relative link in the repository's
 * Markdown resolves to a file that actually exists.
 *
 * Documentation rots in a specific way: a file gets renamed, and every README
 * that pointed at it silently keeps pointing at nothing. This check runs in CI
 * so a broken internal link fails the build rather than a reader.
 *
 * Deliberately ignored:
 *   - absolute URLs (http/https/mailto) — external availability is not ours to guarantee
 *   - in-page anchors on the same file (#section)
 *   - links inside fenced code blocks (usually illustrative)
 *
 * Usage: node tools/check-links.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);
const MD_EXT = /\.(md|markdown)$/i;

/** Walk the tree collecting Markdown files. */
function collect(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (MD_EXT.test(entry)) acc.push(full);
  }
  return acc;
}

/** Strip fenced code blocks so illustrative links are not validated. */
function stripCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

const files = collect(ROOT);
const problems = [];
let checked = 0;

for (const file of files) {
  const source = stripCode(readFileSync(file, 'utf8'));
  // Markdown inline link or image: [text](target) — capture the target group only.
  const matches = [...source.matchAll(/(?:!?\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/g)];

  for (const [, rawTarget] of matches) {
    if (/^(https?:|mailto:|tel:|data:)/i.test(rawTarget)) continue;
    if (rawTarget.startsWith('#')) continue;

    const [pathPart] = rawTarget.split('#');
    if (pathPart === '') continue; // same-file anchor

    checked++;
    const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
    if (!existsSync(resolved)) {
      problems.push(`${relative(ROOT, file)} → ${rawTarget}`);
    }
  }
}

console.log(`\nForm 909-WARP — documentation link check\n${'─'.repeat(52)}`);
console.log(`  Scanned ${files.length} Markdown file(s), ${checked} relative link(s).`);

if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ✗ broken link: ${p}`);
  console.log(`\n✗ ${problems.length} broken link(s).\n`);
  process.exit(1);
}

console.log(`\n✓ All relative documentation links resolve.\n`);
