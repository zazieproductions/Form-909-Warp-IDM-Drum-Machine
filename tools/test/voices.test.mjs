#!/usr/bin/env node
/**
 * voices.test.mjs — the two new synthesis voices and the per-track engine
 * overrides (roadmap items 3.2 / 4.x): granular percussion, Karplus-Strong,
 * wavetable, ring modulation, frequency shifting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeAudioContext, FakeEvent, serializeEvents } from './harness.mjs';

const seeded = (app, seed) => {
  const next = app.BureauEngine.mulberry32(seed);
  return () => next();
};

test('the bureau runs eight lanes with the two new voices', () => {
  const { app } = loadApp();
  const { bureau } = app;
  assert.equal(bureau.tracks.length, 8);
  assert.equal(bureau.tracks[6].id, 'gran');
  assert.equal(bureau.tracks[7].id, 'pluck');
  assert.equal(bureau.trackChains ? bureau.trackChains.length : 8, 8);
});

test('synthGran fires a bounded burst of grains from a shared seeded buffer', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  bureau.synthGran(ctx, dest, 0, 1, 1, seeded(app, 3), null);
  const sources = ctx.nodes.filter((n) => n.nodeKind === 'bufferSource');
  assert.ok(sources.length >= 5 && sources.length <= 18, `grain count bounded (${sources.length})`);
  assert.ok(sources.every((s) => s.buffer), 'every grain reads the shared buffer');
  assert.equal(new Set(sources.map((s) => s.buffer)).size, 1, 'one memoised buffer for all grains');

  // The buffer is memoised per context.
  const ctx2 = new FakeAudioContext();
  bureau.synthGran(ctx2, ctx2.createGain(), 0, 1, 1, seeded(app, 3), null);
  const buf2 = ctx2.nodes.find((n) => n.nodeKind === 'bufferSource').buffer;
  bureau.synthGran(ctx2, ctx2.createGain(), 0, 1, 1, seeded(app, 3), null);
  const buf2b = ctx2.nodes.filter((n) => n.nodeKind === 'bufferSource').pop().buffer;
  assert.equal(buf2, buf2b, 'buffer memoised across hits on the same context');

  // Grains stay inside the burst window.
  const starts = ctx.events.filter((e) => e.kind === 'bufferStart').map((e) => e.time);
  assert.ok(starts.every((t) => t >= 0 && t <= 0.06), 'grains inside the burst');
});

test('synthGran is deterministic under a seeded rand', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const a = new FakeAudioContext();
  const b = new FakeAudioContext();
  bureau.synthGran(a, a.createGain(), 0.25, 0.8, 1, seeded(app, 99), null);
  bureau.synthGran(b, b.createGain(), 0.25, 0.8, 1, seeded(app, 99), null);
  assert.deepEqual(serializeEvents(a), serializeEvents(b), 'same seed, same grains');
});

test('synthPluck is a capped Karplus-Strong loop and stays deterministic', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();

  bureau.synthPluck(ctx, ctx.createGain(), 0, 1, 1, seeded(app, 5), null);
  const src = ctx.nodes.find((n) => n.nodeKind === 'bufferSource');
  assert.equal(src.loop, true, 'noise source loops');
  const feedback = ctx.nodes.find((n) =>
    n.nodeKind === 'gain' && n.outputs.some((o) => o.nodeKind === 'biquadFilter'));
  assert.ok(feedback, 'feedback gain routes back into the damping filter');
  assert.ok(feedback.gain.value <= 0.995, `feedback capped below unity (${feedback.gain.value})`);

  // The decay lock raises sustain but never past the cap.
  const ctx2 = new FakeAudioContext();
  bureau.synthPluck(ctx2, ctx2.createGain(), 0, 1, 1, seeded(app, 5),
    { freqMul: 1, fmDepth: 1, decay: 4, cutoff: null, res: null, dist: 0 });
  const fb2 = ctx2.nodes.find((n) =>
    n.nodeKind === 'gain' && n.outputs.some((o) => o.nodeKind === 'biquadFilter'));
  assert.equal(fb2.gain.value, 0.995, 'decay 4 hits the feedback cap exactly');

  const a = new FakeAudioContext();
  const b = new FakeAudioContext();
  bureau.synthPluck(a, a.createGain(), 0.1, 0.9, 1, seeded(app, 7), null);
  bureau.synthPluck(b, b.createGain(), 0.1, 0.9, 1, seeded(app, 7), null);
  assert.deepEqual(serializeEvents(a), serializeEvents(b), 'same seed, same pluck');
});

test('the wavetable engine crossfades two PeriodicWave spectra', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();

  bureau.synthWavetable(ctx, ctx.createGain(), 0, 1, 1, seeded(app, 1), null, 0.25);
  const oscs = ctx.nodes.filter((n) => n.nodeKind === 'oscillator');
  assert.equal(oscs.length, 2, 'two wavetable oscillators');
  assert.ok(oscs.every((o) => o.periodicWave), 'both use PeriodicWaves');
  assert.notEqual(oscs[0].periodicWave, oscs[1].periodicWave, 'contrasting spectra');
  const gains = ctx.nodes.filter((n) => n.nodeKind === 'gain' && n.gain.value !== undefined);
  const crossfade = gains.filter((g) => g.gain.value === 0.75 || g.gain.value === 0.25);
  assert.equal(crossfade.length, 2, 'engineParam 0.25 crossfades 75/25');
  const sum = crossfade.reduce((acc, g) => acc + g.gain.value, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'crossfade gains sum to unity');

  // Waves are memoised per context.
  const ctx2 = new FakeAudioContext();
  bureau.synthWavetable(ctx2, ctx2.createGain(), 0, 1, 1, seeded(app, 1), null, 0.5);
  const w1 = bureau.wavetablesFor(ctx);
  const w2 = bureau.wavetablesFor(ctx);
  assert.equal(w1, w2, 'wavetables memoised');
});

test('ringmod multiplies the voice by a sine carrier', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const tap = ctx.createGain();

  const out = bureau.buildEngineProcessor(ctx, tap, 'ringmod', 0.5, 1, 1.0);
  assert.ok(tap.outputs.includes(out), 'voice feeds the ringmod gain');
  const carrier = ctx.nodes.find((n) => n.nodeKind === 'oscillator');
  assert.equal(carrier.type, 'sine');
  assert.ok(carrier.frequency.value > 40 && carrier.frequency.value < 1000, 'carrier in the mapped range');
  const depth = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.outputs.includes(out.gain));
  assert.ok(depth, 'carrier depth drives the gain AudioParam (true ring modulation)');
  assert.equal(out.gain.value, 1, 'base gain unity');
});

test('fshift builds the dual-delay single-sideband shifter', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const tap = ctx.createGain();

  const out = bureau.buildEngineProcessor(ctx, tap, 'fshift', 0.5, 1, 1.0);
  const delays = ctx.nodes.filter((n) => n.nodeKind === 'delay');
  assert.equal(delays.length, 2, 'two delay taps');
  assert.ok(delays.every((d) => d.outputs.length === 1), 'each tap feeds one crossfade gain');
  const oscs = ctx.nodes.filter((n) => n.nodeKind === 'oscillator');
  assert.equal(oscs.length, 2, 'saw LFO + triangle crossfade');
  assert.ok(tap.outputs.includes(delays[0]) && tap.outputs.includes(delays[1]), 'voice feeds both taps');
  // engineParam 0.5 → rate 15.25 Hz.
  assert.ok(Math.abs(oscs[0].frequency.value - 15.25) < 1e-9, 'rate mapped from engineParam');
});

test('playTrackSound honours the per-track engine override', () => {
  const { app } = loadApp();
  const { bureau } = app;

  // wavetable replaces the lane's voice entirely.
  bureau.tracks[0].engine = 'wavetable';
  bureau.tracks[0].engineParam = 0.5;
  const ctx = new FakeAudioContext();
  bureau.playTrackSound(0, 0, { vel: 100, pitchOffset: 0 }, ctx, ctx.createGain(), seeded(app, 1));
  const oscs = ctx.nodes.filter((n) => n.nodeKind === 'oscillator');
  assert.equal(oscs.length, 2, 'wavetable engine: two periodic-wave oscs');
  assert.ok(oscs.every((o) => o.periodicWave), 'not the kick voice (no plain oscs)');

  // ringmod processes the voice output.
  bureau.tracks[0].engine = 'ringmod';
  const ctx2 = new FakeAudioContext();
  bureau.playTrackSound(0, 0, { vel: 100, pitchOffset: 0 }, ctx2, ctx2.createGain(), seeded(app, 1));
  const carrier = ctx2.nodes.find((n) => n.nodeKind === 'oscillator' && n.type === 'sine' && n.outputs.length > 0);
  assert.ok(carrier, 'ringmod carrier present alongside the voice');
  const kickOsc = ctx2.nodes.filter((n) => n.nodeKind === 'oscillator').length;
  assert.ok(kickOsc >= 3, 'kick voice (2 oscs) + carrier (1 osc)');

  // default engine: no carrier, no extra oscs.
  bureau.tracks[0].engine = 'default';
  const ctx3 = new FakeAudioContext();
  bureau.playTrackSound(0, 0, { vel: 100, pitchOffset: 0 }, ctx3, ctx3.createGain(), seeded(app, 1));
  assert.equal(ctx3.nodes.filter((n) => n.nodeKind === 'oscillator').length, 2, 'default: kick voice only');
});

test('engines compose with the parameter locks', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.tracks[5].engine = 'ringmod';
  const locks = {
    freq: { on: true, value: 100 }, fm: { on: false, value: 1 }, decay: { on: true, value: 2 },
    cutoff: { on: true, value: 3000 }, res: { on: true, value: 5 }, dist: { on: true, value: 0.4 }
  };
  const ctx = new FakeAudioContext();
  bureau.playTrackSound(5, 0, { vel: 100, pitchOffset: 0, locks }, ctx, ctx.createGain(), seeded(app, 2));
  // Lock chain + engine both present: filter, shaper, ringmod gain, carrier.
  assert.ok(ctx.nodes.some((n) => n.nodeKind === 'biquadFilter' && n.type === 'lowpass' && n.frequency.value === 3000), 'lock filter present');
  assert.ok(ctx.nodes.some((n) => n.nodeKind === 'waveShaper' && n.curve), 'lock shaper present');
  assert.ok(ctx.nodes.some((n) => n.nodeKind === 'oscillator' && n.type === 'sine'), 'ringmod carrier present');
});

test('Case 22 loads with all eight lanes populated', () => {
  const { app, document } = loadApp();
  app.loadPreset('granlab');
  const { bureau } = app;
  assert.equal(bureau.bpm, 152);
  assert.equal(bureau.tracks.length, 8);
  assert.equal(bureau.tracks[6].currentLength, 16);
  assert.ok(bureau.tracks[6].steps.slice(0, 16).some((s) => s.active), 'gran lane has hits');
  assert.ok(bureau.tracks[7].steps.slice(0, 16).some((s) => s.active), 'pluck lane has hits');
  assert.equal(document.querySelectorAll('.step-lane').length, 8, 'grid renders eight lanes');
  assert.equal(document.getElementById('presetSelect').value, 'granlab');
});

test('loading a preset resets lane engines and chain settings', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.initAudio();
  bureau.tracks[6].engine = 'fshift';
  bureau.tracks[6].engineParam = 0.9;
  bureau.tracks[6].fx.cutoff = 1000;
  app.loadPreset('confield');
  assert.equal(bureau.tracks[6].engine, 'default', 'engine reset');
  assert.equal(bureau.tracks[6].engineParam, 0.5, 'engineParam reset');
  assert.equal(bureau.tracks[6].fx.cutoff, 18000, 'chain fx reset');
  assert.equal(bureau.trackChains[6].filter.frequency.value, 18000, 'live chain follows');
});

test('the engine controls write the focused lane and are undoable', () => {
  const { app, document } = loadApp();
  const { bureau } = app;

  app.selectStep(6, 0);
  const engineSelect = document.getElementById('tfEngine');
  assert.equal(engineSelect.value, 'default');
  engineSelect.value = 'wavetable';
  engineSelect.dispatchEvent(new FakeEvent('change', { target: engineSelect }));
  assert.equal(bureau.tracks[6].engine, 'wavetable');
  assert.equal(document.getElementById('tfEngineParamLabel').innerText, 'MORPH', 'param label follows the engine');

  const param = document.getElementById('tfEngineParam');
  param.value = 80;
  param.dispatchEvent(new FakeEvent('input', { target: param }));
  param.dispatchEvent(new FakeEvent('change', { target: param })); // release = one history entry
  assert.equal(bureau.tracks[6].engineParam, 0.8);
  assert.equal(document.getElementById('tfEngineParamVal').innerText, '80%', 'wavetable param formats as a morph');

  engineSelect.value = 'ringmod';
  engineSelect.dispatchEvent(new FakeEvent('change', { target: engineSelect }));
  param.value = 50;
  param.dispatchEvent(new FakeEvent('input', { target: param }));
  assert.equal(document.getElementById('tfEngineParamVal').innerText,
    `${Math.round(40 * Math.pow(25, 0.5))} Hz`, 'ringmod param formats as carrier frequency');

  // selectStep reflects the stored engine.
  app.selectStep(6, 0);
  assert.equal(document.getElementById('tfEngine').value, 'ringmod');
  assert.equal(document.getElementById('tfEngineParam').value, 50);

  bureau.undo(); // param change
  assert.equal(bureau.tracks[6].engineParam, 0.8);
  bureau.undo(); // engine change
  assert.equal(bureau.tracks[6].engine, 'wavetable');
});

test('engines and voices survive the session round-trip', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.tracks[6].engine = 'wavetable';
  bureau.tracks[6].engineParam = 0.3;
  bureau.tracks[7].engine = 'fshift';
  const doc = bureau.serializeSession();
  app.loadPreset('empty');
  bureau.applySession(doc);
  assert.equal(bureau.tracks[6].engine, 'wavetable');
  assert.equal(bureau.tracks[6].engineParam, 0.3);
  assert.equal(bureau.tracks[7].engine, 'fshift');
  assert.equal(bureau.tracks.length, 8, 'eight lanes round-trip');
});

test('a pattern with new voices and engines renders deterministically offline', async () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('granlab');
  bureau.tracks[0].engine = 'ringmod';
  bureau.tracks[5].engine = 'wavetable';
  bureau.tracks[5].engineParam = 0.7;

  const r1 = await bureau.exportWav(1, null, { seed: 31 });
  const r2 = await bureau.exportWav(1, null, { seed: 31 });
  const b1 = Buffer.from(await r1.blob.arrayBuffer());
  const b2 = Buffer.from(await r2.blob.arrayBuffer());
  assert.ok(b1.equals(b2), 'same seed, byte-identical bounce with new voices + engines');
  assert.ok(b1.length > 1000, 'audio present');
});
