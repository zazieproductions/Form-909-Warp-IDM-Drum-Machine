#!/usr/bin/env node
/**
 * conditions.test.mjs — conditional triggers (roadmap item 2.6): prev-step,
 * prev-cycle, alternating and inter-track conditions, the shared planner,
 * and inspector wiring.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeEvent } from './harness.mjs';

const seeded = (app, seed) => {
  const next = app.BureauEngine.mulberry32(seed);
  return () => next();
};

/** Fresh app, empty pattern, one audible lane under test (sub: 1 osc/trigger). */
function rig(app, lane = 5) {
  app.loadPreset('empty');
  app.bureau.initAudio();
  app.bureau.bpm = 120;
  app.bureau.fx.humanize = 0;
  app.bureau.fx.globalRatchet = 0;
  app.bureau.resetHistories();
  return app.bureau.tracks[lane].steps;
}

const countTriggers = (bureau) =>
  bureau.audioCtx.events.filter((e) => e.kind === 'oscStart').length;

/** Evaluate every global step of one lane cycle, in order. */
function runCycle(bureau, app, cycleStart, length, seed = 1) {
  for (let s = cycleStart; s < cycleStart + length; s++) {
    bureau.scheduleStep(s, 1.0 + s * 0.125, seeded(app, seed));
  }
}

test('the planner gates on active, probability, mute and solo', () => {
  const { app } = loadApp();
  const { bureau } = app;
  rig(app);

  const steps = bureau.tracks[5].steps;
  steps[0].active = true;
  steps[0].prob = 100;

  bureau.scheduleStep(0, 1.0, seeded(app, 1));
  assert.equal(countTriggers(bureau), 1, 'active step fires');

  steps[0].prob = 0;
  bureau.scheduleStep(1, 1.0, seeded(app, 1));
  assert.equal(countTriggers(bureau), 1, 'probability 0 never fires');

  steps[0].prob = 100;
  bureau.tracks[5].mute = true;
  bureau.scheduleStep(2, 1.0, seeded(app, 1));
  assert.equal(countTriggers(bureau), 1, 'muted lane stays silent');

  bureau.tracks[5].mute = false;
  bureau.tracks[0].solo = true;
  bureau.scheduleStep(3, 1.0, seeded(app, 1));
  assert.equal(countTriggers(bureau), 1, 'non-solo lane is gated when any solo is on');
});

test('prev-step condition fires only right after the previous step fired', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const steps = rig(app);
  bureau.tracks[5].currentLength = 4;

  steps[0].active = true; steps[0].prob = 100;
  steps[1].active = true; steps[1].prob = 100;
  steps[1].condition = 'prev';

  // Step 0 fires, arming step 1's condition.
  bureau.scheduleStep(0, 1.0, seeded(app, 5));
  assert.equal(countTriggers(bureau), 1, 'step 0 fires');
  // Step 1 sees step 0 fired -> fires too.
  bureau.scheduleStep(1, 1.0, seeded(app, 5));
  assert.equal(countTriggers(bureau), 2, 'step 1 fires after step 0 fired');

  // Deactivate step 0: step 1 loses its condition on the next pass.
  steps[0].active = false;
  bureau.scheduleStep(4, 1.0, seeded(app, 5)); // lane wraps: step 0 evaluated, silent
  assert.equal(countTriggers(bureau), 2, 'step 0 silent');
  bureau.scheduleStep(5, 1.0, seeded(app, 5)); // step 1: prev did not fire
  assert.equal(countTriggers(bureau), 2, 'step 1 falls silent without its predecessor');
});

