#!/usr/bin/env node
/**
 * mod.test.mjs — the modulation matrix (roadmap item 2.7): LFO, sample &
 * hold, random walk and envelope follower sources, assignable destinations,
 * polarity, live updates, serialization and offline determinism.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeAudioContext, FakeEvent } from './harness.mjs';

test('the bureau starts with five inert modulation sources', () => {
  const { app } = loadApp();
  const { bureau } = app;
  assert.equal(bureau.mod.sources.length, 5);
  assert.ok(bureau.mod.sources.every((s) => s.on === false && s.depth === 0));
});

test('resolveModDest maps master and per-track destinations', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const graph = bureau.buildAudioGraph(ctx);

  const masterCutoff = app.BureauEngine.resolveModDest('master.cutoff', graph);
  assert.equal(masterCutoff.param, graph.masterFilter.frequency);
  assert.equal(masterCutoff.scale, 4000);

  const masterDelay = app.BureauEngine.resolveModDest('master.delayTime', graph);
  assert.equal(masterDelay.param, graph.delayNode.delayTime);
  assert.equal(masterDelay.scale, 0.1);

  const masterFb = app.BureauEngine.resolveModDest('master.delayFeedback', graph);
  assert.equal(masterFb.param, graph.delayFeedback.gain);

  const masterDrive = app.BureauEngine.resolveModDest('master.drivePre', graph);
  assert.equal(masterDrive.param, graph.drivePre.gain);

  const trackPan = app.BureauEngine.resolveModDest('track.3.pan', graph);
  assert.equal(trackPan.param, graph.trackChains[3].pan.pan);
  assert.equal(trackPan.scale, 1);

  const trackCutoff = app.BureauEngine.resolveModDest('track.6.cutoff', graph);
  assert.equal(trackCutoff.param, graph.trackChains[6].filter.frequency);
  assert.equal(trackCutoff.scale, 4000);

  const trackRes = app.BureauEngine.resolveModDest('track.0.res', graph);
  assert.equal(trackRes.param, graph.trackChains[0].filter.Q);
  assert.equal(trackRes.scale, 3);

  const trackSend = app.BureauEngine.resolveModDest('track.7.delaySend', graph);
  assert.equal(trackSend.param, graph.trackChains[7].delaySend.gain);

  assert.equal(app.BureauEngine.resolveModDest('nonsense', graph), null);
  assert.equal(app.BureauEngine.resolveModDest('track.99.pan', graph), null);
  assert.equal(app.BureauEngine.resolveModDest('master.nonsense', graph), null);
  assert.equal(app.BureauEngine.resolveModDest(null, graph), null);
});

test('an engaged LFO source connects oscillator → depth → destination', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.initAudio();
  bureau.mod.sources[0] = { type: 'lfo', rate: 3, shape: 'triangle', depth: 0.5, dest: 'master.cutoff', polarity: 'bipolar', on: true };
  bureau.rebuildModulation(bureau.graph);

  const bundles = bureau.graph.modBundles;
  assert.equal(bundles.length, 1, 'one connected source');
  const osc = bundles[0].nodes.find((n) => n.nodeKind === 'oscillator');
  assert.equal(osc.type, 'triangle');
  assert.equal(osc.frequency.value, 3);
  const depthGain = bundles[0].nodes.find((n) => n.nodeKind === 'gain' && n.outputs.includes(bureau.masterFilter.frequency));
  assert.ok(depthGain, 'depth gain feeds the master filter frequency');
  assert.equal(depthGain.gain.value, 0.5 * 4000, 'depth scales by the destination unit');

  // Disengaging tears the bundle down.
  bureau.mod.sources[0].on = false;
  bureau.rebuildModulation(bureau.graph);
  assert.equal(bureau.graph.modBundles.length, 0, 'off sources are disconnected');
  assert.equal(bureau.masterFilter.frequency.inputs.length, 0, 'destination freed');
});

test('unipolar sources route through the [0,1] ramp shaper', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.initAudio();
  bureau.mod.sources[1] = { type: 'lfo', rate: 1, shape: 'sine', depth: 0.4, dest: 'track.2.pan', polarity: 'unipolar', on: true };
  bureau.rebuildModulation(bureau.graph);

  const bundle = bureau.graph.modBundles[0];
  const shaper = bundle.nodes.find((n) => n.nodeKind === 'waveShaper');
  assert.ok(shaper, 'unipolar inserts the ramp shaper');
  assert.ok(ArrayBuffer.isView(shaper.curve), 'ramp curve assigned');
  const depthGain = bundle.nodes.find((n) => n.nodeKind === 'gain' && n.outputs.includes(bureau.trackChains[2].pan.pan));
  assert.equal(depthGain.gain.value, 0.4 * 1, 'pan depth scale is ±1');
});

test('sample & hold and random walk use seeded looped step buffers', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const graph = bureau.buildAudioGraph(ctx);
  bureau.mod.sources[0] = { type: 'sh', rate: 4, shape: 'sine', depth: 0.6, dest: 'master.delayTime', polarity: 'bipolar', on: true };
  bureau.mod.sources[1] = { type: 'walk', rate: 4, shape: 'sine', depth: 0.6, dest: 'track.0.cutoff', polarity: 'bipolar', on: true };
  bureau.rebuildModulation(graph);

  assert.equal(graph.modBundles.length, 2);
  const shBundle = graph.modBundles[0];
  const bs = shBundle.nodes.find((n) => n.nodeKind === 'bufferSource');
  assert.equal(bs.loop, true, 'S&H buffer loops');
  assert.equal(bs.playbackRate.value, 4 / 64, 'playbackRate = rate/64');
  assert.ok(bs.buffer.length >= 64, 'buffer holds the 64 steps');

  const walkBundle = graph.modBundles[1];
  const walkBs = walkBundle.nodes.find((n) => n.nodeKind === 'bufferSource');
  assert.equal(walkBs.loop, true, 'walk buffer loops');
  const smooth = walkBundle.nodes.find((n) => n.nodeKind === 'biquadFilter');
  assert.ok(smooth, 'walk is smoothed by a lowpass');
  assert.equal(smooth.frequency.value, 4 * 16, 'smoothing tracks the rate');

  // The step buffers are deterministic: two contexts get identical content.
  const ctx2 = new FakeAudioContext();
  const entryA = bureau.modBuffersFor(ctx);
  const entryB = bureau.modBuffersFor(ctx2);
  const hash = (arr) => {
    let h = 0;
    for (let i = 0; i < arr.length; i += 97) h = (Math.imul(h, 31) + arr[i]) | 0;
    return h;
  };
  assert.equal(hash(entryA.sh.getChannelData(0)), hash(entryB.sh.getChannelData(0)), 'S&H content is seed-deterministic');
  assert.equal(hash(entryA.walk.getChannelData(0)), hash(entryB.walk.getChannelData(0)), 'walk content is seed-deterministic');
});

test('the envelope follower taps the master bus through abs + lowpass', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.initAudio();
  bureau.mod.sources[2] = { type: 'env', rate: 1, shape: 'sine', depth: 0.8, dest: 'track.1.cutoff', polarity: 'unipolar', on: true };
  bureau.rebuildModulation(bureau.graph);

  const bundle = bureau.graph.modBundles[0];
  const abs = bundle.nodes.find((n) => n.nodeKind === 'waveShaper');
  assert.ok(abs, 'abs shaper present');
  assert.ok(bureau.busIn.outputs.includes(abs), 'follower taps the master bus input');
  const lp = bundle.nodes.find((n) => n.nodeKind === 'biquadFilter');
  assert.ok(lp && abs.outputs.includes(lp), 'abs feeds the lowpass');
  const depthGain = bundle.nodes.find((n) => n.nodeKind === 'gain' && n.outputs.includes(bureau.trackChains[1].filter.frequency));
  assert.equal(depthGain.gain.value, 0.8 * 4000, 'env depth scales to the cutoff unit');
});

test('rate, depth and shape update the live bundles without a rebuild', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.initAudio();
  bureau.mod.sources[0] = { type: 'lfo', rate: 2, shape: 'sine', depth: 0.2, dest: 'master.cutoff', polarity: 'bipolar', on: true };
  bureau.rebuildModulation(bureau.graph);
  const bundle = bureau.graph.modBundles[0];
  const osc = bundle.nodes.find((n) => n.nodeKind === 'oscillator');
  const depthGain = bundle.nodes.find((n) => n.nodeKind === 'gain');

  bureau.mod.sources[0].rate = 7;
  bureau.mod.sources[0].depth = 0.9;
  bureau.mod.sources[0].shape = 'square';
  bureau.updateModBundles(bureau.graph);

  assert.equal(osc.frequency.value, 7, 'rate updated live');
  assert.equal(osc.type, 'square', 'shape updated live');
  assert.equal(depthGain.gain.value, 0.9 * 4000, 'depth updated live');
  assert.equal(bureau.graph.modBundles.length, 1, 'no rebuild happened');
  assert.equal(bureau.graph.modBundles[0], bundle, 'bundle identity preserved');
});

test('the modulation matrix panel drives state and the live graph', () => {
  const { app, document } = loadApp();
  const { bureau } = app;
  bureau.initAudio();

  const list = document.getElementById('modSourceList');
  assert.equal(list.querySelectorAll('.mod-row').length, 5, 'five source rows');

  const toggle = () => list.querySelector('.mod-toggle[data-index="0"]');
  toggle().click();
  assert.equal(bureau.mod.sources[0].on, true, 'toggle engages the source');
  assert.equal(bureau.graph.modBundles.length, 1, 'live graph rebuilt');
  // The matrix re-renders on every change, so re-query the fresh row.
  assert.equal(toggle().getAttribute('aria-pressed'), 'true');

  const destSelect = list.querySelector('.mod-dest[data-index="0"]');
  destSelect.value = 'track.4.pan';
  destSelect.dispatchEvent(new FakeEvent('change', { target: destSelect }));
  assert.equal(bureau.mod.sources[0].dest, 'track.4.pan');
  assert.equal(bureau.graph.modBundles[0].nodes.some((n) => n.outputs.includes(bureau.trackChains[4].pan.pan)), true, 'rerouted to the new destination');

  const depth = list.querySelector('.mod-depth[data-index="0"]');
  depth.value = 60;
  depth.dispatchEvent(new FakeEvent('input', { target: depth }));
  assert.equal(bureau.mod.sources[0].depth, 0.6);
  const row = list.querySelector('.mod-row[data-index="0"]');
  assert.equal(row.querySelector('.mod-depth-val').innerText, '60%', 'depth label updates');

  const rate = list.querySelector('.mod-rate[data-index="0"]');
  rate.value = 45;
  rate.dispatchEvent(new FakeEvent('input', { target: rate }));
  assert.equal(bureau.mod.sources[0].rate, 4.5);
  assert.equal(row.querySelector('.mod-rate-val').innerText, '4.5 Hz');

  const polarity = list.querySelector('.mod-polarity[data-index="0"]');
  polarity.click();
  assert.equal(bureau.mod.sources[0].polarity, 'unipolar', 'polarity toggles');

  // Undo reverses the polarity change.
  bureau.undo();
  assert.equal(bureau.mod.sources[0].polarity, 'bipolar', 'undo restores polarity');
});

test('the modulation matrix round-trips through the session and normalizes', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.mod.sources[0] = { type: 'walk', rate: 6, shape: 'sawtooth', depth: 0.7, dest: 'track.2.res', polarity: 'unipolar', on: true };
  bureau.mod.sources[4] = { type: 'env', rate: 12, shape: 'square', depth: 1, dest: 'master.drivePre', polarity: 'bipolar', on: true };

  const doc = bureau.serializeSession();
  assert.equal(doc.mod.sources.length, 5, 'all five sources serialized');
  app.loadPreset('empty');
  bureau.applySession(doc);
  assert.equal(bureau.mod.sources[0].type, 'walk');
  assert.equal(bureau.mod.sources[0].dest, 'track.2.res');
  assert.equal(bureau.mod.sources[4].on, true);

  // Garbage normalizes to inert defaults.
  const clean = app.BureauEngine.migrateSessionDoc({
    format: 'form909warp.session',
    version: 2,
    mod: { sources: [{ type: 'bogus', rate: 999, depth: 42, dest: 'nope', polarity: 'sideways', on: 1 }] }
  });
  assert.equal(clean.mod.sources.length, 5, 'missing sources padded');
  assert.equal(clean.mod.sources[0].type, 'lfo', 'bad type falls back');
  assert.equal(clean.mod.sources[0].rate, 12, 'rate clamped');
  assert.equal(clean.mod.sources[0].depth, 1, 'depth clamped');
  assert.equal(clean.mod.sources[0].dest, 'master.cutoff', 'bad dest falls back');
  assert.equal(clean.mod.sources[0].polarity, 'bipolar', 'bad polarity falls back');
  assert.equal(clean.mod.sources[0].on, true, 'on coerced from truthy');
});

test('a modulated pattern renders deterministically offline', async () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('granlab');
  bureau.mod.sources[0] = { type: 'lfo', rate: 2.5, shape: 'sine', depth: 0.8, dest: 'master.cutoff', polarity: 'bipolar', on: true };
  bureau.mod.sources[1] = { type: 'sh', rate: 6, shape: 'sine', depth: 0.5, dest: 'track.0.pan', polarity: 'unipolar', on: true };
  bureau.mod.sources[2] = { type: 'walk', rate: 1.5, shape: 'sine', depth: 0.6, dest: 'track.5.delaySend', polarity: 'bipolar', on: true };
  bureau.mod.sources[3] = { type: 'env', rate: 1, shape: 'sine', depth: 0.9, dest: 'track.3.cutoff', polarity: 'unipolar', on: true };

  const r1 = await bureau.exportWav(1, null, { seed: 17 });
  const r2 = await bureau.exportWav(1, null, { seed: 17 });
  const b1 = Buffer.from(await r1.blob.arrayBuffer());
  const b2 = Buffer.from(await r2.blob.arrayBuffer());
  assert.ok(b1.equals(b2), 'same seed, byte-identical bounce with four modulators engaged');
});
