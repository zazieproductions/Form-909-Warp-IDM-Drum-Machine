#!/usr/bin/env node
/**
 * ratchet.test.mjs — the advanced ratchet engine (roadmap item 2.5):
 * ratchetOffsets curves, live scheduling, offline parity, the 1–16 range,
 * and the inspector curve control.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeEvent } from './harness.mjs';

const seeded = (app, seed) => {
  const next = app.BureauEngine.mulberry32(seed);
  return () => next();
};

test('ratchetOffsets: even matches the legacy positions', () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('empty');
  bureau.initAudio();
  bureau.bpm = 120; // stepDuration = 0.125 s
  bureau.fx.humanize = 0;
  const step = bureau.tracks[5].steps[0]; // sub: one oscillator per trigger
  step.active = true;
  step.vel = 100;
  step.prob = 100;
  step.ratchet = 4;
  step.ratchetCurve = 'even';

  bureau.audioCtx.events.length = 0;
  bureau.scheduleStep(0, 1.0, seeded(app, 7));
  const starts = bureau.audioCtx.events
    .filter((e) => e.kind === 'oscStart')
    .map((e) => e.time)
    .sort((a, b) => a - b);
  const expected = [0, 1, 2, 3].map((r) => 1.0 + (r / 4) * 0.125);
  assert.deepEqual(starts, expected, 'even spacing keeps the original positions');
});

test('ratchetOffsets: accel and decel reshape the spacing inside the step', () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('empty');
  bureau.initAudio();
  bureau.bpm = 120;
  bureau.fx.humanize = 0;

  const run = (curve) => {
    bureau.audioCtx.events.length = 0;
    const step = bureau.tracks[5].steps[0];
    step.active = true;
    step.vel = 100;
    step.prob = 100;
    step.ratchet = 4;
    step.ratchetCurve = curve;
    bureau.scheduleStep(0, 1.0, seeded(app, 7));
    return bureau.audioCtx.events
      .filter((e) => e.kind === 'oscStart')
      .map((e) => e.time)
      .sort((a, b) => a - b);
  };

  const accel = run('accel');
  const decel = run('decel');
  const stepDur = 0.125;
  // accel: pos = (r/4)^2 -> gaps grow; decel: pos = 1-(1-r/4)^2 -> gaps shrink.
  assert.deepEqual(accel, [0, 1, 4, 9].map((r) => 1.0 + (r / 16) * stepDur), 'accel bunches early, spreads late');
  assert.deepEqual(decel, [0, 7, 12, 15].map((r) => 1.0 + (r / 16) * stepDur), 'decel spreads early, bunches late');
  // Both stay inside the step and keep the first trigger on the beat.
  for (const t of [...accel, ...decel]) {
    assert.ok(t >= 1.0 && t < 1.0 + stepDur, 'trigger inside the step');
  }
  assert.equal(accel[0], 1.0, 'first trigger is the step itself');
  assert.equal(decel[0], 1.0, 'first trigger is the step itself');
});

test('ratchetOffsets: scatter is sorted, bounded and seed-deterministic', () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('empty');
  bureau.initAudio();
  bureau.bpm = 120;
  bureau.fx.humanize = 0;

  const run = (seed) => {
    bureau.audioCtx.events.length = 0;
    const step = bureau.tracks[5].steps[0];
    step.active = true;
    step.vel = 100;
    step.prob = 100;
    step.ratchet = 8;
    step.ratchetCurve = 'scatter';
    bureau.scheduleStep(0, 1.0, seeded(app, seed));
    return bureau.audioCtx.events
      .filter((e) => e.kind === 'oscStart')
      .map((e) => e.time)
      .sort((a, b) => a - b);
  };

  const a = run(42);
  const b = run(42);
  const c = run(43);
  assert.equal(a.length, 8, 'eight sub-triggers');
  assert.deepEqual(a, b, 'same seed, same scatter');
  assert.notDeepEqual(a, c, 'different seed, different scatter');
  let sorted = true;
  for (let i = 1; i < a.length; i++) if (a[i] < a[i - 1]) sorted = false;
  assert.ok(sorted, 'scatter offsets are sorted');
  for (const t of a) assert.ok(t >= 1.0 && t < 1.0 + 0.125, 'scatter stays inside the step');
  assert.equal(a[0], 1.0, 'first trigger clamps onto the beat');
});

test('ratchet supports 1..16 sub-triggers and cycles on shift-click', () => {
  const { app, document } = loadApp();
  const { bureau } = app;

  const step = bureau.tracks[0].steps[0];
  step.active = true;
  step.ratchet = 16;
  assert.equal(document.getElementById('stepRatch').getAttribute('max'), '16', 'slider reaches 16');

  // Shift-click cycles 1 -> 2 -> … -> 16 -> 1.
  const cell = document.querySelector('[data-track="0"][data-step="1"]');
  let ratchet = 1;
  for (let i = 0; i < 16; i++) {
    cell.dispatchEvent(new FakeEvent('click', { target: cell, shiftKey: true }));
    ratchet = ratchet >= 16 ? 1 : ratchet + 1;
    assert.equal(bureau.tracks[0].steps[1].ratchet, ratchet, `cycle ${i + 1}`);
  }
  assert.equal(bureau.tracks[0].steps[1].ratchet, 1, 'wraps back to 1');

  // The scheduler honours 16 triggers.
  app.loadPreset('empty');
  bureau.initAudio();
  bureau.bpm = 120;
  bureau.fx.humanize = 0;
  bureau.tracks[5].steps[0].active = true;
  bureau.tracks[5].steps[0].prob = 100;
  bureau.tracks[5].steps[0].ratchet = 16;
  bureau.audioCtx.events.length = 0;
  bureau.scheduleStep(0, 1.0, seeded(app, 3));
  const starts = bureau.audioCtx.events.filter((e) => e.kind === 'oscStart');
  assert.equal(starts.length, 16, 'sixteen sub-triggers scheduled');
});

test('the inspector curve select writes the selected step and is undoable', () => {
  const { app, document } = loadApp();
  const { bureau } = app;

  app.selectStep(2, 5);
  const select = document.getElementById('stepRatchCurve');
  assert.equal(select.value, 'even');
  select.value = 'accel';
  select.dispatchEvent(new FakeEvent('change', { target: select }));
  assert.equal(bureau.tracks[2].steps[5].ratchetCurve, 'accel');
  assert.equal(bureau.tracks[2].steps[4].ratchetCurve, 'even', 'other steps untouched');

  // selectStep reflects the stored curve.
  app.selectStep(2, 5);
  assert.equal(document.getElementById('stepRatchCurve').value, 'accel');

  bureau.undo();
  assert.equal(bureau.tracks[2].steps[5].ratchetCurve, 'even', 'undo restores the curve');
});

test('curved ratchets survive the session round-trip and normalize', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.tracks[1].steps[3].ratchet = 7;
  bureau.tracks[1].steps[3].ratchetCurve = 'scatter';
  const doc = bureau.serializeSession();
  app.loadPreset('empty');
  bureau.applySession(doc);
  assert.equal(bureau.tracks[1].steps[3].ratchet, 7);
  assert.equal(bureau.tracks[1].steps[3].ratchetCurve, 'scatter');

  // Out-of-range ratchets clamp into 1..16.
  const clean = app.BureauEngine.migrateSessionDoc({
    format: 'form909warp.session',
    version: 2,
    tracks: [{ steps: [{ a: 1, r: 0 }, { a: 1, r: 99 }] }]
  });
  assert.equal(clean.tracks[0].steps[0].ratchet, 1, 'ratchet 0 clamps to 1');
  assert.equal(clean.tracks[0].steps[1].ratchet, 16, 'ratchet 99 clamps to 16');
});

test('a curved ratchet renders deterministically offline', async () => {
  const { app } = loadApp();
  const { bureau } = app;
  const step = bureau.tracks[4].steps[0]; // glitch voice, exercises rand
  step.active = true;
  step.vel = 100;
  step.prob = 100;
  step.ratchet = 16;
  step.ratchetCurve = 'scatter';

  const r1 = await bureau.exportWav(1, null, { seed: 99 });
  const r2 = await bureau.exportWav(1, null, { seed: 99 });
  const b1 = Buffer.from(await r1.blob.arrayBuffer());
  const b2 = Buffer.from(await r2.blob.arrayBuffer());
  assert.ok(b1.equals(b2), 'same seed, byte-identical bounce with scatter ratchets');
});
