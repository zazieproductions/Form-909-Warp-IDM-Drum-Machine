#!/usr/bin/env node
/**
 * trackfx.test.mjs — per-track effects routing (roadmap item 3.1): the
 * shared buildAudioGraph, per-track chains, the TRACK CHAIN panel, and
 * live/offline parity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeAudioContext, FakeEvent } from './harness.mjs';

test('buildAudioGraph builds the master bus and one chain per track', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const graph = bureau.buildAudioGraph(ctx);

  assert.equal(graph.trackChains.length, 8, 'one chain per lane');
  for (const chain of graph.trackChains) {
    // Routing order: input → filter → drivePre → drive → pan → out → busIn,
    // pan → send → delay.
    assert.ok(chain.input.outputs.includes(chain.filter), 'input feeds the filter');
    assert.ok(chain.filter.outputs.includes(chain.drivePre), 'filter feeds the drive pre-gain');
    assert.ok(chain.drivePre.outputs.includes(chain.driveShaper), 'pre-gain feeds the drive shaper');
    assert.ok(chain.driveShaper.outputs.includes(chain.pan), 'shaper feeds the panner');
    assert.ok(chain.pan.outputs.includes(chain.out), 'panner feeds the output');
    assert.ok(chain.pan.outputs.includes(chain.delaySend), 'panner feeds the delay send');
    assert.ok(chain.out.outputs.includes(graph.busIn), 'chain output joins the master bus');
    assert.ok(chain.delaySend.outputs.includes(graph.delayNode), 'delay send joins the master delay');
  }
  // Master bus signal path.
  assert.ok(graph.busIn.outputs.includes(graph.crushShaper));
  assert.ok(graph.crushShaper.outputs.includes(graph.masterFilter));
  assert.ok(graph.masterFilter.outputs.includes(graph.drivePre), 'master filter feeds the drive pre-gain');
  assert.ok(graph.masterFilter.outputs.includes(graph.delayNode), 'master filter feeds the delay');
  assert.ok(graph.delayNode.outputs.includes(graph.delayFeedback), 'delay feedback loop');
  assert.ok(graph.delayFeedback.outputs.includes(graph.delayNode), 'feedback returns to the delay');
  assert.ok(graph.delayWet.outputs.includes(graph.drivePre), 'delay wet returns through the drive pre-gain');
  assert.ok(graph.drivePre.outputs.includes(graph.driveShaper), 'drive pre-gain feeds the drive shaper');
  assert.equal(graph.drivePre.gain.value, 1, 'drive pre-gain unity by default');
  assert.ok(graph.driveShaper.outputs.includes(graph.limiter));
  assert.ok(graph.limiter.outputs.includes(graph.masterGain));
  assert.equal(graph.masterGain.gain.value, 0.88, 'the 0.88 master trim');
});

test('fresh chains are neutral: existing patterns are untouched', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const graph = bureau.buildAudioGraph(ctx);

  for (const chain of graph.trackChains) {
    assert.equal(chain.filter.type, 'lowpass');
    assert.equal(chain.filter.frequency.value, 18000, 'filter wide open');
    assert.equal(chain.filter.Q.value, 0.7, 'no extra resonance');
    assert.equal(chain.driveShaper.curve, null, 'no per-track distortion (null curve = bypass)');
    assert.equal(chain.pan.pan.value, 0, 'centre');
    assert.equal(chain.delaySend.gain.value, 0, 'no send');
  }
  // The master bus keeps its historic tuning.
  assert.equal(graph.masterFilter.Q.value, 1.8);
  assert.equal(graph.delayWet.gain.value, 0.28);
  assert.equal(graph.limiter.ratio.value, 12);
});

test('applyTrackFx writes the lane parameters into the chain', () => {
  const { app } = loadApp();
  const { bureau } = app;
  const ctx = new FakeAudioContext();
  const graph = bureau.buildAudioGraph(ctx);

  const track = bureau.tracks[2];
  track.fx.cutoff = 2400;
  track.fx.res = 9;
  track.fx.drive = 0.6;
  track.fx.delaySend = 0.45;
  track.fx.pan = -0.7;
  bureau.applyTrackFx(track, graph.trackChains[2]);

  const chain = graph.trackChains[2];
  assert.equal(chain.filter.frequency.value, 2400);
  assert.equal(chain.filter.Q.value, 9);
  assert.ok(ArrayBuffer.isView(chain.driveShaper.curve), 'drive engages the shaper curve');
  assert.equal(chain.delaySend.gain.value, 0.45);
  assert.equal(chain.pan.pan.value, -0.7);

  // Turning drive back off restores the bypass.
  track.fx.drive = 0;
  bureau.applyTrackFx(track, chain);
  assert.equal(chain.driveShaper.curve, null, 'drive 0 is a true bypass');
});

test('voices route through the per-track chain in the live graph', () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('empty');
  bureau.initAudio();
  bureau.bpm = 120;
  bureau.fx.humanize = 0;
  bureau.fx.globalRatchet = 0;
  bureau.resetHistories();

  const step = bureau.tracks[5].steps[0];
  step.active = true;
  step.prob = 100;

  const chain = bureau.trackChains[5];
  const inputsBefore = chain.input.inputs.length;
  bureau.scheduleStep(0, 1.0, () => 0.5);
  assert.ok(chain.input.inputs.length > inputsBefore, 'the voice connects into the chain input');
});

test('the TRACK CHAIN panel edits the focused lane and its live chain', () => {
  const { app, document } = loadApp();
  const { bureau } = app;
  bureau.initAudio();

  // Selecting a step focuses its lane in the panel.
  app.selectStep(3, 0);
  assert.equal(bureau.focusTrack, 3);
  assert.equal(document.getElementById('trackFxLaneName').innerText, bureau.tracks[3].name);

  const cutoff = document.getElementById('tfCutoff');
  cutoff.value = 2400;
  cutoff.dispatchEvent(new FakeEvent('input', { target: cutoff }));
  cutoff.dispatchEvent(new FakeEvent('change', { target: cutoff })); // release = one history entry
  assert.equal(bureau.tracks[3].fx.cutoff, 2400, 'slider writes the lane');
  assert.equal(document.getElementById('tfCutoffVal').innerText, '2.4k', 'label formats');
  assert.equal(bureau.trackChains[3].filter.frequency.value, 2400, 'live chain follows');
  assert.equal(bureau.tracks[2].fx.cutoff, 18000, 'other lanes untouched');

  const pan = document.getElementById('tfPan');
  pan.value = -80;
  pan.dispatchEvent(new FakeEvent('input', { target: pan }));
  assert.equal(bureau.tracks[3].fx.pan, -0.8);
  assert.equal(bureau.trackChains[3].pan.pan.value, -0.8);
  assert.equal(document.getElementById('tfPanVal').innerText, 'L80');

  const drive = document.getElementById('tfDrive');
  drive.value = 65;
  drive.dispatchEvent(new FakeEvent('input', { target: drive }));
  assert.equal(bureau.tracks[3].fx.drive, 0.65);
  assert.ok(ArrayBuffer.isView(bureau.trackChains[3].driveShaper.curve), 'drive curve engaged');

  const send = document.getElementById('tfDelaySend');
  send.value = 30;
  send.dispatchEvent(new FakeEvent('input', { target: send }));
  assert.equal(bureau.trackChains[3].delaySend.gain.value, 0.3, 'send reaches the chain');

  const res = document.getElementById('tfRes');
  res.value = 12.5;
  res.dispatchEvent(new FakeEvent('input', { target: res }));
  assert.equal(bureau.trackChains[3].filter.Q.value, 12.5);

  // Panel edits are undoable.
  const depth = bureau.undoStack.length;
  cutoff.value = 5000;
  cutoff.dispatchEvent(new FakeEvent('input', { target: cutoff }));
  cutoff.dispatchEvent(new FakeEvent('change', { target: cutoff }));
  assert.ok(bureau.undoStack.length > depth, 'change pushes history');
  bureau.undo();
  assert.equal(bureau.tracks[3].fx.cutoff, 2400, 'undo restores the lane value');
});

test('applying a session updates the live chains and the panel', () => {
  const { app, document } = loadApp();
  const { bureau } = app;
  bureau.initAudio();

  const doc = bureau.serializeSession();
  doc.tracks[1].fx.cutoff = 900;
  doc.tracks[1].fx.drive = 0.5;
  doc.tracks[1].fx.pan = 0.9;
  bureau.applySession(doc);

  // applySession pushes state into the live graph itself.
  assert.equal(bureau.trackChains[1].filter.frequency.value, 900, 'chain follows the loaded session');
  assert.ok(ArrayBuffer.isView(bureau.trackChains[1].driveShaper.curve));
  assert.equal(bureau.trackChains[1].pan.pan.value, 0.9);

  // The panel shows the focused lane's loaded values after a UI sync.
  bureau.focusTrack = 1;
  app.syncAllControls();
  assert.equal(document.getElementById('tfCutoffVal').innerText, '900', 'panel synced');
});

test('track fx survives the session round-trip and morphs', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.tracks[4].fx.cutoff = 3000;
  bureau.tracks[4].fx.res = 4;
  bureau.tracks[4].fx.drive = 0.4;
  bureau.tracks[4].fx.delaySend = 0.25;
  bureau.tracks[4].fx.pan = 0.6;
  bureau.storeSnapshot('A');

  // Move everything far away, then morph halfway back.
  bureau.tracks[4].fx.cutoff = 18000;
  bureau.tracks[4].fx.res = 0.7;
  bureau.tracks[4].fx.drive = 0;
  bureau.tracks[4].fx.delaySend = 0;
  bureau.tracks[4].fx.pan = -1;
  bureau.morphTowards('A', 0.5);

  const fx = bureau.tracks[4].fx;
  assert.equal(fx.cutoff, (18000 + 3000) / 2, 'cutoff morphs linearly');
  assert.equal(fx.drive, 0.2, 'drive morphs linearly');
  assert.equal(fx.delaySend, 0.125, 'send morphs linearly');
  assert.ok(Math.abs(fx.pan - (-0.2)) < 1e-9, 'pan morphs linearly');

  const doc = bureau.serializeSession();
  app.loadPreset('empty');
  bureau.applySession(doc);
  assert.equal(bureau.tracks[4].fx.cutoff, (18000 + 3000) / 2, 'round-trips through the session');
});

test('the offline render uses the same graph: per-track chains included', async () => {
  const { app } = loadApp();
  const { bureau } = app;
  app.loadPreset('empty');
  bureau.tracks[0].steps[0].active = true;
  bureau.tracks[0].steps[0].prob = 100;
  bureau.tracks[0].fx.cutoff = 5000;
  bureau.tracks[0].fx.pan = 0.5;

  const result = await bureau.exportWav(1, null, { seed: 5 });
  assert.ok(result.blob.size > 1000, 'render produced audio');

  // A second render of the same state is byte-identical (determinism holds
  // with the shared graph in the offline path).
  const again = await bureau.exportWav(1, null, { seed: 5 });
  const b1 = Buffer.from(await result.blob.arrayBuffer());
  const b2 = Buffer.from(await again.blob.arrayBuffer());
  assert.ok(b1.equals(b2), 'byte-identical bounce with per-track fx engaged');
});
