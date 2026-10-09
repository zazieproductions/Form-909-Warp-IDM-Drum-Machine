# Architecture

**Form 909-WARP** — *The Bureau of Unreasonable Rhythms*

This document describes how the system is put together and, more importantly,
*why* it is put together that way. It is written for someone who has just
cloned the repository and wants to change something without breaking it.

---

## Contents

1. [System overview](#1-system-overview)
2. [Constraints](#2-constraints)
3. [File layout](#3-file-layout)
4. [The state model](#4-the-state-model)
5. [The scheduler](#5-the-scheduler)
6. [Pattern resolution pipeline](#6-pattern-resolution-pipeline)
7. [Voice dispatch and synthesis layer](#7-voice-dispatch-and-synthesis-layer)
8. [The master bus](#8-the-master-bus)
9. [The offline render path](#9-the-offline-render-path)
10. [The rendering layer](#10-the-rendering-layer)
11. [Control flow: what happens on a click](#11-control-flow-what-happens-on-a-click)
12. [Module boundaries and dependency direction](#12-module-boundaries-and-dependency-direction)
13. [Design decisions](#13-design-decisions)
14. [Invariants](#14-invariants)
15. [Extension points](#15-extension-points)

---

## 1. System overview

The application is a single HTML file with three layers and one direction of
travel.

```
┌───────────────────────────────────────────────────────────────────┐
│  PRESENTATION        DOM built by renderAllTracks(); inspector;   │
│                      transport; modal; vector scope (canvas).     │
│                      Holds no musical state.                      │
└───────────────────────────────┬───────────────────────────────────┘
                                │  mutates state / reads state
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  DOMAIN              BureauEngine                                 │
│                      tracks[] · fx{} · bpm · stepIndex            │
│                      scheduler() · scheduleStep() · exportWav()   │
│                      Owns all truth. Knows nothing about the DOM  │
│                      except the two ids it needs for visuals.     │
└───────────────────────────────┬───────────────────────────────────┘
                                │  creates nodes, schedules events
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  AUDIO               AudioContext graph (live)                    │
│                      OfflineAudioContext graph (bounce)           │
│                      Six voice generators, context-agnostic.      │
└───────────────────────────────────────────────────────────────────┘
```

The important property: **the audio layer never reads the DOM, and the DOM
layer never touches the audio clock.** The only coupling between timing and
pixels is a `setTimeout` that fires a cursor update at approximately the moment
a scheduled note sounds.

---

## 2. Constraints

These are the rules the architecture has to satisfy. Every design decision
below traces back to one of them.

| ID | Constraint | Consequence |
|---|---|---|
| **C1** | Zero runtime dependencies | Everything is built on Web Audio and DOM primitives |
| **C2** | No build step | No modules, no TypeScript, no JSX, no bundler-era conveniences |
| **C3** | One self-contained file | All CSS and JS are inline; navigability comes from convention |
| **C4** | Sample-accurate timing | Nothing may be triggered from a timer callback directly |
| **C5** | Deterministic bounce | The offline render must be reproducible from a seed |
| **C6** | Live and bounce must sound the same | The two graphs must be structurally parallel |
| **C7** | Keyboard operable | Every pointer interaction needs a keyboard equivalent |

---

## 3. File layout

```
Form-909-Warp-IDM-Drum-Machine/
├── Form-909 Warp IDM Drum Machine.html   ← the entire application (2 736 lines)
│     ├── <style>   lines 16–754          design tokens, layout, CRT treatment
│     ├── <body>    lines 756–1 005       static shell: header, racks, modal
│     └── <script>  lines 1 007–2 735     engine, presets, UI, bindings
│
├── tools/
│   ├── validate.mjs       static integrity checks (CI)
│   ├── check-links.mjs    documentation link checker (CI)
│   └── serve.mjs          dependency-free dev server
│
├── docs/                  this directory
└── .github/workflows/     CI + Pages deployment
```

Within the script, sections appear in this order and are delimited by banner
comments:

| Section | Responsibility |
|---|---|
| `TRACK_CONFIGS` | Declarative definition of the six voices |
| `LORE_QUOTES` | Ticker strings |
| `class BureauEngine` | State, audio graph, scheduler, voices, export |
| `PRESETS` | Nine declarative patterns |
| `loadPreset()` | Preset → state projection |
| `renderAllTracks()` | State → DOM |
| `generateEuclidean()` | Rhythm generator |
| `selectStep()` / `updateTicker()` | Inspector and status channel |
| Event bindings | Sliders, transport, modal, keyboard |
| Boot | `loadPreset('confield')` |

---

## 4. The state model

All mutable truth lives on one instance, `bureau`, created once at boot.

```js
BureauEngine
├── audioCtx          AudioContext | null          lazily created on first gesture
├── isPlaying         boolean
├── bpm               number                       40–360
├── stepIndex         number                       monotonic global counter
├── nextNoteTime      number                       seconds on the audio clock
├── timerID           number | null                 setInterval handle
├── lookahead         25.0                         ms between scheduler wakes
├── scheduleAheadTime 0.1                          seconds of lookahead horizon
├── fx                object                       master effect parameters
├── tracks            Track[6]                     the pattern matrix
├── selectedStep      {tIdx, sIdx} | null           inspector target
└── analyser          AnalyserNode                 feeds the vector scope
```

### `Track`

```js
{
  id: 'bd', name: 'KICK / TRANSIENT FM', type: 'FM SUB-PUNCH',
  color: '#38bdf8', defaultGain: 0.85,
  currentLength: 16,        // 1–32; the polyrhythm control
  mute: false, solo: false,
  steps: Step[32]           // always allocated; only [0, currentLength) is read
}
```

### `Step`

```js
{
  active: false,      // does this step trigger
  vel: 100,           // 0–127
  ratchet: 1,         // 1–4 sub-triggers
  prob: 100,          // 0–100, multiplied against fx.globalProb
  pitchOffset: 0      // −24…+24 semitones
}
```

### `fx`

```js
{
  crush: 0.15,          // 0–1    → 16-bit … 3-bit
  drive: 0.25,          // 0–1    → waveshaper knee
  humanize: 4,          // 0–25   milliseconds of jitter
  cutoff: 16500,        // 150–18 000 Hz
  delayTime: 0.18,      // 0.03–0.65 s
  delayFeedback: 0.32,  // 0–0.85
  globalProb: 1.0,      // 0.1–1.0
  globalRatchet: 0.2,   // 0–1
  swing: 0.12           // 0–0.5
}
```

### Why 32 steps are always allocated

`initTracks()` allocates all 32 slots for every lane and sets `currentLength`
separately. Changing a lane's length therefore writes one number instead of
reallocating an array, which means:

- Extending a lane restores steps the user previously set — the pattern is
  non-destructive under length changes.
- No bounds checks are needed in the hot path beyond the modulo.
- Memory cost is trivial: 6 × 32 × 5 numbers.

---

## 5. The scheduler

### The problem

`setInterval` and `setTimeout` cannot place audio events accurately. Timer
callbacks are subject to the event loop, garbage collection and (in background
tabs) aggressive throttling down to once per second. A naive sequencer that
calls `osc.start()` inside an interval callback drifts audibly within seconds.

### The pattern

The engine uses the standard two-clock approach described in Chris Wilson's
*A Tale of Two Clocks*: a coarse JavaScript timer wakes up often and schedules
audio events ahead of time against the audio hardware clock.

```
   JS timer (25 ms)                 Audio clock (sample-accurate)
   ─────────────────                ─────────────────────────────
   wake                             │
     │                              │
     ├─ while (nextNoteTime <       │      ┌── 100 ms horizon ──┐
     │         currentTime + 0.1)   │      │                    │
     │     scheduleStep(...)        │  ────┴────────────────────┴────▶ t
     │     advanceStep()            │      ▲        ▲        ▲
     └─ sleep                       │    note A   note B   note C
```

```js
scheduler() {
  while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
    this.scheduleStep(this.stepIndex, this.nextNoteTime);
    this.advanceStep();
  }
}
```

### Parameter choices

| Parameter | Value | Rationale |
|---|---|---|
| `lookahead` | 25 ms | Wakes ~40×/s. Cheap, and leaves ≥75 ms of slack before the horizon |
| `scheduleAheadTime` | 0.1 s | Ten times the wake interval, so a single missed wake cannot drop a note |
| `latencyHint` | `'interactive'` | Requests the smallest available output buffer |

The horizon must comfortably exceed the wake interval or jitter in the timer
translates directly into late scheduling. At 25 ms / 100 ms the ratio is 4:1,
which tolerates three consecutive missed wakes before audio breaks up.

### Step advance

```js
advanceStep() {
  const secondsPerBeat = 60.0 / this.bpm;
  const stepRate = 0.25;                       // sixteenth notes
  let swingOffset = 0;
  if (this.stepIndex % 2 === 1 && this.fx.swing > 0) {
    swingOffset = (this.fx.swing * 0.35) * (secondsPerBeat * stepRate);
  }
  this.nextNoteTime += (secondsPerBeat * stepRate) + swingOffset;
  this.stepIndex++;
}
```

Two details worth noting:

- **`stepIndex` never resets.** It is a global monotonic counter; each lane
  takes `globalStep % currentLength`. Resetting it would restart every lane in
  phase and destroy the polyrhythmic drift that is the instrument's premise.
- **Swing delays rather than displaces.** The offset is *added* to
  `nextNoteTime`, so the whole grid after an odd step shifts late and stays
  shifted. This is the classic MPC implementation; it is chosen deliberately
  over the alternative (displacing only the odd step and correcting on the
  next), which produces a different, less rubbery feel.

---

## 6. Pattern resolution pipeline

`scheduleStep(globalStep, time)` is called once per step and resolves every
lane against it. The order of operations matters.

```
for each track:
  ┌─ 1. mute check .................... if track.mute, skip
  ├─ 2. solo check .................... if any track is soloed and this one is not, skip
  ├─ 3. polyrhythmic index ............ trackStepIndex = globalStep % track.currentLength
  ├─ 4. visual cursor ................. setTimeout(update, scheduledTime − now)
  ├─ 5. active check .................. if !step.active, stop here
  ├─ 6. probability gate .............. random()*100 > prob × globalProb → skip
  ├─ 7. ratchet expansion ............. r = step.ratchet, possibly promoted by drill density
  └─ 8. for r in 0..ratchets−1:
        ├─ jitter ..................... (random() − 0.5) × humanize/1000
        ├─ clamp ...................... max(stepTime, stepTime + offset + jitter)
        ├─ velocity decay ............. max(20, vel × (1 − r × 0.12))
        └─ playTrackSound(trackIdx, t, stepData)
```

### Probability

```js
const probRoll = Math.random() * 100;
const effectiveProb = stepData.prob * this.fx.globalProb;
if (probRoll > effectiveProb) return;
```

Per-step and global probability **multiply**. A step set to 60 % under a global
gate of 80 % fires 48 % of the time. This matches how a user expects two
independent probability controls to compose, and it means global probability
acts as a master "density" fader rather than an override.

### Ratchet expansion

```js
let ratchets = stepData.ratchet;
if (this.fx.globalRatchet > 0 && ratchets === 1 && Math.random() < this.fx.globalRatchet * 0.4) {
  ratchets = Math.random() > 0.5 ? 2 : 4;
}
const stepDuration = (60.0 / this.bpm) * 0.25;
const subStepTime = stepDuration / ratchets;
```

Drill density only promotes steps the user left at 1×, so an explicitly
authored 3× ratchet is never overwritten. Velocity decays 12 % per repeat with
a floor of 20, so a 4× burst reads as `100 / 88 / 76 / 64` rather than four
identical clicks.

### Humanise

```js
const jitter = (Math.random() - 0.5) * (this.fx.humanize / 1000);
const triggerTime = Math.max(time, time + (r * subStepTime) + jitter);
```

The `Math.max` clamp is load-bearing. Without it, negative jitter on the first
sub-trigger would push a hit before the step boundary and it would audibly
belong to the previous step. MIDI values are unaffected: velocity is scaled,
not jittered.

### Visual cursor

Because audio is scheduled up to 100 ms early, the cursor must not light up
when the note is *scheduled* — it must light up when the note *sounds*. The
scheduler computes the delay and defers the DOM write:

```js
const drawDelay = Math.max(0, (schedTime - this.audioCtx.currentTime) * 1000);
setTimeout(() => this.updateTrackVisualCursor(tIdx, trackStepIndex), drawDelay);
```

This is the one place where a timer is allowed near the audio path, and it is
acceptable precisely because it is cosmetic: if it fires late, the light is
late, not the sound.

---

## 7. Voice dispatch and synthesis layer

```js
playTrackSound(trackIdx, time, stepData, targetCtx = this.audioCtx, destNode = this.busIn) {
  const ctx = targetCtx;
  const velNorm = stepData.vel / 127;
  const pitchShift = Math.pow(2, stepData.pitchOffset / 12);
  switch (trackIdx) { /* … six cases … */ }
}
```

The `targetCtx` and `destNode` parameters are the whole reason the same voice
code serves both live playback and offline rendering. A generator receives an
abstract audio context and an abstract destination, and never knows or cares
which it is.

Every generator has the same signature:

```js
synthVoice(ctx, dest, time, vel, pitchShift)
```

| Parameter | Meaning |
|---|---|
| `ctx` | `AudioContext` **or** `OfflineAudioContext` |
| `dest` | Node to connect into |
| `time` | Absolute start time on `ctx.currentTime`'s clock |
| `vel` | Normalised velocity, 0–1 |
| `pitchShift` | Frequency multiplier from the semitone offset |

Consequences of this contract:

- Nodes are created per trigger and are garbage collected after they stop.
  Web Audio nodes are cheap and one-shot by design; pooling them would add
  state without measurable benefit.
- Every node's start and stop times are explicit. Nothing relies on "now".
- No generator holds state between calls. The only exception is
  `synthGlitch`, which randomises waveform and filter on purpose.

Full DSP detail per voice: **[SOUND-DESIGN.md](SOUND-DESIGN.md)**.

---

## 8. The master bus

Built once, in `setupMasterBus()`, when the `AudioContext` is first created.

```
                            ┌──────────────────────────────┐
   voices ──▶ busIn ──▶ crushShaper ──▶ masterFilter ──┬──▶ driveShaper ──▶ limiter
                        (WaveShaper)     (lowpass Q1.8) │    (WaveShaper)   (Dynamics
                                                        │     4× oversample  Compressor)
                                                        │
                                                        ├──▶ delayNode ──▶ delayWet(0.28)
                                                        │         ▲   │
                                                        │         │   └──▶ driveShaper
                                                        │    delayFeedback(0…0.85)
                                                        │         │
                                                        └─────────┘
                                                                     │
   limiter ──▶ masterGain(0.88) ──▶ analyser ──▶ destination         │
                                        │                            │
                                        └──▶ canvas (vector scope) ◀──┘
```

| Node | Type | Settings |
|---|---|---|
| `crushShaper` | `WaveShaper` | Staircase quantiser, 16→3 bits, `oversample: 'none'` |
| `masterFilter` | `BiquadFilter` | `lowpass`, 150 Hz – 18 kHz, Q 1.8 |
| `driveShaper` | `WaveShaper` | Arctangent soft clip, `oversample: '4x'` |
| `delayNode` | `DelayNode` | 0.03–0.65 s |
| `delayFeedback` | `GainNode` | 0–0.85 |
| `delayWet` | `GainNode` | Fixed 0.28 |
| `limiter` | `DynamicsCompressor` | threshold −3.5 dB, knee 6, ratio 12, attack 3 ms, release 80 ms |
| `masterGain` | `GainNode` | Fixed 0.88 |
| `analyser` | `AnalyserNode` | `fftSize` 512, smoothing 0.75 |

### Two oversampling decisions, opposite on purpose

`driveShaper` runs at `'4x'`. Its transfer curve is strongly non-linear and
generates harmonics above Nyquist; oversampling pushes those out of the audible
band before decimation, so saturation sounds warm instead of gritty.

`crushShaper` runs at `'none'`. A staircase curve's characteristic sound *is*
its aliasing — the inharmonic partials folding back down. Oversampling would
low-pass the staircase and largely undo the effect.

### The delay sits inside the crush/filter loop

The filter feeds the delay, and the delay's wet output feeds the drive stage,
not back into the filter. This means delayed material is not re-filtered, so
echo tails keep the brightness they had when they were generated while still
being limited. The feedback loop is closed on the delay node alone.

---

## 9. The offline render path

`exportWav(numBars, onProgress, options)` rebuilds the entire graph inside an
`OfflineAudioContext` and renders it faster than real time.

```
OfflineAudioContext(2, ceil(sampleRate × duration), 48000)
        │
        ├── offBus → offCrush → offFilter → offDrive → offLimiter → offMaster → destination
        │                          └──→ offDelay ⇄ offDelayFb, offDelay → offDelayWet → offDrive
        │
        ├── every node's parameters copied from this.fx / this.masterGain defaults
        │
        ├── seeded PRNG (mulberry32) instead of Math.random()
        │
        ├── progress via 10 scheduled suspend() checkpoints
        │
        └── bufferToWaveBlob(rendered, 24)
```

### Parity as a hard requirement

The offline path replicates, in order:

| Live behaviour | Mirrored in export |
|---|---|
| Swing on odd steps | ✅ |
| Ratchet expansion + velocity decay | ✅ |
| Probability gate (`prob × globalProb`) | ✅ |
| Drill injection from `globalRatchet` | ✅ |
| Humanise jitter with `max()` clamp | ✅ |
| Mute / solo | ✅ |
| Crush → filter(Q 1.8) → drive(4×) → limiter → gain(0.88) | ✅ |
| Delay time, feedback, wet level | ✅ |

Omitting any one of these produces a bounce that does not match what the
performer heard. Several of them were missing before v1.1 and were restored;
see the [changelog](../CHANGELOG.md).

### Determinism

Live playback uses `Math.random()` — the instrument should not play the
identical thing twice. A bounce is a deliverable and has the opposite
requirement: re-rendering must produce identical bytes, so that a difference in
the output means a difference in the input.

```js
static mulberry32(seed) { /* … */ }
const rand = BureauEngine.mulberry32(seed);
```

The seed is reported in the export dialog and embedded in the filename. If no
seed is supplied, one is derived from the clock and `Math.random()` and then
disclosed, so any render can be reproduced after the fact.

### Progress

`OfflineAudioContext` exposes no progress event. Rather than animate a fake
curve, the render schedules ten `suspend()` checkpoints; each time the context
parks itself the bar advances and `resume()` is called. Where
`suspend`/`resume` is unsupported, the bar degrades honestly to a two-stage
reading, and a 120-second deadline guarantees the UI can never hang on a
stalled render.

Full byte-level detail: **[EXPORT.md](EXPORT.md)**.

---

## 10. The rendering layer

### One-way data flow

```
state ──▶ renderAllTracks() ──▶ DOM
  ▲                              │
  └──────── event handler ◀──────┘
```

There is no virtual DOM and no diffing. Every interaction that changes the
pattern rebuilds the grid. For up to 192 cells this measures around 1 ms — well
within a frame — and it eliminates the whole category of bug where the DOM and
the model disagree.

The cost of full re-render is **focus loss**: the focused element is destroyed
and focus falls back to `<body>`, which would make keyboard editing impossible.
`renderAllTracks()` therefore captures the focused cell before teardown and
restores it afterwards.

### The vector scope

A `requestAnimationFrame` loop reads byte time-domain data from the analyser
and strokes a polyline onto a 300 × 90 canvas. It runs continuously once audio
has been initialised, including while the transport is stopped, so the scope
shows the delay tail decaying.

A `shadowBlur` glow gives the trace its phosphor look. This is the single most
expensive thing in the render loop; it is acceptable at this canvas size and is
disabled under `prefers-reduced-motion` along with the scanline overlay.

### Responsive layout

Two breakpoints:

- **≤ 1100 px** — the two-column workspace collapses to a single column
- **≤ 800 px** — the footer grid collapses to a single column

Below 1100 px the sequencer takes the full width, which is the right priority:
the grid is the instrument, the telemetry rack is the readout.

---

## 11. Control flow: what happens on a click

Clicking a step cell:

```
1.  cell 'click' listener fires
2.  bureau.initAudio()          ← lazy AudioContext creation; satisfies autoplay policy
3.  e.shiftKey ? cycle ratchet 1→2→3→4 and force active
               : toggle step.active
4.  selectStep(tIdx, sIdx)      ← binds the inspector to this step
5.  renderAllTracks()           ← full rebuild; focus restored to the same cell
6.  (next scheduler wake)       ← the change is audible on the next pass of that step
```

Note step 2. Browsers refuse to start an `AudioContext` without a user gesture,
so every interaction path that could lead to sound calls `initAudio()` first.
This is why no explicit "click to enable audio" gate is needed.

Note step 6. Pattern edits are never applied retroactively — they take effect
the next time the scheduler reaches that step, which is the correct and
expected behaviour for a step sequencer.

---

## 12. Module boundaries and dependency direction

There are no modules, so boundaries are maintained by convention and enforced
by review. The intended direction is strictly one-way:

```
presentation  ──▶ domain  ──▶ audio
     │               │
     └───────────────┴──▶ (no reverse edges)
```

Concretely, these rules hold:

| Rule | Why |
|---|---|
| Synth functions never touch the DOM or `bureau.tracks` | Keeps them testable and reusable offline |
| `scheduleStep` never writes to the DOM directly | Only via the deferred cursor callback |
| `renderAllTracks` never mutates musical state | It is a projection, not a controller |
| Only `BureauEngine` owns `tracks`, `fx`, `bpm` | One source of truth |
| `loadPreset` writes state *and* syncs widgets | A preset is a whole-instrument state |

The two permitted exceptions, both deliberate and documented:

1. **`updateTrackVisualCursor`** reaches into the DOM from the domain layer,
   because it is the deferred half of a scheduling decision.
2. **`setupOscilloscope`** owns a `requestAnimationFrame` loop that reads the
   analyser, because a scope is inherently a view of the audio layer.

---

## 13. Design decisions

Recorded with rationale so they are not silently reversed. See also
[DESIGN.md](DESIGN.md) for the visual and interaction layer.

### D1 — A single state-owning class

**Decision.** All mutable state lives on `BureauEngine`.

**Alternatives.** A reducer/store; a reactive framework; plain globals.

**Rationale.** With one owner, "where does this value live?" has one answer.
A store pattern would add a subscription layer to a UI that has exactly four
kinds of widget. Globals would make the offline path able to reach live state
by accident.

**Cost.** The class is large. Mitigated by section banners and by the fact that
every method has a single, obvious responsibility.

---

### D2 — Rebuild rather than diff

**Decision.** `renderAllTracks()` recreates the grid on every change.

**Alternatives.** Fine-grained updates; a virtual DOM; per-cell mutation.

**Rationale.** At ~1 ms for 192 cells, diffing buys nothing measurable and
costs a reconciliation layer. Full rebuild makes divergence between model and
view structurally impossible.

**Cost.** Focus must be managed explicitly, and cell-level CSS transitions do
not survive the rebuild. Accepted; see [PERFORMANCE.md](PERFORMANCE.md).

---

### D3 — Global monotonic step counter

**Decision.** `stepIndex` increments forever; lanes take it modulo their length.

**Alternatives.** Per-lane cursors reset each bar.

**Rationale.** Per-lane cursors reset in phase and would re-align polyrhythmic
lanes every cycle, destroying the slow drift that is the instrument's premise.
A global counter makes lane lengths genuinely independent.

**Cost.** `stepIndex` grows without bound. At 360 BPM it reaches
`Number.MAX_SAFE_INTEGER` after roughly 4.7 billion years, so this is not a
practical concern.

---

### D4 — Crush on the master bus, not per voice

**Decision.** One `WaveShaper` between `busIn` and `masterFilter`.

**Alternatives.** Per-voice crushing; a `ScriptProcessor`/worklet.

**Rationale.** A dense 4× ratchet across six lanes at 210 BPM fires hundreds of
triggers per bar. Per-voice crushing means one 176 KB curve allocation per
trigger. Crushing the summed mix is also how the effect is conventionally used.

**Cost.** Individual voices cannot be crushed independently. Tracked as a
roadmap item — per-track buses.

---

### D5 — Seeded bounce, unseeded live

**Decision.** `Math.random()` live; `mulberry32(seed)` offline.

**Rationale.** A performance should differ each pass; a deliverable should not.
The two requirements genuinely conflict and the split resolves it.

**Cost.** A bounce is not a recording of any specific live pass. This is
intentional and documented in the UI.

---

### D6 — Full mirror instead of shared graph code

**Decision.** `exportWav()` constructs its own node graph rather than
refactoring the bus into a shared builder.

**Alternatives.** A `buildBus(ctx)` factory used by both paths.

**Rationale.** A shared factory is the better long-term answer, but the two
graphs differ in ways that matter (offline has no analyser; offline needs a
seeded RNG; live needs parameter automation on user input). Duplicating the
graph makes the parity requirement *visible in the source* rather than hidden
in a factory's branch logic.

**Cost.** Two graphs can drift. Mitigated by the parity table in §9 and by
listing it as a review checklist item.

---

### D7 — 32 pre-allocated steps

**Decision.** Every lane always has 32 slots; `currentLength` gates access.

**Rationale.** Length changes become non-destructive — shortening a lane hides
steps, extending it brings them back. It also removes bounds checks from the
hot path.

**Cost.** ~30 unused objects per lane. Negligible.

---

### D8 — No framework

**Decision.** Direct DOM construction in vanilla JavaScript.

**Rationale.** The UI is four widget types over one flat array. A framework
would be larger than the application it serves, would introduce a build step
(C2), and would make the file non-portable.

**Cost.** Manual focus management and manual ARIA. Both are handled explicitly;
see [ACCESSIBILITY.md](ACCESSIBILITY.md).

---

## 14. Invariants

These must hold after any change. `tools/validate.mjs` enforces the first four
automatically; the rest are review responsibilities.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Every `getElementById` target exists in the markup | `tools/validate.mjs` |
| I2 | Every `label[for]` resolves to a control id | `tools/validate.mjs` |
| I3 | Every `var(--x)` is declared in `:root` | `tools/validate.mjs` |
| I4 | The inline script parses | `tools/validate.mjs` |
| I5 | Live and offline graphs stay parameter-parallel | Review, §9 table |
| I6 | Synth functions never touch the DOM | Review |
| I7 | `renderAllTracks` never mutates musical state | Review |
| I8 | Audio events are always scheduled against `currentTime`, never "now" | Review |
| I9 | `stepIndex` is never reset | Review |
| I10 | Every pointer interaction has a keyboard equivalent | Review, [ACCESSIBILITY.md](ACCESSIBILITY.md) |

---

## 15. Extension points

Where to make common changes, and what to watch for.

### Add a seventh voice

1. Append to `TRACK_CONFIGS` (id, name, type, colour, `steps`, `defaultGain`).
2. Add a `case 6` to the switch in `playTrackSound`.
3. Write `synthSub2(ctx, dest, time, vel, pitchShift)`.
4. Add a length entry to every preset in `PRESETS` (or accept the `|| 16`
   fallback).
5. Extend the `mute`/`solo` defaults if they are ever reintroduced as arrays.

**Watch for:** presets index `lengths` and `data` positionally; a missing entry
falls back to 16 steps silently.

### Add a master effect

1. Create the node in `setupMasterBus()` and splice it into the chain.
2. Add its parameter to `fx` and a `<input type="range">` to the rack.
3. Add a binding that writes the parameter with `setValueAtTime`.
4. **Mirror all three in `exportWav()`.** This is the step that gets forgotten;
   skipping it breaks I5.
5. Add it to every preset, or document the default.

### Add a preset

See [PATTERNS.md](PATTERNS.md) for the schema and an authoring guide.

### Change a voice's sound

This is a sonic change. Read the review path in
[CONTRIBUTING.md](../CONTRIBUTING.md) — presets are expected to stay
recognisable, and any change to a generator affects all nine.

---

*See also: [SOUND-DESIGN.md](SOUND-DESIGN.md) · [API.md](API.md) ·
[PATTERNS.md](PATTERNS.md) · [EXPORT.md](EXPORT.md) ·
[PERFORMANCE.md](PERFORMANCE.md)*