test('prev-cycle condition latches: it repeats while the chain holds', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const steps = rig(app);
  bureau.tracks[5].currentLength = 4;

  steps[2].active = true; steps[2].prob = 100; // condition 'none' to start

  // Cycle 0: fires unconditionally, seeding the latch.
  runCycle(bureau, app, 0, 4);
  assert.equal(bureau.histories[5].fired[2], true, 'cycle 0 fires and records');

  // From here the step only fires while it fired one cycle ago.
  steps[2].condition = 'prevCycle';
  const before1 = countTriggers(bureau);
  runCycle(bureau, app, 4, 4);
  assert.equal(countTriggers(bureau) - before1, 1, 'cycle 1: latched on, fires');

  // Break the chain: the step goes silent for one cycle…
  steps[2].active = false;
  const before2 = countTriggers(bureau);
  runCycle(bureau, app, 8, 4);
  assert.equal(countTriggers(bureau) - before2, 0, 'cycle 2: chain broken, silent');

  // …so even reactivated, the latch is open.
  steps[2].active = true;
  const before3 = countTriggers(bureau);
  runCycle(bureau, app, 12, 4);
  assert.equal(countTriggers(bureau) - before3, 0, 'cycle 3: latch stays open');
});

test('alt2 and alt4 conditions alternate by cycle', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const steps = rig(app);
  bureau.tracks[5].currentLength = 2;

  steps[0].active = true; steps[0].prob = 100;
  steps[0].condition = 'alt2';
  steps[1].active = true; steps[1].prob = 100;
  steps[1].condition = 'alt4';

  const alt2Fires = [];
  const alt4Fires = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    let before = countTriggers(bureau);
    bureau.scheduleStep(cycle * 2, 1.0 + cycle * 2 * 0.125, seeded(app, 3));
    alt2Fires.push(countTriggers(bureau) - before);
    before = countTriggers(bureau);
    bureau.scheduleStep(cycle * 2 + 1, 1.0 + (cycle * 2 + 1) * 0.125, seeded(app, 3));
    alt4Fires.push(countTriggers(bureau) - before);
  }
  assert.deepEqual(alt2Fires, [1, 0, 1, 0, 1], 'alt2 fires on even cycles');
  assert.deepEqual(alt4Fires, [1, 0, 0, 0, 1], 'alt4 fires on every fourth cycle');
});

test('inter-track condition follows another lane on the same step', () => {
  const { app } = loadApp();
  const { bureau } = app;
  rig(app);
  bureau.tracks[0].currentLength = 4;
  bureau.tracks[5].currentLength = 4;

  bureau.tracks[0].steps[0].active = true;
  bureau.tracks[0].steps[0].prob = 100;
  bureau.tracks[5].steps[0].active = true;
  bureau.tracks[5].steps[0].prob = 100;
  bureau.tracks[5].steps[0].condition = 'track:0';

  // Track 0's step 0 is a kick: 2 oscillators per trigger.
  bureau.scheduleStep(0, 1.0, seeded(app, 11));
  const afterBoth = countTriggers(bureau);
  assert.equal(afterBoth, 3, 'kick (2 oscs) + follower sub (1 osc) fire together');

  // Muting the leader silences the follower on the same step.
  bureau.tracks[0].mute = true;
  bureau.scheduleStep(4, 1.0, seeded(app, 11));
  assert.equal(countTriggers(bureau), afterBoth, 'muted leader means no follower trigger');
});

test('conditions that only wait on each other resolve to silence', () => {
  const { app } = loadApp();
  const { bureau } = app;
  rig(app);
  bureau.tracks[4].currentLength = 4;
  bureau.tracks[5].currentLength = 4;

  bureau.tracks[4].steps[0].active = true;
  bureau.tracks[4].steps[0].prob = 100;
  bureau.tracks[4].steps[0].condition = 'track:5';
  bureau.tracks[5].steps[0].active = true;
  bureau.tracks[5].steps[0].prob = 100;
  bureau.tracks[5].steps[0].condition = 'track:4';

  bureau.scheduleStep(0, 1.0, seeded(app, 13));
  assert.equal(countTriggers(bureau), 0, 'a deadlock of conditions is silence, not a hang');
});

test('conditions compose with ratchets and probability', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const steps = rig(app);
  bureau.tracks[5].currentLength = 4;

  steps[0].active = true; steps[0].prob = 100; steps[0].ratchet = 4;
  steps[1].active = true; steps[1].prob = 100; steps[1].ratchet = 3;
  steps[1].condition = 'prev';

  bureau.scheduleStep(0, 1.0, seeded(app, 17));
  assert.equal(countTriggers(bureau), 4, 'step 0 fires its 4 ratchets');
  bureau.scheduleStep(1, 1.0, seeded(app, 17));
  assert.equal(countTriggers(bureau), 7, 'step 1 fires its 3 ratchets after step 0');
});

