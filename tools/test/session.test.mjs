#!/usr/bin/env node
/**
 * session.test.mjs — serialisation, migration, snapshots, morph, undo/redo,
 * persistence and the URL fragment codec (roadmap item 2.1 + 2.4).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Push the engine into a distinctive, fully-loaded state. */
function customize(app) {
  const { bureau } = app;
  bureau.bpm = 187;
  bureau.fx.crush = 0.42;
  bureau.fx.swing = 0.31;
  bureau.fx.cutoff = 9000;
  bureau.tracks.forEach((track, tIdx) => {
    track.currentLength = 7 + tIdx;
    track.mute = tIdx === 2;
    track.solo = tIdx === 3;
    track.engine = tIdx === 1 ? 'wavetable' : 'default';
    track.engineParam = 0.25 + tIdx * 0.1;
    track.fx.cutoff = 4000 + tIdx * 1000;
    track.fx.res = 2.5;
    track.fx.drive = 0.4;
    track.fx.delaySend = 0.3;
    track.fx.pan = tIdx % 2 ? 0.5 : -0.5;
    track.steps.forEach((step, sIdx) => {
      step.active = sIdx % 3 === 0;
      step.vel = 40 + sIdx * 2;
      step.ratchet = (sIdx % 4) + 1;
      step.ratchetCurve = ['even', 'accel', 'decel', 'scatter'][sIdx % 4];
      step.prob = 55 + sIdx;
      step.pitchOffset = (sIdx % 5) - 2;
      step.condition = sIdx === 1 ? 'prevCycle' : (sIdx === 4 ? `track:${(tIdx + 1) % 6}` : 'none');
      step.locks.freq.on = sIdx % 2 === 0;
      step.locks.freq.value = 25 * (sIdx % 3) - 25;
      step.locks.fm.on = true;
      step.locks.fm.value = 1.5;
      step.locks.decay.on = sIdx % 2 === 1;
      step.locks.decay.value = 0.5 + sIdx * 0.1;
      step.locks.cutoff.on = sIdx === 2;
      step.locks.cutoff.value = 3000;
      step.locks.res.on = true;
      step.locks.res.value = 8;
      step.locks.dist.on = sIdx === 5;
      step.locks.dist.value = 0.6;
    });
  });
}

test('a session serialises and round-trips exactly', () => {
  const { app } = loadApp();
  customize(app);

  const doc = app.bureau.serializeSession();
  assert.equal(doc.format, 'form909warp.session');
  assert.equal(doc.version, 2);
  assert.equal(doc.bpm, 187);
  assert.equal(doc.tracks.length, 8);

  app.loadPreset('empty');
  assert.equal(app.bureau.bpm, 160, 'state was reset');

  app.bureau.applySession(doc);
  assert.equal(app.bureau.bpm, 187);
  assert.equal(app.bureau.fx.crush, 0.42);
  assert.equal(app.bureau.fx.swing, 0.31);
  app.bureau.tracks.forEach((track, tIdx) => {
    assert.equal(track.currentLength, 7 + tIdx, `lane ${tIdx} length`);
    assert.equal(track.mute, tIdx === 2, `lane ${tIdx} mute`);
    assert.equal(track.solo, tIdx === 3, `lane ${tIdx} solo`);
    assert.equal(track.engine, tIdx === 1 ? 'wavetable' : 'default', `lane ${tIdx} engine`);
    assert.equal(track.fx.cutoff, 4000 + tIdx * 1000, `lane ${tIdx} cutoff`);
    assert.equal(track.fx.pan, tIdx % 2 ? 0.5 : -0.5, `lane ${tIdx} pan`);
    track.steps.forEach((step, sIdx) => {
      assert.equal(step.active, sIdx % 3 === 0, `lane ${tIdx} step ${sIdx} active`);
      assert.equal(step.vel, 40 + sIdx * 2, `lane ${tIdx} step ${sIdx} vel`);
      assert.equal(step.ratchet, (sIdx % 4) + 1, `lane ${tIdx} step ${sIdx} ratchet`);
      assert.equal(step.ratchetCurve, ['even', 'accel', 'decel', 'scatter'][sIdx % 4]);
      assert.equal(step.prob, Math.min(100, 55 + sIdx));
      assert.equal(step.pitchOffset, (sIdx % 5) - 2);
      assert.equal(step.condition, sIdx === 1 ? 'prevCycle' : (sIdx === 4 ? `track:${(tIdx + 1) % 6}` : 'none'));
      assert.equal(step.locks.freq.on, sIdx % 2 === 0);
      assert.equal(step.locks.freq.value, 25 * (sIdx % 3) - 25);
      assert.equal(step.locks.fm.value, 1.5);
      assert.equal(step.locks.cutoff.on, sIdx === 2);
      assert.equal(step.locks.dist.value, 0.6);
    });
  });
});

