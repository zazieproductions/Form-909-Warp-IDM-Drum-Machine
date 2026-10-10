#!/usr/bin/env node
/**
 * locks.test.mjs — per-step synthesis parameter locks (roadmap item 2.3):
 * resolveStepParams, the per-voice lock chain, voice-level FM/decay/freq
 * behaviour, inspector wiring and determinism.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeAudioContext, FakeEvent, serializeEvents } from './harness.mjs';

const freshLocks = () => ({
  freq: { on: false, value: 0 },
  fm: { on: false, value: 1 },
  decay: { on: false, value: 1 },
  cutoff: { on: false, value: 12000 },
  res: { on: false, value: 1 },
  dist: { on: false, value: 0.3 }
});

const INERT = { freqMul: 1, fmDepth: 1, decay: 1, cutoff: null, res: null, dist: 0 };

test('resolveStepParams returns inert defaults with all locks off', () => {
  const { app } = loadApp();
  const p = app.BureauEngine.resolveStepParams(app.bureau.tracks[0].steps[0]);
  assert.deepEqual({ ...p }, INERT);
  // A step without a locks object at all is tolerated.
  assert.deepEqual({ ...app.BureauEngine.resolveStepParams({ vel: 100 }) }, INERT);
});

test('resolveStepParams resolves engaged locks and clamps wild values', () => {
  const { app } = loadApp();
  const step = { locks: freshLocks() };
  step.locks.freq.on = true; step.locks.freq.value = 100; // +1 semitone
  step.locks.fm.on = true; step.locks.fm.value = 1.5;
  step.locks.decay.on = true; step.locks.decay.value = 2;
  step.locks.cutoff.on = true; step.locks.cutoff.value = 4000;
  step.locks.res.on = true; step.locks.res.value = 6;
  step.locks.dist.on = true; step.locks.dist.value = 0.5;
  const p = app.BureauEngine.resolveStepParams(step);
  assert.ok(Math.abs(p.freqMul - Math.pow(2, 100 / 1200)) < 1e-12, 'freq lock detunes by cents');
  assert.equal(p.fmDepth, 1.5);
  assert.equal(p.decay, 2);
  assert.equal(p.cutoff, 4000);
  assert.equal(p.res, 6);
  assert.equal(p.dist, 0.5);

  step.locks.fm.value = 99;
  step.locks.decay.value = 0;
  step.locks.cutoff.value = -50;
  step.locks.res.value = 1000;
  step.locks.dist.value = 7;
  const clamped = app.BureauEngine.resolveStepParams(step);
  assert.equal(clamped.fmDepth, 2, 'fm clamped to its range');
  assert.equal(clamped.decay, 0.1, 'decay clamped to its range');
  assert.equal(clamped.cutoff, 200, 'cutoff clamped to its range');
  assert.equal(clamped.res, 20, 'res clamped to its range');
  assert.equal(clamped.dist, 1, 'dist clamped to its range');
});

test('the distortion curve is bounded, memoised and monotonic', () => {
  const { app } = loadApp();
  const curve = app.BureauEngine.distCurve(0.5);
  // Created inside the app's vm realm, so instanceof against the test
  // realm's Float32Array would fail; check the view shape instead.
  assert.ok(ArrayBuffer.isView(curve) && curve.BYTES_PER_ELEMENT === 4, 'curve is a Float32Array');
  assert.equal(curve.length, 1024);
  assert.ok(curve[0] >= -1 && curve[0] <= 0, 'negative input maps to a negative output');
  assert.ok(curve[1023] <= 1 && curve[1023] > 0, 'positive input stays below unity');
  let monotonic = true;
  for (let i = 1; i < curve.length; i++) if (curve[i] < curve[i - 1]) monotonic = false;
  assert.ok(monotonic, 'curve is monotonic');
  assert.equal(app.BureauEngine.distCurve(0.5), curve, 'identical amounts share one curve');
  assert.notEqual(app.BureauEngine.distCurve(0.6), curve, 'different amounts get their own curve');
});

test('unlocked steps allocate no lock-chain nodes; locked steps do', () => {
  const { app } = loadApp();
  const { bureau } = app;

  const plain = new FakeAudioContext();
  bureau.playTrackSound(0, 0, { vel: 100, pitchOffset: 0, locks: freshLocks() }, plain, plain.createGain(), () => 0.5);
  const plainFilters = plain.nodes.filter((n) => n.nodeKind === 'biquadFilter').length;
  const plainShapers = plain.nodes.filter((n) => n.nodeKind === 'waveShaper').length;

  const ctx = new FakeAudioContext();
  const lockedLocks = freshLocks();
  lockedLocks.cutoff.on = true; lockedLocks.cutoff.value = 5000;
  lockedLocks.res.on = true; lockedLocks.res.value = 4;
  lockedLocks.dist.on = true; lockedLocks.dist.value = 0.7;
  const dest = ctx.createGain();
  bureau.playTrackSound(0, 0, { vel: 100, pitchOffset: 0, locks: lockedLocks }, ctx, dest, () => 0.5);

  const filters = ctx.nodes.filter((n) => n.nodeKind === 'biquadFilter');
  const shapers = ctx.nodes.filter((n) => n.nodeKind === 'waveShaper');
  assert.equal(filters.length, plainFilters + 1, 'cutoff/res locks add exactly one filter');
  assert.equal(shapers.length, plainShapers + 1, 'the dist lock adds exactly one shaper');

  const lockFilter = filters[filters.length - 1];
  assert.equal(lockFilter.type, 'lowpass');
  assert.equal(lockFilter.frequency.value, 5000);
  assert.equal(lockFilter.Q.value, 4);
  const lockShaper = shapers[shapers.length - 1];
  assert.ok(ArrayBuffer.isView(lockShaper.curve) && lockShaper.curve.length === 1024, 'shaper got a distortion curve');
  assert.equal(lockShaper.oversample, '2x');

  // The chain actually routes: voice tap -> filter -> shaper -> destination.
  assert.ok(lockShaper.outputs.includes(dest), 'the lock chain terminates at the destination');
  assert.ok(lockFilter.outputs.includes(lockShaper), 'the filter feeds the shaper');
});

test('the FM depth lock scales each voice’s modulation materially', () => {
  const { app } = loadApp();
  const { bureau } = app;

  const gainsSetting = (ctx, value) => ctx.nodes.filter((n) =>
    n.nodeKind === 'gain' && n.gain.events.some((e) => e[0] === 'set' && Math.abs(e[1] - value) < 1e-9));

  // Kick: modulator peak 350 * vel * fmDepth.
  const kickA = new FakeAudioContext();
  bureau.synthKick(kickA, kickA.createGain(), 0, 1, 1, () => 0.5, null);
  assert.equal(gainsSetting(kickA, 350).length, 1, 'default kick FM peak is 350');
  const kickB = new FakeAudioContext();
  bureau.synthKick(kickB, kickB.createGain(), 0, 1, 1, () => 0.5, { ...INERT, fmDepth: 2 });
  assert.equal(gainsSetting(kickB, 700).length, 1, 'FM depth 2 doubles the kick modulator peak');

  // Perc: modulator peak 700 * vel * fmDepth.
  const perc = new FakeAudioContext();
  bureau.synthPerc(perc, perc.createGain(), 0, 1, 1, () => 0.5, { ...INERT, fmDepth: 0 });
  assert.equal(gainsSetting(perc, 0).length >= 1, true, 'FM depth 0 flattens the perc modulator');

  // Snare: the tonal body starts at toneFreq * 1.9 by default and flattens at FM depth 0.
  const snareA = new FakeAudioContext();
  bureau.synthSnare(snareA, snareA.createGain(), 0, 1, 1, () => 0.5, null);
  const snareB = new FakeAudioContext();
  bureau.synthSnare(snareB, snareB.createGain(), 0, 1, 1, () => 0.5, { ...INERT, fmDepth: 0 });
  const toneOf = (ctx) => ctx.nodes.find((n) => n.nodeKind === 'oscillator').frequency.value;
  assert.ok(Math.abs(toneOf(snareA) - 185 * 1.9) < 1e-9, 'default snare body transient');
  assert.ok(Math.abs(toneOf(snareB) - 185) < 1e-9, 'FM depth 0 removes the snare body drop');

  // Hat: FM depth 0 collapses the inharmonic offsets to whole-number ratios.
  const hat = new FakeAudioContext();
  bureau.synthHat(hat, hat.createGain(), 0, 1, 1, () => 0.5, { ...INERT, fmDepth: 0 });
  const hatFreqs = hat.nodes.filter((n) => n.nodeKind === 'oscillator').map((n) => n.frequency.value);
  assert.deepEqual(hatFreqs, [2, 3, 4, 5, 6, 8].map((r) => 420 * r), 'FM depth 0 makes the hat cluster harmonic');

  // Sub: FM depth 0 flattens the filter sweep at the ramp target.
  const sub = new FakeAudioContext();
  bureau.synthSub(sub, sub.createGain(), 0, 1, 1, () => 0.5, { ...INERT, fmDepth: 0 });
  const subFilter = sub.nodes.find((n) => n.nodeKind === 'biquadFilter');
  assert.ok(Math.abs(subFilter.frequency.value - 55 * 1.5) < 1e-9, 'FM depth 0 flattens the sub sweep');
});

test('the decay lock stretches envelopes and stop times', () => {
  const { app } = loadApp();
  const { bureau } = app;

  const stopsOf = (ctx) => ctx.events.filter((e) => e.kind === 'oscStop').map((e) => e.time);

  const a = new FakeAudioContext();
  bureau.synthKick(a, a.createGain(), 0, 1, 1, () => 0.5, null);
  assert.ok(stopsOf(a).includes(0.4), 'default kick osc stops at 0.4s');

  const b = new FakeAudioContext();
  bureau.synthKick(b, b.createGain(), 0, 1, 1, () => 0.5, { ...INERT, decay: 2 });
  assert.ok(stopsOf(b).includes(0.8), 'decay 2 stretches the kick to 0.8s');
  assert.ok(!stopsOf(b).includes(0.4), 'the original stop time is gone');

  // The snare noise buffer scales with decay too.
  const snare = new FakeAudioContext();
  bureau.synthSnare(snare, snare.createGain(), 0, 1, 1, () => 0.5, { ...INERT, decay: 2 });
  const noise = snare.nodes.find((n) => n.nodeKind === 'bufferSource');
  assert.ok(Math.abs(noise.buffer.length - Math.floor(48000 * 0.44)) < 2, 'noise buffer doubles with decay');
});

test('the freq lock detunes every voice', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const upOneSemitone = Math.pow(2, 100 / 1200);

  // playTrackSound applies the lock to pitchShift before the voice runs.
  const locks = freshLocks();
  locks.freq.on = true; locks.freq.value = 100;

  const kick = new FakeAudioContext();
  bureau.playTrackSound(0, 0, { vel: 100, pitchOffset: 0, locks }, kick, kick.createGain(), () => 0.5);
  const kickOsc = kick.nodes.find((n) => n.nodeKind === 'oscillator');
  assert.ok(Math.abs(kickOsc.frequency.value - 54 * 5.2 * upOneSemitone) < 1e-9, 'kick detuned by the lock');

  const sub = new FakeAudioContext();
  bureau.playTrackSound(5, 0, { vel: 100, pitchOffset: 0, locks }, sub, sub.createGain(), () => 0.5);
  const subOsc = sub.nodes.find((n) => n.nodeKind === 'oscillator');
  assert.ok(Math.abs(subOsc.frequency.value - 55 * upOneSemitone) < 1e-9, 'sub detuned by the lock');

  // Combined with a step pitch offset the two detunes multiply.
  const both = new FakeAudioContext();
  bureau.playTrackSound(5, 0, { vel: 100, pitchOffset: 12, locks }, both, both.createGain(), () => 0.5);
  const bothOsc = both.nodes.find((n) => n.nodeKind === 'oscillator');
  assert.ok(Math.abs(bothOsc.frequency.value - 55 * 2 * upOneSemitone) < 1e-9, 'lock and pitch offset multiply');
});

test('locked voices stay deterministic under a seeded rand', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const seeded = (seed) => {
    const next = app.BureauEngine.mulberry32(seed);
    return () => next();
  };

  const locks = freshLocks();
  locks.freq.on = true; locks.freq.value = -50;
  locks.fm.on = true; locks.fm.value = 1.7;
  locks.decay.on = true; locks.decay.value = 0.6;
  locks.cutoff.on = true; locks.cutoff.value = 2500;
  locks.res.on = true; locks.res.value = 9;
  locks.dist.on = true; locks.dist.value = 0.8;
  const stepData = { vel: 96, pitchOffset: -3, locks };

  for (const trackIdx of [0, 1, 2, 3, 4, 5]) {
    const ctxA = new FakeAudioContext();
    const ctxB = new FakeAudioContext();
    bureau.playTrackSound(trackIdx, 0.25, stepData, ctxA, ctxA.createGain(), seeded(1234));
    bureau.playTrackSound(trackIdx, 0.25, stepData, ctxB, ctxB.createGain(), seeded(1234));
    assert.deepEqual(
      serializeEvents(ctxA),
      serializeEvents(ctxB),
      `track ${trackIdx} renders identically from the same seed with locks engaged`
    );
  }
});

test('the inspector lock controls write only the selected step', () => {
  const { app, document } = loadApp();
  const { bureau } = app;

  app.selectStep(0, 0);
  const panel = document.getElementById('stepLocks');
  assert.ok(panel, 'locks panel exists');
  assert.equal(panel.querySelectorAll('.lock-row').length, 6, 'six lock rows rendered');

  const toggle = () => panel.querySelector('.lock-toggle[data-lock="freq"]');
  assert.equal(toggle().getAttribute('aria-pressed'), 'false');
  toggle().click();
  assert.equal(bureau.tracks[0].steps[0].locks.freq.on, true, 'toggle engages the lock');
  assert.equal(bureau.tracks[0].steps[1].locks.freq.on, false, 'other steps untouched');
  assert.equal(bureau.tracks[1].steps[0].locks.freq.on, false, 'other lanes untouched');
  // The panel re-renders on every toggle, so re-query the fresh node.
  assert.equal(toggle().getAttribute('aria-pressed'), 'true', 'toggle reflects state after re-render');

  const slider = panel.querySelector('.lock-slider[data-lock="freq"]');
  assert.equal(slider.disabled, false, 'slider enabled once the lock is on');
  slider.value = 55;
  slider.dispatchEvent(new FakeEvent('input', { target: slider }));
  assert.equal(bureau.tracks[0].steps[0].locks.freq.value, 55, 'slider writes the lock value');
  const label = panel.querySelector('.lock-val[data-lock="freq"]');
  assert.equal(label.innerText, '+55c', 'value label formats the lock');

  // Locked cells carry the marker class in the grid.
  const cell = document.querySelector('[data-track="0"][data-step="0"]');
  assert.ok(cell.classList.contains('has-locks'), 'cell shows the lock marker');
  const plainCell = document.querySelector('[data-track="0"][data-step="1"]');
  assert.ok(!plainCell.classList.contains('has-locks'), 'unlocked cells have no marker');

  // Lock edits are undoable.
  const depth = bureau.undoStack.length;
  toggle().click(); // disengage
  assert.equal(bureau.tracks[0].steps[0].locks.freq.on, false);
  assert.ok(bureau.undoStack.length > depth, 'lock edits push history');
  bureau.undo();
  assert.equal(bureau.tracks[0].steps[0].locks.freq.on, true, 'undo restores the lock');
});

test('locks survive the session round-trip', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const step = bureau.tracks[3].steps[7];
  step.locks.decay.on = true; step.locks.decay.value = 3.5;
  step.locks.cutoff.on = true; step.locks.cutoff.value = 900;

  const doc = bureau.serializeSession();
  app.loadPreset('empty');
  bureau.applySession(doc);
  const restored = bureau.tracks[3].steps[7];
  assert.equal(restored.locks.decay.on, true);
  assert.equal(restored.locks.decay.value, 3.5);
  assert.equal(restored.locks.cutoff.on, true);
  assert.equal(restored.locks.cutoff.value, 900);
});
