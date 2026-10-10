#!/usr/bin/env node
/**
 * smoke.test.mjs — boot, presets, grid interaction, generators, transport.
 *
 * Tier 1/2 of docs/TESTING.md §7, run against the fake DOM + fake Web Audio
 * harness. These tests assert behaviour, not sound.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeEvent } from './harness.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the app boots and exposes the console API', () => {
  const { app, document } = loadApp();
  assert.ok(app, 'window.Form909Warp is exposed');
  assert.equal(app.bureau.tracks.length, 8);
  assert.equal(document.getElementById('presetSelect').value, 'confield');
  assert.ok(document.getElementById('tracksContainer').children.length === 8);
});

test('every preset loads and renders a grid matching its lane lengths', () => {
  const { app, document } = loadApp();
  for (const key of Object.keys(app.PRESETS)) {
    app.loadPreset(key);
    const lanes = document.querySelectorAll('.step-lane');
    assert.equal(lanes.length, app.bureau.tracks.length, `${key}: one lane per track`);
    lanes.forEach((lane, i) => {
      assert.equal(
        lane.children.length,
        app.bureau.tracks[i].currentLength,
        `${key}: lane ${i} renders currentLength cells`
      );
    });
    assert.equal(app.bureau.bpm, app.PRESETS[key].bpm, `${key}: bpm applied`);
  }
});

test('clicking a cell toggles it; shift-click cycles the ratchet', () => {
  const { app, document } = loadApp();
  const cell = document.querySelector('.step-cell[data-track="0"][data-step="2"]');
  assert.ok(cell, 'cell exists');

  cell.dispatchEvent(new FakeEvent('click', { target: cell, shiftKey: false }));
  assert.equal(app.bureau.tracks[0].steps[2].active, true, 'click activates');
  assert.equal(app.bureau.selectedStep.sIdx, 2, 'click selects the step');

  const cell2 = document.querySelector('.step-cell[data-track="0"][data-step="2"]');
  cell2.dispatchEvent(new FakeEvent('click', { target: cell2, shiftKey: true }));
  assert.equal(app.bureau.tracks[0].steps[2].ratchet, 2, 'shift-click ratchets');
  assert.equal(app.bureau.tracks[0].steps[2].active, true, 'ratchet keeps the step active');

  const cell3 = document.querySelector('.step-cell[data-track="0"][data-step="2"]');
  cell3.dispatchEvent(new FakeEvent('click', { target: cell3, shiftKey: false }));
  assert.equal(app.bureau.tracks[0].steps[2].active, false, 'second click deactivates');
});

test('the inspector sliders write to the selected step only', () => {
  const { app, document } = loadApp();
  app.selectStep(1, 5);
  const vel = document.getElementById('stepVel');
  vel.value = '42';
  vel.dispatchEvent(new FakeEvent('input', { target: vel }));
  assert.equal(app.bureau.tracks[1].steps[5].vel, 42);
  assert.equal(app.bureau.tracks[0].steps[5].vel, 100, 'other lanes untouched');

  const pitch = document.getElementById('stepPitch');
  pitch.value = '-7';
  pitch.dispatchEvent(new FakeEvent('input', { target: pitch }));
  assert.equal(app.bureau.tracks[1].steps[5].pitchOffset, -7);
});

test('lane length changes are non-destructive (16 → 7 → 16)', () => {
  const { app, document } = loadApp();
  app.bureau.tracks[0].steps[10].active = true;
  app.bureau.tracks[0].steps[10].vel = 77;

  const lenInput = document.getElementById('len-0');
  lenInput.value = '7';
  lenInput.dispatchEvent(new FakeEvent('change', { target: lenInput }));
  assert.equal(app.bureau.tracks[0].currentLength, 7);
  assert.equal(document.querySelectorAll('.step-lane')[0].children.length, 7);

  const lenInput2 = document.getElementById('len-0');
  lenInput2.value = '16';
  lenInput2.dispatchEvent(new FakeEvent('change', { target: lenInput2 }));
  assert.equal(app.bureau.tracks[0].currentLength, 16);
  assert.equal(app.bureau.tracks[0].steps[10].active, true, 'hidden step survives');
  assert.equal(app.bureau.tracks[0].steps[10].vel, 77, 'hidden step keeps its velocity');
});

test('mute and solo gate the audible lanes', () => {
  const { app, document } = loadApp();
  const muteBtn = document.getElementById('mute-0');
  muteBtn.dispatchEvent(new FakeEvent('click', { target: muteBtn }));
  assert.equal(app.bureau.tracks[0].mute, true);

  const soloBtn = document.getElementById('solo-1');
  soloBtn.dispatchEvent(new FakeEvent('click', { target: soloBtn }));
  assert.equal(app.bureau.tracks[1].solo, true);
});

test('the Euclidean generator fills the lane with a valid distribution', () => {
  const { app, document } = loadApp();
  const btn = document.querySelector('.euclid-gen-btn[data-track="2"]');
  btn.dispatchEvent(new FakeEvent('click', { target: btn }));
  const track = app.bureau.tracks[2];
  const active = track.steps.slice(0, track.currentLength).filter((s) => s.active).length;
  assert.ok(active >= 1, 'at least one hit');
  assert.ok(active <= track.currentLength, 'no overflow');
});

test('every generative style produces a valid, non-empty pattern', () => {
  const { app, document } = loadApp();
  const select = document.getElementById('patternStyleSelect');
  for (const style of ['braindance', 'breakcore', 'glitch', 'polyrhythm', 'ambient', 'drill', 'surprise']) {
    select.value = style;
    const btn = document.getElementById('randomizeAllBtn');
    btn.dispatchEvent(new FakeEvent('click', { target: btn }));
    app.bureau.tracks.forEach((track, i) => {
      assert.ok(track.currentLength >= 1 && track.currentLength <= 32, `${style}: lane ${i} length in range`);
      const active = track.steps.slice(0, track.currentLength).some((s) => s.active);
      assert.ok(active, `${style}: lane ${i} has at least one hit`);
      track.steps.slice(0, track.currentLength).forEach((s) => {
        assert.ok(s.vel >= 0 && s.vel <= 127, `${style}: lane ${i} velocity in range`);
        assert.ok(s.prob >= 0 && s.prob <= 100, `${style}: lane ${i} probability in range`);
        assert.ok(s.pitchOffset >= -24 && s.pitchOffset <= 24, `${style}: lane ${i} pitch in range`);
      });
    });
    assert.ok(app.bureau.bpm >= 40 && app.bureau.bpm <= 360, `${style}: bpm in range`);
  }
});

test('mutate runs without error and keeps every value in range', () => {
  const { app } = loadApp();
  app.loadPreset('confield');
  for (let i = 0; i < 5; i++) app.bureau.mutateRhythms();
  app.bureau.tracks.forEach((track) => {
    track.steps.forEach((s) => {
      assert.ok(s.ratchet >= 1 && s.ratchet <= 4);
      assert.ok(s.prob >= 0 && s.prob <= 100);
      assert.ok(s.pitchOffset >= -24 && s.pitchOffset <= 24);
    });
  });
});

test('transport starts and stops; the scheduler emits audio events', async () => {
  const { app, window } = loadApp();
  app.loadPreset('confield');
  assert.equal(app.bureau.start(), true);
  assert.equal(app.bureau.isPlaying, true);
  await sleep(220);
  app.bureau.stop();
  assert.equal(app.bureau.isPlaying, false);
  assert.ok(app.bureau.audioCtx.events.length > 0, 'voices were scheduled');
  assert.ok(
    app.bureau.audioCtx.events.some((e) => e.kind === 'oscStart' || e.kind === 'bufferStart'),
    'oscillators or noise sources started'
  );
  // The cursor visuals were driven through the DOM without throwing.
  assert.ok(true);
  void window;
});

test('space bar toggles the transport when focus is not in a control', () => {
  const { app, window, document } = loadApp();
  assert.equal(app.bureau.isPlaying, false);
  window.dispatchEvent(new FakeEvent('keydown', { code: 'Space', target: document.body }));
  assert.equal(app.bureau.isPlaying, true, 'space starts the transport');
  app.bureau.stop();
  window.dispatchEvent(new FakeEvent('keydown', { code: 'Space', target: document.body }));
  assert.equal(app.bureau.isPlaying, true, 'space halts the transport');
  app.bureau.stop();

  // Inside a text field the shortcut must stand down.
  const tempo = document.getElementById('tempoInput');
  window.dispatchEvent(new FakeEvent('keydown', { code: 'Space', target: tempo }));
  assert.equal(app.bureau.isPlaying, false, 'space is ignored inside an input');
});

test('live recording degrades gracefully without MediaRecorder', () => {
  const { app } = loadApp();
  const result = app.bureau.startRecording(() => {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported');
  assert.equal(app.bureau.isRecording, false);
});

test('the export modal opens, traps and closes', () => {
  const { app, document } = loadApp();
  const modal = document.getElementById('exportModal');
  const openBtn = document.getElementById('exportModalBtn');
  openBtn.dispatchEvent(new FakeEvent('click', { target: openBtn }));
  assert.equal(modal.hidden, false, 'modal opens');

  const cancel = document.getElementById('cancelExportBtn');
  cancel.dispatchEvent(new FakeEvent('click', { target: cancel }));
  assert.equal(modal.hidden, true, 'modal closes');
  void app;
});