test('migration upgrades a version-1 pattern document', () => {
  const { app } = loadApp();
  const v1 = {
    format: 'form909warp.pattern',
    version: 1,
    bpm: 174,
    lengths: [16, 16, 16, 12, 14, 16],
    fx: { crush: 0.28, drive: 0.35, humanize: 4, cutoff: 16500, delayTime: 0.18, delayFeedback: 0.32, globalProb: 1.0, globalRatchet: 0.2, swing: 0.16 },
    data: [
      [{ i: 0, r: 1, p: 0 }, { i: 3, r: 2, p: 0 }],
      [{ i: 4, r: 1, p: 0 }],
      [], [], [], []
    ]
  };
  const clean = app.BureauEngine.migrateSessionDoc(v1);
  assert.equal(clean.format, 'form909warp.session');
  assert.equal(clean.version, 2);
  assert.equal(clean.bpm, 174);
  assert.equal(clean.fx.crush, 0.28);
  assert.equal(clean.tracks.length, 8, 'missing lanes are padded with defaults');
  assert.equal(clean.tracks[0].length, 16);
  assert.equal(clean.tracks[3].length, 12);
  assert.equal(clean.tracks[0].steps[0].active, true);
  assert.equal(clean.tracks[0].steps[0].ratchet, 1);
  assert.equal(clean.tracks[0].steps[3].ratchet, 2);
  assert.equal(clean.tracks[1].steps[4].active, true);
  assert.equal(clean.tracks[2].steps.every((s) => !s.active), true, 'empty lane stays empty');
  assert.equal(clean.tracks[5].steps[0].active, false, 'padded lane is inert');
  assert.equal(clean.tracks[5].steps[0].locks.freq.on, false, 'padded lane gets default locks');
  assert.equal(clean.tracks[6].steps[0].active, false, 'seventh lane padded too');
  assert.equal(clean.tracks[7].steps[0].active, false, 'eighth lane padded too');
});

test('migration accepts a bare preset-shaped object', () => {
  const { app } = loadApp();
  const presetShaped = {
    bpm: 150,
    lengths: [16, 16, 16, 16, 16, 16],
    data: [[{ i: 0, v: 90, pr: 80 }], [], [], [], [], []]
  };
  const clean = app.BureauEngine.migrateSessionDoc(presetShaped);
  assert.equal(clean.bpm, 150);
  assert.equal(clean.tracks[0].steps[0].vel, 90);
  assert.equal(clean.tracks[0].steps[0].prob, 80);
});

test('migration rejects garbage and clamps out-of-range values', () => {
  const { app } = loadApp();
  assert.throws(() => app.BureauEngine.migrateSessionDoc(null));
  assert.throws(() => app.BureauEngine.migrateSessionDoc('nope'));
  assert.throws(() => app.BureauEngine.migrateSessionDoc({ format: 'other.thing' }));
  assert.throws(() => app.BureauEngine.migrateSessionDoc([1, 2, 3]));

  const wild = app.BureauEngine.migrateSessionDoc({
    format: 'form909warp.session',
    version: 2,
    bpm: 9999,
    fx: { crush: 42, swing: -3 },
    tracks: [{
      length: 99,
      fx: { cutoff: -5, pan: 12 },
      steps: [{ a: 1, v: 500, r: 99, pr: -5, p: 99, rc: 'bogus', c: 'track:99', l: { freq: [1, 9999] } }]
    }]
  });
  assert.equal(wild.bpm, 360, 'bpm clamped');
  assert.equal(wild.fx.crush, 1, 'crush clamped');
  assert.equal(wild.fx.swing, 0, 'swing clamped');
  assert.equal(wild.tracks[0].length, 32, 'length clamped');
  assert.equal(wild.tracks[0].fx.cutoff, 150, 'track cutoff clamped');
  assert.equal(wild.tracks[0].fx.pan, 1, 'pan clamped');
  const step = wild.tracks[0].steps[0];
  assert.equal(step.vel, 127);
  assert.equal(step.ratchet, 16);
  assert.equal(step.prob, 0);
  assert.equal(step.pitchOffset, 24);
  assert.equal(step.ratchetCurve, 'even', 'unknown curve falls back');
  assert.equal(step.condition, 'none', 'unknown condition falls back');
  assert.equal(step.locks.freq.value, 100, 'lock value clamped');
  assert.equal(step.locks.freq.on, true);
});

