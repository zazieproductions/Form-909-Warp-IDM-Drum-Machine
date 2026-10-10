#!/usr/bin/env node
/**
 * determinism.test.mjs — the offline render must be reproducible.
 *
 * Tier 1 of docs/TESTING.md §7: same state + same seed ⇒ identical bytes;
 * different seed ⇒ different bytes; WAV header matches the request; the
 * rendered signal is finite and bounded. These tests run against the fake
 * OfflineAudioContext, which renders a deterministic function of the recorded
 * schedule — so byte-identity here proves the app's schedule is identical,
 * which is the property the real renderer inherits.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, FakeAudioContext, serializeEvents } from './harness.mjs';

function parseWavHeader(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (off, len) => Array.from(bytes.subarray(off, off + len), (b) => String.fromCharCode(b)).join('');
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(36, 4),
    dataBytes: view.getUint32(40, true)
  };
}

test('two renders with the same seed are byte-identical', async () => {
  const { app } = loadApp();
  app.loadPreset('confield');
  const a = await app.bureau.exportWav(2, null, { seed: 42 });
  const b = await app.bureau.exportWav(2, null, { seed: 42 });
  const [bufA, bufB] = await Promise.all([a.blob.arrayBuffer(), b.blob.arrayBuffer()]);
  assert.deepEqual(Buffer.from(bufA), Buffer.from(bufB), 'same seed ⇒ identical WAV bytes');
  assert.equal(a.seed, 42);
});

test('a different seed produces different bytes (the RNG is actually consumed)', async () => {
  const { app } = loadApp();
  app.loadPreset('confield');
  const a = await app.bureau.exportWav(2, null, { seed: 42 });
  const c = await app.bureau.exportWav(2, null, { seed: 43 });
  const [bufA, bufC] = await Promise.all([a.blob.arrayBuffer(), c.blob.arrayBuffer()]);
  assert.notDeepEqual(Buffer.from(bufA), Buffer.from(bufC), 'different seed ⇒ different bytes');
});

test('the WAV header matches the requested sample rate and bit depth', async () => {
  const { app } = loadApp();
  app.loadPreset('raster');

  const h48 = parseWavHeader(await (await app.bureau.exportWav(1, null, { seed: 7 })).blob.arrayBuffer());
  assert.equal(h48.riff, 'RIFF');
  assert.equal(h48.wave, 'WAVE');
  assert.equal(h48.fmt, 'fmt ');
  assert.equal(h48.channels, 2);
  assert.equal(h48.sampleRate, 48000);
  assert.equal(h48.bitsPerSample, 24);
  assert.equal(h48.blockAlign, 6);
  assert.equal(h48.data, 'data');

  const h44 = parseWavHeader(await (await app.bureau.exportWav(1, null, { seed: 7, sampleRate: 44100, bitDepth: 16 })).blob.arrayBuffer());
  assert.equal(h44.sampleRate, 44100);
  assert.equal(h44.bitsPerSample, 16);
  assert.equal(h44.blockAlign, 4);
});

test('the rendered signal is finite, non-silent and bounded', async () => {
  const { app } = loadApp();
  app.loadPreset('drukqs');
  const { blob, duration } = await app.bureau.exportWav(2, null, { seed: 99 });
  const bytes = Buffer.from(await blob.arrayBuffer());
  const header = parseWavHeader(bytes);
  assert.equal(bytes.length, 44 + header.dataBytes, 'file size matches the header');

  // Decode 24-bit samples and measure.
  const bytesPerSample = 3;
  const frames = Math.floor(header.dataBytes / header.blockAlign);
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < header.channels; ch++) {
      const off = 44 + (i * header.channels + ch) * bytesPerSample;
      let v = bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16);
      if (v & 0x800000) v |= ~0xffffff; // sign-extend
      const s = v / 0x800000;
      assert.ok(Number.isFinite(s), 'no NaN/Infinity samples');
      peak = Math.max(peak, Math.abs(s));
      sumSq += s * s;
    }
  }
  const rms = Math.sqrt(sumSq / (frames * header.channels));
  assert.ok(peak > 0.01, `signal is audible (peak ${peak.toFixed(3)})`);
  assert.ok(peak <= 1.0, `signal is not clipped (peak ${peak.toFixed(3)})`);
  assert.ok(rms > 0.001, `signal has energy (rms ${rms.toFixed(4)})`);
  assert.ok(duration > 1, 'duration includes the tail');
});

test('voice generators are deterministic under a seeded rand stream', () => {
  const { app } = loadApp();
  const step = { active: true, vel: 100, ratchet: 1, prob: 100, pitchOffset: 0 };

  // The glitch voice randomises its waveform, frequency and filter per hit.
  const ctxA = new FakeAudioContext();
  const ctxB = new FakeAudioContext();
  app.bureau.playTrackSound(4, 0.1, step, ctxA, ctxA.destination, app.BureauEngine.mulberry32(7));
  app.bureau.playTrackSound(4, 0.1, step, ctxB, ctxB.destination, app.BureauEngine.mulberry32(7));
  assert.deepEqual(serializeEvents(ctxA), serializeEvents(ctxB), 'same seed ⇒ identical voice schedule');

  const ctxC = new FakeAudioContext();
  app.bureau.playTrackSound(4, 0.1, step, ctxC, ctxC.destination, app.BureauEngine.mulberry32(8));
  assert.notDeepEqual(serializeEvents(ctxA), serializeEvents(ctxC), 'different seed ⇒ different timbre');

  // The kick's noise click and the snare's noise buffer are seeded too.
  const ctxD = new FakeAudioContext();
  const ctxE = new FakeAudioContext();
  app.bureau.playTrackSound(0, 0.1, step, ctxD, ctxD.destination, app.BureauEngine.mulberry32(11));
  app.bureau.playTrackSound(0, 0.1, step, ctxE, ctxE.destination, app.BureauEngine.mulberry32(11));
  assert.deepEqual(serializeEvents(ctxD), serializeEvents(ctxE), 'kick click noise is seeded');

  const ctxF = new FakeAudioContext();
  const ctxG = new FakeAudioContext();
  app.bureau.playTrackSound(1, 0.1, step, ctxF, ctxF.destination, app.BureauEngine.mulberry32(13));
  app.bureau.playTrackSound(1, 0.1, step, ctxG, ctxG.destination, app.BureauEngine.mulberry32(13));
  assert.deepEqual(serializeEvents(ctxF), serializeEvents(ctxG), 'snare noise buffer is seeded');
});

test('scheduleStep honours an injected rand stream', () => {
  const { app } = loadApp();
  app.bureau.initAudio();
  app.bureau.tracks[0].steps[0].active = true;
  app.bureau.tracks[0].steps[0].prob = 50;

  const ctxA = app.bureau.audioCtx;
  const eventsBefore = ctxA.events.length;
  const rand = app.BureauEngine.mulberry32(3);
  app.bureau.scheduleStep(0, 0.5, rand);
  assert.ok(ctxA.events.length > eventsBefore, 'a trigger was scheduled');

  // prob = 0 must never fire, regardless of the stream. Isolate lane 0 so
  // events from the other lanes cannot mask the assertion.
  for (let i = 1; i < app.bureau.tracks.length; i++) app.bureau.tracks[i].mute = true;
  app.bureau.tracks[0].steps[1].active = true;
  app.bureau.tracks[0].steps[1].prob = 0;
  const before = ctxA.events.length;
  for (let s = 0; s < 64; s++) app.bureau.scheduleStep(1 + s * 16, 1 + s * 0.089, app.BureauEngine.mulberry32(s));
  assert.equal(ctxA.events.length, before, 'probability 0 never fires');

  // And with prob = 100 it must fire on every cycle.
  app.bureau.tracks[0].steps[1].prob = 100;
  const beforeAlways = ctxA.events.length;
  for (let s = 0; s < 32; s++) app.bureau.scheduleStep(1 + s * 16, 1 + s * 0.089, app.BureauEngine.mulberry32(s));
  assert.ok(ctxA.events.length > beforeAlways, 'probability 100 always fires');
});

test('mulberry32 is uniform and bounded', () => {
  const rand = loadApp().app.BureauEngine.mulberry32(1234);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const v = rand();
    assert.ok(v >= 0 && v < 1, 'value in [0, 1)');
    sum += v;
  }
  const mean = sum / n;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ≈ 0.5 (got ${mean.toFixed(4)})`);
});
