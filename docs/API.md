# API Reference

**Form 909-WARP** — `BureauEngine` and the UI contract

Form 909-WARP has no public package API: it is a single HTML file with one
inline script. This document is the reference for the objects, methods and DOM
contracts inside that script, written so a contributor can navigate it without
reading all 1 727 lines.

Everything described here lives in the global scope of the inline `<script>`.
There are no exports.

---

## Contents

1. [Constants](#1-constants)
2. [BureauEngine](#2-bureauengine)
3. [Lifecycle methods](#3-lifecycle-methods)
4. [Scheduling methods](#4-scheduling-methods)
5. [Synthesis methods](#5-synthesis-methods)
6. [Export methods](#6-export-methods)
7. [UI functions](#7-ui-functions)
8. [DOM contract](#8-dom-contract)
9. [Event bindings](#9-event-bindings)
10. [Boot sequence](#10-boot-sequence)

---

## 1. Constants

### `TRACK_CONFIGS`

Declarative definition of the six voices. Read once by `initTracks()`.

```js
const TRACK_CONFIGS = [
  { id: 'bd',    name: 'KICK / TRANSIENT FM',      type: 'FM SUB-PUNCH',        steps: 16, color: '#38bdf8', defaultGain: 0.85 },
  { id: 'sn',    name: 'SNARE / METALLIC WIRE',    type: 'DUAL RES-NOISE',      steps: 16, color: '#f59e0b', defaultGain: 0.75 },
  { id: 'ch',    name: 'HAT / REZ MICROSPLICE',    type: 'METALLIC 6-OP',       steps: 16, color: '#10b981', defaultGain: 0.65 },
  { id: 'perc',  name: 'CONK / MODULAR CLANG',     type: 'RING MOD FM',         steps: 12, color: '#d946ef', defaultGain: 0.70 },
  { id: 'glitch',name: 'GLITCH / BIT SHREDDER',    type: 'NOISE BURST GRAIN',   steps: 14, color: '#ef4444', defaultGain: 0.68 },
  { id: 'sub',   name: 'ACID SUB / HARMONIC SINK', type: 'SQUARE SQUELCH',      steps: 16, color: '#06b6d4', defaultGain: 0.78 }
];
```

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable identifier; not currently used for lookup |
| `name` | `string` | Lane label |
| `type` | `string` | Sub-label; also used in the cell's accessible name |
| `steps` | `number` | **Default** `currentLength`; polyrhythmic defaults are 12 and 14 |
| `color` | `string` | Lane accent (CSS hex) |
| `defaultGain` | `number` | Reserved for per-voice gain; currently applied by the bus |

> **Note.** `defaultGain` is declared but not yet consumed. The master bus
> handles level staging. It is retained deliberately ahead of per-track buses;
> see [ROADMAP.md](ROADMAP.md).

### `PRESETS`

Nine declarative patterns. Schema documented in
[PATTERNS.md](PATTERNS.md#preset-schema).

| Key | BPM | Lane lengths | Crush | Drive | Swing |
|---|---|---|---|---|---|
| `confield` | 168 | 16, 16, 16, 12, 14, 16 | 0.28 | 0.35 | 0.16 |
| `drukqs` | 192 | 16 × 6 | 0.20 | 0.45 | 0.05 |
| `square` | 178 | 16, 16, 16, 11, 13, 16 | 0.12 | 0.38 | 0.20 |
| `subliminal` | 142 | 13, 13, 16, 7, 9, 13 | 0.30 | 0.22 | 0.10 |
| `gonk` | 156 | 16, 16, 16, 12, 16, 16 | 0.35 | 0.40 | 0.08 |
| `vnares` | 210 | 14, 14, 14, 7, 14, 14 | 0.42 | 0.50 | 0.00 |
| `raster` | 128 | 16 × 6 | 0.05 | 0.15 | 0.00 |
| `boiler` | 165 | 16 × 6 | 0.38 | 0.65 | 0.22 |
| `empty` | 160 | 16 × 6 | 0.10 | 0.20 | 0.00 |

### `LORE_QUOTES`

`string[8]` — ticker text, sampled at random every 7 s while the transport runs.

---

## 2. BureauEngine

The single state owner. Instantiated once, as `bureau`.

### Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `audioCtx` | `AudioContext \| null` | `null` | Created lazily on first user gesture |
| `isPlaying` | `boolean` | `false` | Transport state |
| `bpm` | `number` | `168` | 40–360 |
| `stepIndex` | `number` | `0` | Monotonic global step counter; never reset |
| `nextNoteTime` | `number` | `0` | Seconds on the audio clock for the next step |
| `timerID` | `number \| null` | `null` | `setInterval` handle |
| `lookahead` | `number` | `25.0` | Milliseconds between scheduler wakes |
| `scheduleAheadTime` | `number` | `0.1` | Seconds of lookahead horizon |
| `fx` | `FxState` | see below | Master effect parameters |
| `tracks` | `Track[6]` | from `TRACK_CONFIGS` | The pattern matrix |
| `selectedStep` | `{tIdx, sIdx} \| null` | `null` | Inspector target |
| `analyser` | `AnalyserNode` | — | Feeds the vector scope |
| `_crushCurve` | `Float32Array \| null` | `null` | Memoised crush transfer curve |
| `_crushBits` | `number \| null` | `null` | Bit depth the cached curve encodes |

### `fx`

| Key | Type | Default | Range | Unit |
|---|---|---|---|---|
| `crush` | `number` | `0.15` | 0 – 1 | → 16…3 bits |
| `drive` | `number` | `0.25` | 0 – 1 | waveshaper knee |
| `humanize` | `number` | `4` | 0 – 25 | ms of jitter |
| `cutoff` | `number` | `16500` | 150 – 18 000 | Hz |
| `delayTime` | `number` | `0.18` | 0.03 – 0.65 | s |
| `delayFeedback` | `number` | `0.32` | 0 – 0.85 | ratio |
| `globalProb` | `number` | `1.0` | 0.1 – 1.0 | ratio |
| `globalRatchet` | `number` | `0.2` | 0 – 1 | ratio |
| `swing` | `number` | `0.12` | 0 – 0.5 | ratio |

### `Track`

| Key | Type | Description |
|---|---|---|
| *(from `TRACK_CONFIGS`)* | — | `id`, `name`, `type`, `color`, `defaultGain` |
| `currentLength` | `number` | 1–32; gates which steps are read |
| `steps` | `Step[32]` | Always 32 allocated |
| `mute` | `boolean` | Skipped when true |
| `solo` | `boolean` | Exclusive when any track is soloed |
| `cursor` | `number` | Reserved; the visual cursor is driven by the DOM |

### `Step`

| Key | Type | Range | Description |
|---|---|---|---|
| `active` | `boolean` | — | Does the step trigger |
| `vel` | `number` | 0 – 127 | MIDI-style velocity |
| `ratchet` | `number` | 1 – 4 | Sub-triggers per step |
| `prob` | `number` | 0 – 100 | Per-step probability, multiplied by `fx.globalProb` |
| `pitchOffset` | `number` | −24 – +24 | Semitones |

### Audio graph properties

Set by `setupMasterBus()`, after `initAudio()`:

`busIn` → `crushShaper` → `masterFilter` → `driveShaper` → `limiter` →
`masterGain` → `analyser` → `destination`, with `masterFilter` → `delayNode`
and `delayWet` → `driveShaper`.

| Property | Type |
|---|---|
| `busIn` | `GainNode` |
| `crushShaper` | `WaveShaperNode` |
| `masterFilter` | `BiquadFilterNode` |
| `driveShaper` | `WaveShaperNode` |
| `limiter` | `DynamicsCompressorNode` |
| `masterGain` | `GainNode` |
| `analyser` | `AnalyserNode` |
| `delayNode` | `DelayNode` |
| `delayFeedback` | `GainNode` |
| `delayWet` | `GainNode` |

---

## 3. Lifecycle methods

### `constructor()`

Initialises state and calls `initTracks()`. Does **not** create an
`AudioContext` — that must wait for a user gesture.

### `initAudio()`

Creates the `AudioContext` (with `latencyHint: 'interactive'`), the master bus
and the scope loop on first call; resumes it if suspended.

```js
bureau.initAudio();   // safe to call repeatedly
```

Idempotent. Called from every interaction path that could produce sound, which
is why there is no explicit "enable audio" gate.

### `initTracks()`

Rebuilds `tracks` from `TRACK_CONFIGS`, allocating 32 zeroed steps per lane.

> **Destructive.** Wipes the current pattern. Called only from the constructor.

### `setupMasterBus()`

Constructs the live node graph. See
[ARCHITECTURE.md §8](ARCHITECTURE.md#8-the-master-bus).

### `setupOscilloscope()`

Starts a `requestAnimationFrame` loop drawing `analyser` time-domain data onto
`#oscilloscope`. Runs for the lifetime of the page once started.

---

## 4. Scheduling methods

### `start()`

```js
bureau.start();
```

Calls `initAudio()`, resets `stepIndex` to 0, sets `nextNoteTime` to
`currentTime + 0.05`, and starts the scheduler interval.

> **Note.** `stepIndex` resets only on `start()`, not per bar. See
> [ARCHITECTURE.md D3](ARCHITECTURE.md#d3--global-monotonic-step-counter).

### `stop()`

```js
bureau.stop();
```

Clears the interval and removes the `current-cursor` class from every cell.
Already-scheduled notes still sound — they are committed to the audio clock and
cannot be unscheduled. At the default 100 ms horizon this is at most ~100 ms of
tail, which is inaudible as latency and desirable as continuity.

### `scheduler()`

```js
scheduler() {
  while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
    this.scheduleStep(this.stepIndex, this.nextNoteTime);
    this.advanceStep();
  }
}
```

Invoked every `lookahead` ms by `setInterval`.

### `advanceStep()`

Advances `nextNoteTime` by one sixteenth note plus any swing offset, and
increments `stepIndex`.

```js
const secondsPerBeat = 60.0 / this.bpm;
const stepRate = 0.25;
let swingOffset = 0;
if (this.stepIndex % 2 === 1 && this.fx.swing > 0) {
  swingOffset = (this.fx.swing * 0.35) * (secondsPerBeat * stepRate);
}
this.nextNoteTime += (secondsPerBeat * stepRate) + swingOffset;
this.stepIndex++;
```

### `scheduleStep(globalStep, time)`

Resolves every lane against one global step. Full pipeline in
[ARCHITECTURE.md §6](ARCHITECTURE.md#6-pattern-resolution-pipeline).

| Parameter | Type | Description |
|---|---|---|
| `globalStep` | `number` | Monotonic step counter value |
| `time` | `number` | Absolute start time on the audio clock |

**Returns** `undefined`. Side effects: schedules audio events and defers a
cursor update.

### `updateTrackVisualCursor(trackIdx, stepIdx)`

Moves the `current-cursor` class within a lane and pulses `#tempoLed` on the
quarter note (when `trackIdx === 0 && stepIdx % 4 === 0`).

---

## 5. Synthesis methods

### `playTrackSound(trackIdx, time, stepData, targetCtx?, destNode?)`

```js
playTrackSound(trackIdx, time, stepData, targetCtx = this.audioCtx, destNode = this.busIn)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `trackIdx` | `number` | — | 0–5, selects the voice |
| `time` | `number` | — | Absolute start time |
| `stepData` | `Step` | — | Carries `vel` and `pitchOffset` |
| `targetCtx` | `BaseAudioContext` | `this.audioCtx` | Live or offline context |
| `destNode` | `AudioNode` | `this.busIn` | Destination node |

Derives `velNorm = stepData.vel / 127` and
`pitchShift = Math.pow(2, stepData.pitchOffset / 12)`, then dispatches.

### Voice generators

All six share the signature `(ctx, dest, time, vel, pitchShift)` and return
`undefined`. They create nodes, schedule envelopes, and connect to `dest`.

| Method | Voice | Duration |
|---|---|---|
| `synthKick` | Kick | 400 ms |
| `synthSnare` | Snare | 230 ms |
| `synthHat` | Hat | 70 ms |
| `synthPerc` | Perc | 150 ms |
| `synthGlitch` | Glitch | 40 ms |
| `synthSub` | Sub | 300 ms |

Full DSP detail: [SOUND-DESIGN.md](SOUND-DESIGN.md).

### Curve builders

#### `updateDriveCurve(amount) → Float32Array`

Rebuilds and installs the saturation transfer curve.

| Parameter | Range | Effect |
|---|---|---|
| `amount` | 0 – 1 | `k = amount × 40` |

Sets `driveShaper.curve` and `driveShaper.oversample = '4x'`. Returns the
curve, which the offline path also consumes.

#### `updateCrushCurve(amount) → Float32Array`

Rebuilds (or returns the memoised) bit-crush quantisation curve.

| Parameter | Range | Effect |
|---|---|---|
| `amount` | 0 – 1 | `bits = clamp(round(16 − amount × 13), 3, 16)` |

Sets `crushShaper.curve` and `crushShaper.oversample = 'none'`. Memoised on
bit depth, so a slider sweep allocates 14 curves rather than 101.

---

## 6. Export methods

### `exportWav(numBars, onProgress?, options?)`

```js
const result = await bureau.exportWav(4, pct => console.log(pct), {
  sampleRate: 48000,
  bitDepth: 24,
  seed: 1234
});
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `numBars` | `number` | — | Number of 4-beat patterns to render |
| `onProgress` | `(pct: number) => void` | no-op | Called with 0–100 |
| `options.sampleRate` | `number` | `48000` | Render sample rate |
| `options.bitDepth` | `16 \| 24` | `24` | Output resolution |
| `options.seed` | `number` | random | PRNG seed; disclosed in the result |

**Resolves to:**

```js
{
  blob: Blob,        // audio/wav
  seed: number,      // the seed actually used
  duration: number,  // seconds
  sampleRate: number,
  bitDepth: number
}
```

**Throws** if `OfflineAudioContext` is unavailable or rendering fails. The UI
catches and surfaces `err.message`.

**Behaviour.** Builds a mirror of the live bus inside an
`OfflineAudioContext`, schedules every step using a seeded PRNG, renders, and
encodes. See [EXPORT.md](EXPORT.md).

**Progress semantics.** Reports ~5 % at start, then advances at each of ten
scheduled `suspend()` checkpoints, and 100 % on completion. On engines without
`suspend`/`resume` it reports 5 % → 50 % → 100 %. It never reports a value it
has not earned.

### `static mulberry32(seed) → () => number`

Deterministic 32-bit PRNG. Returns a function producing uniform samples in
`[0, 1)`.

```js
const rand = BureauEngine.mulberry32(42);
rand();  // 0.6013…  (same every time for seed 42)
```

Used only by the offline path. Live playback uses `Math.random()`.

### `bufferToWaveBlob(abuffer, bitDepth?)`

```js
const blob = bureau.bufferToWaveBlob(renderedBuffer, 24);
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `abuffer` | `AudioBuffer` | — | Render output |
| `bitDepth` | `16 \| 24` | `24` | Sample resolution |

**Returns** a `Blob` with MIME type `audio/wav`. Writes a canonical 44-byte
RIFF/WAVE header followed by interleaved little-endian PCM.

---

## 7. UI functions

### `renderAllTracks()`

Projects engine state into `#tracksContainer`. Rebuilds all lanes and cells,
binds handlers, and restores keyboard focus to the cell that had it.

- Called after every mutation of the pattern matrix.
- Never mutates musical state (invariant I7).
- Adds `role="button"`, `aria-pressed`, `aria-label` and `tabIndex` per cell.
  Only active steps join the tab order.

### `loadPreset(key)`

```js
loadPreset('confield');
```

Loads `PRESETS[key]`, falling back to `confield` for unknown keys. Writes `bpm`,
`fx.crush`, `fx.drive` and `fx.swing` to state **and** to their widgets, then
resets every step and re-applies the pattern data.

> Only three of the nine `fx` fields are preset-controlled. Cutoff, delay and
> the collapse-matrix parameters persist across preset changes — intentional,
> because those are the performer's bus settings rather than the pattern's.

### `selectStep(tIdx, sIdx)`

Binds the inspector to a step and populates its four controls.

### `generateEuclidean(tIdx)`

Overwrites a lane with a Euclidean distribution.

```js
const pulses = Math.max(1, Math.floor(totalSteps * (Math.random() * 0.5 + 0.25)));
```

Density is randomised between 25 % and 75 %. Each active hit has a 25 % chance
of being promoted to a 2× ratchet.

**Destructive** to the lane.

### `describeStep(track, step, sIdx) → string`

Builds the accessible name for a cell, e.g.
`"KICK / TRANSIENT FM, step 3, on, ratchet 2 times, plus 7 semitones, probability 80 percent."`

### `updateTicker(msg)`

Writes to `#loreTicker`, which is an `aria-live="polite"` status region.

### `togglePlayback()`

Starts or stops the transport and re-renders the play button (`renderPlayButton`).

### `renderPlayButton()`

Syncs `#playBtn` label, icon, `aria-pressed` and `aria-label` to `isPlaying`.

### Modal helpers

| Function | Description |
|---|---|
| `openExportModal()` | Records the invoking element, un-hides the modal, focuses the first control |
| `closeExportModal()` | Hides the modal and restores focus to the invoking element |
| `setExportProgress(pct)` | Writes the bar width and `aria-valuenow` |

---

## 8. DOM contract

Elements the script requires. `tools/validate.mjs` fails CI if any of these go
missing.

### Transport

| ID | Element | Purpose |
|---|---|---|
| `playBtn` | `button` | Transport toggle |
| `tempoInput` | `input[type=number]` | BPM, 40–360 |
| `chaosBtn` | `button` | Mutate |
| `exportModalBtn` | `button` | Opens the export dialog |
| `tempoLed` | `div.led` | Quarter-note pulse |

### Telemetry rack

| ID | Element | Purpose |
|---|---|---|
| `oscilloscope` | `canvas` | 300 × 90 vector scope |
| `loreTicker` | `div[role=status]` | `aria-live` status line |
| `dspLoad` | `span` | Static read-out |
| `presetSelect` | `select` | Nine case files |

### Master effects

| ID | Parameter | Range |
|---|---|---|
| `fxCrush` / `fxCrushVal` | Bit crush | 0 – 1 |
| `fxDrive` / `fxDriveVal` | Drive | 0 – 1 |
| `fxHumanize` / `fxHumanizeVal` | Jitter | 0 – 25 ms |
| `fxCutoff` / `fxCutoffVal` | Filter cutoff | 150 – 18 000 Hz |
| `fxDelayTime` / `fxDelayTimeVal` | Delay time | 0.03 – 0.65 s |
| `fxDelayFeedback` / `fxDelayFeedbackVal` | Feedback | 0 – 0.85 |
| `globalProb` / `globalProbVal` | Global probability | 10 – 100 % |
| `globalRatchet` / `globalRatchetVal` | Drill density | 0 – 100 % |
| `masterSwing` / `masterSwingVal` | Swing | 0 – 50 % |

### Sequencer

| ID | Element | Purpose |
|---|---|---|
| `tracksContainer` | `div` | Lane host, rebuilt by `renderAllTracks()` |
| `clearAllBtn` | `button` | Purge all |
| `randomizeAllBtn` | `button` | Generative seed |
| `lane-${tIdx}` | `div.step-lane` | Per-lane cell container |
| `mute-${tIdx}` | `button` | Per-lane mute |
| `solo-${tIdx}` | `button` | Per-lane solo |
| `len-${tIdx}` | `input[type=number]` | Per-lane length, 1–32 |

### Inspector

| ID | Parameter | Range |
|---|---|---|
| `inspectorStepId` | Read-out | Selected step |
| `stepVel` / `stepVelVal` | Velocity | 0 – 127 |
| `stepRatch` / `stepRatchVal` | Ratchet | 1 – 4 |
| `stepProb` / `stepProbVal` | Probability | 0 – 100 % |
| `stepPitch` / `stepPitchVal` | Pitch lock | −24 – +24 st |

### Export modal

| ID | Element | Purpose |
|---|---|---|
| `exportModal` | `div[hidden]` | Backdrop; `hidden` is the visibility source of truth |
| `exportBars` | `select` | 2 / 4 / 8 / 16 patterns |
| `exportProgressWrap` | `div[role=progressbar]` | Accessible progress |
| `exportProgress` | `div.progress-fill` | Bar fill |
| `exportStatusText` | `div` | Status line |
| `cancelExportBtn` | `button` | Discard |
| `runExportBtn` | `button` | Render |

### CSS contract

Custom properties read by the script and the stylesheet, all declared in
`:root`:

`--bg-dark` `--panel-bg` `--panel-border` `--screen-bg` `--crt-glow` `--amber`
`--amber-glow` `--cyan` `--cyan-bright` `--rad-green` `--rad-red`
`--glitch-pink` `--knob-track` `--text-dim` `--text-mid` `--text-bright`
`--mono` `--display` `--sans`

---

## 9. Event bindings

### Pointer

| Target | Event | Action |
|---|---|---|
| `.step-cell` | `click` | Toggle, or cycle ratchet with `Shift` |
| `.step-cell` | `contextmenu` | Select without toggling |
| `#mute-*` / `#solo-*` | `click` | Toggle the flag, re-render |
| `.track-len-input` | `change` | Set `currentLength`, clamped 1–32 |
| `.euclid-gen-btn` | `click` | `generateEuclidean(tIdx)` |
| `#playBtn` | `click` | `togglePlayback()` |
| `#tempoInput` | `change` | Set BPM, clamped 40–360 |
| `#chaosBtn` | `click` | `mutateRhythms()` |
| `#clearAllBtn` | `click` | Deactivate every step |
| `#randomizeAllBtn` | `click` | Generative seed |
| `#presetSelect` | `change` | `loadPreset(value)` |
| `#exportModalBtn` | `click` | `openExportModal()` |
| `#cancelExportBtn` | `click` | `closeExportModal()` |
| `#exportModal` | `mousedown` | Backdrop click dismisses |
| `#runExportBtn` | `click` | Render and download |

### Keyboard

| Key | Context | Action |
|---|---|---|
| <kbd>Space</kbd> | Global, outside form controls and cells | Toggle transport |
| <kbd>Enter</kbd> | Focused step cell | Toggle |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Focused step cell | Cycle ratchet |
| <kbd>←</kbd> / <kbd>→</kbd> | Focused step cell | Move within the lane |
| <kbd>Tab</kbd> | Inside the export modal | Trapped between first and last control |
| <kbd>Esc</kbd> | Inside the export modal | Close |

### Sliders

All seventeen range inputs are bound to `input` (not `change`), so parameters
update continuously during a drag. Three of them write directly to live audio
nodes with `setValueAtTime`:

- `fxCutoff` → `masterFilter.frequency`
- `fxDelayTime` → `delayNode.delayTime`
- `fxDelayFeedback` → `delayFeedback.gain`

The remaining effects are read at schedule time or rebuild a curve.

---

## 10. Boot sequence

```
1.  Parse HTML; stylesheet applies
2.  Script executes top to bottom
3.  TRACK_CONFIGS, LORE_QUOTES, class definitions
4.  const bureau = new BureauEngine()      → initTracks(); no AudioContext yet
5.  PRESETS defined
6.  Function declarations hoisted
7.  Event bindings attached
8.  loadPreset('confield')                 → state + widgets + first render
9.  setInterval(lore ticker, 7000)         → no-ops while stopped
10. Idle: waiting for the first user gesture, which triggers initAudio()
```

No audio is created until step 10. This is required by browser autoplay policy
and it is why the application loads silently rather than showing an "enable
audio" prompt.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [SOUND-DESIGN.md](SOUND-DESIGN.md) ·
[PATTERNS.md](PATTERNS.md) · [EXPORT.md](EXPORT.md)*