test('the URL fragment codec round-trips a session', async () => {
  const { app } = loadApp();
  customize(app);
  const hash = await app.bureau.encodeSessionUrl();
  assert.ok(hash.startsWith('#f909='), 'fragment has the session prefix');
  assert.ok(hash.length < 4000, `fragment is compact (${hash.length} chars)`);

  const decoded = await app.bureau.decodeSessionUrl(hash);
  assert.equal(decoded.bpm, 187);
  assert.equal(decoded.tracks[2].steps[3].v, 46);

  // A foreign fragment decodes to null rather than throwing.
  assert.equal(await app.bureau.decodeSessionUrl('#other=stuff'), null);
  assert.equal(await app.bureau.decodeSessionUrl(''), null);
});

test('undo and redo walk the mutation history', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.undoStack.length = 0;
  bureau.redoStack.length = 0;

  bureau.tracks[0].steps[0].active = true;
  bureau.pushHistory();
  bureau.tracks[0].steps[1].active = true;
  bureau.pushHistory();

  assert.equal(bureau.undoStack.length, 2);
  assert.equal(bureau.undo(), true);
  assert.equal(bureau.tracks[0].steps[1].active, false, 'undo reverses the last edit');
  assert.equal(bureau.tracks[0].steps[0].active, true, 'earlier edit survives');
  assert.equal(bureau.redo(), true);
  assert.equal(bureau.tracks[0].steps[1].active, true, 'redo reapplies it');

  // A real mutation clears the redo stack. (A no-op edit would collapse in
  // pushHistory and deliberately leave the redo stack alone.)
  bureau.undo();
  bureau.tracks[2].steps[0].active = !bureau.tracks[2].steps[0].active;
  bureau.pushHistory();
  assert.equal(bureau.redoStack.length, 0);
  assert.equal(bureau.redo(), false, 'redo is empty after a new mutation');

  // Duplicate consecutive states collapse into one entry.
  const depth = bureau.undoStack.length;
  bureau.pushHistory();
  bureau.pushHistory();
  assert.equal(bureau.undoStack.length, depth, 'identical snapshots collapse');
});

test('undo on an empty stack is a no-op', () => {
  const { app } = loadApp();
  app.bureau.undoStack.length = 0;
  assert.equal(app.bureau.undo(), false);
  assert.equal(app.bureau.redo(), false);
});

test('snapshots store and recall the pattern', () => {
  const { app } = loadApp();
  const { bureau } = app;
  bureau.undoStack.length = 0;

  bureau.tracks[0].steps[0].active = true;
  bureau.tracks[0].steps[0].vel = 111;
  bureau.bpm = 200;
  assert.equal(bureau.storeSnapshot('A'), true);

  bureau.tracks[0].steps[0].active = false;
  bureau.tracks[0].steps[0].vel = 20;
  bureau.bpm = 90;

  assert.equal(bureau.recallSnapshot('A'), true);
  assert.equal(bureau.tracks[0].steps[0].active, true);
  assert.equal(bureau.tracks[0].steps[0].vel, 111);
  assert.equal(bureau.bpm, 200);

  // The recall is undoable.
  assert.equal(bureau.undo(), true);
  assert.equal(bureau.tracks[0].steps[0].active, false);

  assert.equal(bureau.recallSnapshot('B'), false, 'empty slot refuses');
  assert.equal(bureau.storeSnapshot('Z'), false, 'invalid slot refuses');
});

test('morph interpolates numerics and resolves discrete fields deterministically', () => {
  const run = () => {
    const { app } = loadApp();
    const { bureau } = app;
    bureau.tracks[0].steps[0].active = true;
    bureau.tracks[0].steps[0].vel = 100;
    bureau.tracks[0].steps[0].prob = 100;
    bureau.tracks[0].steps[1].active = true;
    bureau.bpm = 100;
    bureau.fx.crush = 0;
    bureau.storeSnapshot('A');
    // Move everything far away.
    bureau.tracks[0].steps[0].vel = 0;
    bureau.tracks[0].steps[0].prob = 0;
    bureau.tracks[0].steps[0].pitchOffset = -24;
    bureau.tracks[0].steps[1].active = false;
    bureau.tracks[0].steps[1].vel = 127;
    bureau.bpm = 60;
    bureau.fx.crush = 1;
    bureau.morphTowards('A', 0.5);
    return bureau;
  };

  const a = run();
  const b = run();

  // Numeric parameters interpolate linearly.
  assert.equal(a.tracks[0].steps[0].vel, 50, 'velocity lerps to the midpoint');
  assert.equal(a.tracks[0].steps[0].prob, 50, 'probability lerps to the midpoint');
  assert.equal(a.tracks[0].steps[0].pitchOffset, -12, 'pitch lerps to the midpoint');
  assert.equal(a.bpm, Math.round(60 + (100 - 60) * 0.5));
  assert.equal(a.fx.crush, 0.5);

  // The morph is deterministic: same slot, same amount, same result.
  // (Compared via JSON: each loadApp() is a fresh vm realm, so the two
  // arrays carry different Array prototypes and deepStrictEqual would
  // reject them on prototype mismatch alone.)
  assert.equal(
    JSON.stringify(a.tracks[0].steps.map((s) => [s.active, s.vel, s.ratchet, s.condition])),
    JSON.stringify(b.tracks[0].steps.map((s) => [s.active, s.vel, s.ratchet, s.condition])),
    'morph resolves identically across instances'
  );

  // Morphing to 100% equals a recall.
  const c = loadApp().app.bureau;
  c.tracks[1].steps[2].active = true;
  c.tracks[1].steps[2].vel = 90;
  c.storeSnapshot('C');
  c.tracks[1].steps[2].vel = 10;
  c.morphTowards('C', 1);
  assert.equal(c.tracks[1].steps[2].vel, 90, 'morph 100% recalls the snapshot');

  // Empty slot / zero amount refuse.
  assert.equal(c.morphTowards('D', 0.5), false);
  assert.equal(c.morphTowards('C', 0), false);
});