test('histories reset when a preset loads', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const steps = rig(app);
  steps[0].active = true; steps[0].prob = 100;
  bureau.scheduleStep(0, 1.0, seeded(app, 1));
  assert.equal(bureau.histories[5].fired[0], true, 'history recorded');

  app.loadPreset('confield');
  assert.equal(bureau.histories[5].fired.every((f) => f === false), true, 'histories cleared');
});

test('the inspector condition select writes the selected step and is undoable', () => {
  const { app, document } = loadApp();
  const { bureau } = app;

  app.selectStep(1, 2);
  const select = document.getElementById('stepCondition');
  assert.ok(select, 'condition select exists');
  const labels = [...select.querySelectorAll('option')].map((o) => o.innerText);
  assert.ok(labels.includes('NONE'), 'built-in conditions offered');
  assert.ok(labels.includes('PREV STEP') && labels.includes('PREV CYCLE'), 'cycle conditions offered');
  assert.ok(labels.some((l) => l.startsWith('TRACK:')), 'inter-track conditions offered');
  assert.ok(!labels.some((l) => l === 'TRACK: SN'), 'the selected lane never waits on itself');

  select.value = 'alt4';
  select.dispatchEvent(new FakeEvent('change', { target: select }));
  assert.equal(bureau.tracks[1].steps[2].condition, 'alt4');
  assert.equal(bureau.tracks[1].steps[3].condition, 'none', 'other steps untouched');

  app.selectStep(1, 2);
  assert.equal(document.getElementById('stepCondition').value, 'alt4', 'select reflects the stored condition');

  bureau.undo();
  assert.equal(bureau.tracks[1].steps[2].condition, 'none', 'undo restores the condition');
});

test('conditions survive the session round-trip and normalize', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.tracks[2].steps[9].condition = 'track:4';
  const doc = bureau.serializeSession();
  app.loadPreset('empty');
  bureau.applySession(doc);
  assert.equal(bureau.tracks[2].steps[9].condition, 'track:4');

  const clean = app.BureauEngine.migrateSessionDoc({
    format: 'form909warp.session',
    version: 2,
    tracks: [{ steps: [{ a: 1, c: 'track:99' }, { a: 1, c: 'nonsense' }] }]
  });
  assert.equal(clean.tracks[0].steps[0].condition, 'none', 'out-of-range track ref falls back');
  assert.equal(clean.tracks[0].steps[1].condition, 'none', 'unknown condition falls back');
});

test('a conditional pattern renders deterministically offline', async () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('empty');
  bureau.bpm = 160;
  bureau.tracks[0].currentLength = 8;
  bureau.tracks[0].steps[0].active = true;
  bureau.tracks[0].steps[0].prob = 100;
  bureau.tracks[0].steps[0].ratchet = 2;
  bureau.tracks[1].currentLength = 8;
  bureau.tracks[1].steps[1].active = true;
  bureau.tracks[1].steps[1].prob = 100;
  bureau.tracks[1].steps[1].condition = 'prev';
  bureau.tracks[1].steps[4].active = true;
  bureau.tracks[1].steps[4].prob = 100;
  bureau.tracks[1].steps[4].condition = 'alt2';
  bureau.tracks[2].currentLength = 8;
  bureau.tracks[2].steps[3].active = true;
  bureau.tracks[2].steps[3].prob = 100;
  bureau.tracks[2].steps[3].condition = 'track:0';

  const r1 = await bureau.exportWav(2, null, { seed: 77 });
  const r2 = await bureau.exportWav(2, null, { seed: 77 });
  const b1 = Buffer.from(await r1.blob.arrayBuffer());
  const b2 = Buffer.from(await r2.blob.arrayBuffer());
  assert.ok(b1.equals(b2), 'same seed, byte-identical bounce with conditions engaged');
  assert.ok(b1.length > 1000, 'the bounce actually contains audio');
});