test('autosave persists to localStorage and restores', () => {
  const { app, window } = loadApp();
  const { bureau } = app;
  bureau.autosave = true;
  bureau.tracks[0].steps[0].active = true;
  bureau.bpm = 222;
  bureau.pushHistory(); // pushHistory persists

  const raw = window.localStorage.getItem('form909warp.session.v2');
  assert.ok(raw, 'session was persisted');
  assert.ok(JSON.parse(raw).bpm === 222);

  // Wreck the state, then restore from storage.
  bureau.tracks[0].steps[0].active = false;
  bureau.bpm = 40;
  assert.equal(bureau.restorePersistedSession(), true);
  assert.equal(bureau.bpm, 222);
  assert.equal(bureau.tracks[0].steps[0].active, true);

  // With autosave off, nothing is written.
  bureau.autosave = false;
  bureau.bpm = 55;
  bureau.pushHistory();
  assert.equal(JSON.parse(window.localStorage.getItem('form909warp.session.v2')).bpm, 222);
});

test('boot restores an autosaved session from localStorage', () => {
  const seed = loadApp();
  customize(seed.app);
  seed.app.bureau.persistSession();

  // A fresh app instance sharing that storage restores the session at boot.
  const restored = loadApp({ localStorage: seed.window.localStorage });
  assert.equal(restored.app.bureau.bpm, 187, 'boot restored the autosaved session');
  assert.equal(restored.app.bureau.tracks[0].currentLength, 7);
  assert.equal(restored.document.getElementById('tempoInput').value, 187, 'widget synced');
});

test('boot applies a session from the URL fragment', async () => {
  const seed = loadApp();
  customize(seed.app);
  const hash = await seed.app.bureau.encodeSessionUrl();

  const fromUrl = loadApp({ hash });
  await flush();
  await flush();
  assert.equal(fromUrl.app.bureau.bpm, 187, 'boot decoded the shared link');
  assert.equal(fromUrl.app.bureau.tracks[1].engine, 'wavetable');
  assert.equal(fromUrl.app.bureau.tracks[0].steps[0].active, true);
});

test('a malformed URL fragment falls back to the default case file', async () => {
  const broken = loadApp({ hash: '#f909=z!!!not-base64!!!' });
  await flush();
  await flush();
  assert.equal(broken.app.bureau.bpm, 168, 'default preset loaded');
  assert.equal(broken.app.bureau.tracks[0].steps[0].active, true, 'confield kick');
});

test('the session panel widgets drive the engine', () => {
  const { app, document } = loadApp();
  const { bureau } = app;

  // Undo/redo buttons reflect stack depth.
  bureau.undoStack.length = 0;
  bureau.pushHistory();
  assert.equal(document.getElementById('undoBtn').disabled, false);
  assert.equal(document.getElementById('redoBtn').disabled, true);

  // Autosave toggle flips the engine flag.
  const autosaveBtn = document.getElementById('autosaveBtn');
  autosaveBtn.click();
  assert.equal(bureau.autosave, false);
  assert.equal(autosaveBtn.getAttribute('aria-pressed'), 'false');
  autosaveBtn.click();
  assert.equal(bureau.autosave, true);

  // Snapshot slot rows render and store.
  const storeBtn = document.querySelector('.snap-store-btn[data-slot="B"]');
  assert.ok(storeBtn, 'slot B store button rendered');
  storeBtn.click();
  assert.ok(bureau.snapshots.B, 'slot B filled');
  const recallBtn = document.querySelector('.snap-recall-btn[data-slot="B"]');
  assert.equal(recallBtn.disabled, false, 'recall enabled once filled');
});
