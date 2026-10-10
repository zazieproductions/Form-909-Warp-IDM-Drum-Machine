<div align="center">

# FORM 909-WARP

### The Bureau of Unreasonable Rhythms

**A precision metric laboratory for braindance, drill and glitch.**

Six synthesis voices. Polyrhythmic lanes. Per-step parameter locks.
Offline 24-bit WAV rendering. Zero dependencies, zero build step, one file.

[![Live demo](https://img.shields.io/badge/demo-open%20in%20browser-38bdf8?style=for-the-badge)](https://zazieproductions.github.io/Form-909-Warp-IDM-Drum-Machine/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-10b981?style=for-the-badge)](#why-zero-dependencies)
[![Build](https://img.shields.io/badge/build-none%20required-64748b?style=for-the-badge)](#quick-start)
[![Engine](https://img.shields.io/badge/engine-web%20audio%20api-f59e0b?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![License](https://img.shields.io/badge/license-MIT-94a3b8?style=for-the-badge)](LICENSE)
[![Lines of code](https://img.shields.io/badge/loc-2.7k-94a3b8?style=for-the-badge)](#project-scale)

👉 **[Open it live in your browser](https://8080-imy6mydufmrufm0dp3in1.e2b.app)** — the full drum machine, running right now. No install, no build, just click and play.

</div>

---

## Abstract

**Form 909-WARP** is a browser-native drum machine and step sequencer built for
the rhythmic vocabulary of IDM — the Warp/braindance lineage of Autechre,
Aphex Twin, Squarepusher and Boards of Canada, where a bar is a place to put
unreasonable things rather than a place to put a backbeat.

Everything you hear is synthesised at runtime. There are no samples, no audio
files, no WebAssembly, no `npm install`. A single HTML file contains the
sequencer, six DSP voices, a master effects bus, an oscilloscope and an offline
renderer that writes a real RIFF/WAVE file. Open it and it runs; clone it and
you own all of it.

The instrument is built around three ideas that ordinary step sequencers
usually treat as edge cases:

1. **Lanes are not forced to agree.** Each of the six tracks carries its own
   pattern length from 1 to 32 steps, so a 13-step kick against a 7-step
   percussion voice against a 16-step hat produces a cycle that takes 1456
   steps to repeat.
2. **Every step is a parameter, not a bit.** Velocity, ratchet count,
   trigger probability and pitch offset are per-step values with a dedicated
   inspector — the discipline of a tracker applied to a grid.
3. **A performance is not deterministic.** Probability, swing, humanise
   jitter and drill injection mean the pattern you drew is a distribution of
   patterns, not one fixed pattern — and the bounce is seeded so it is
   reproducible anyway.

---

## Table of contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Interface map](#interface-map)
- [Architecture at a glance](#architecture-at-a-glance)
- [The six voices](#the-six-voices)
- [How the rhythm engine works](#how-the-rhythm-engine-works)
- [Project scale](#project-scale)
- [Why zero dependencies](#why-zero-dependencies)
- [Documentation](#documentation)
- [Browser support](#browser-support)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Design & engineering rationale](#design--engineering-rationale)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## Quick start

There are three ways in, and none of them involve a toolchain.

### 1. Open the file

```bash
git clone https://github.com/zazieproductions/Form-909-Warp-IDM-Drum-Machine.git
cd Form-909-Warp-IDM-Drum-Machine
```

Then open **`Form-909 Warp IDM Drum Machine.html`** in any modern browser.

> **Note on the filename.** The app deliberately ships as one self-contained
> HTML file so it can be opened from a USB stick, an email attachment or a
> `file://` URL. The filename contains spaces; if you serve it over HTTP,
> percent-encode them (`Form-909%20Warp%20IDM%20Drum%20Machine.html`), or use
> the dev server below, which serves it at `/`.

### 2. Run the bundled dev server

Node 18 or newer, no packages required:

```bash
npm run serve          # → http://localhost:8080/
npm run serve -- 3000  # or pick a port
```

### 3. Just use it

No build, no install, no network calls except the three Google Fonts the
interface uses. If fonts are unavailable the instrument still works; only the
typeface changes.

### First ninety seconds

| Do this | Get this |
|---|---|
| Press <kbd>Space</kbd> | Transport starts. *Case 01: Confield Lattice* is loaded at 168 BPM. |
| Click any step cell | Toggle that trigger. `Shift`+click cycles its ratchet 1→2→3→4. |
| Click a cell, then move **VELOCITY** / **PROBABILITY** / **PITCH P-LOCK** | Per-step parameter locks. |
| Press **MUTATE** | Stochastic deviation spread across the whole matrix. |
| Press **GENERATIVE SEED** | A completely new pattern. |
| Change a lane's **LEN** to 13 | That lane goes polyrhythmic against the others. |
| Press **GEN** (Euclid) | A Euclidean distribution of hits across the lane. |
| Press **EXPORT 24-BIT WAV** | Offline render → a real `.wav` file downloads. |

---

## What it does

### Sequencer

- **6 independent tracks**, each with 32 allocated step slots and a
  user-settable active length of **1–32 steps**.
- **Per-step parameter locks**: velocity (0–127), ratchet (1–4),
  probability (0–100 %) and pitch offset (±24 semitones).
- **Mute and solo** per track, with solo evaluated across the whole matrix.
- **Euclidean rhythm generation** per lane via the Bjorklund/bucket algorithm,
  at randomised density between 25 % and 75 %.
- **Global probabilistic warp**: a master probability gate, a drill-density
  injector that promotes plain steps into 2×/4× ratchets, and swing from 0–50 %
  applied to odd-numbered steps.
- **Humanise**: ±0–25 ms of timing jitter, deliberately *not* applied to the
  first ratchet of a burst so the downbeat stays legible.

### Synthesis

- Six original DSP voices, each built from Web Audio primitives — oscillators,
  noise buffers, biquad filters, wave shapers and gain envelopes. No samples.
- Every voice is **pitch-lockable** and **velocity-scaled**, and every voice is
  scheduled with sample-accurate start times rather than `setTimeout` firing.

### Master bus

- Bit-crush (16-bit → 3-bit amplitude quantisation)
- Saturation / drive (soft-clip transfer curve, 4× oversampled)
- Resonant low-pass filter (150 Hz – 18 kHz)
- Feedback delay with independent time and feedback controls
- Brickwall-style limiter
- Live vector scope

### Export

- Offline render through `OfflineAudioContext` at 48 kHz
- 2, 4, 8 or 16 patterns per bounce
- **24-bit PCM** RIFF/WAVE (16-bit available via API)
- Fully seeded and reproducible
- Node-for-node identical to the live signal path

---

## Interface map

```
┌──────────────────────────────────────────────────────────────────────────┐
│ FORM 909-WARP   THE BUREAU OF UNREASONABLE RHYTHMS                       │
│                 ● SYNC   [▶ EXECUTE]  BPM[168]  [MUTATE]  [EXPORT WAV]   │
├─────────────────┬────────────────────────────────────────────────────────┤
│ VECTOR SCOPE    │  SYNCHRONOUS SUB-DIVIDED LANES                         │
│  ╱╲  ╱╲╱╲       │  [PURGE ALL] [GENERATIVE SEED]                         │
│ ─────────────── │                                                        │
│ DIRECTIVE 44:   │  KICK  ▓░░▒░░░▓░▒░░░▓  MUTE SOLO   LEN[16] EUCLID[GEN] │
│ ALL SYNC VIOL.  │  SNARE ░░░▓░▒░░░▓░░░░  MUTE SOLO   LEN[16] EUCLID[GEN] │
│                 │  HAT   ▒░▒░▓░▒░▓░▒░▒▓  MUTE SOLO   LEN[16] EUCLID[GEN] │
│ CURATED         │  CONK  ░▒░░▓░░▒░░▓░░░  MUTE SOLO   LEN[12] EUCLID[GEN] │
│ DISSONANCE      │  GLTCH ░░▓░░░▒░░░▓▒░░  MUTE SOLO   LEN[14] EUCLID[GEN] │
│ ARCHIVE         │  SUB   ▓░░░▒░░░▓░░░▒░  MUTE SOLO   LEN[16] EUCLID[GEN] │
│ ┌─────────────┐ │                                                        │
│ │ CONFIELD    │ │  SELECTED CELL TELEMETRY • KICK • STEP 1               │
│ └─────────────┘ │  VELOCITY  RATCHET  PROBABILITY  PITCH P-LOCK          │
│                 │    100       1x        100%         0 st               │
│ MASTER ANOMALY  │                                                        │
│ BIT CRUSH  15%  │                                                        │
│ DRIVE SAT  25%  │                                                        │
│ TIME JITTER 4ms │                                                        │
│ CUTOFF   16.5k  │                                                        │
│ DELAY     180ms │                                                        │
│ FEEDBACK    32% │                                                        │
│                 │                                                        │
│ COLLAPSE MATRIX │                                                        │
│ GLOBAL PROB 100%│                                                        │
│ DRILL DENS.  20%│                                                        │
│ SWING %      12%│                                                        │
└─────────────────┴────────────────────────────────────────────────────────┘
```

---

## Architecture at a glance

The engine is a single class, `BureauEngine`, holding all mutable state. The UI
is a render function with no framework. The two meet through direct method
calls — no virtual DOM, no event bus, no reactive layer.

```
                       ┌─────────────────────────────┐
   ┌──────────┐        │        BureauEngine         │
   │    UI    │───────▶│  tracks[6] · fx{} · bpm     │
   │  render  │◀───────│  stepIndex · nextNoteTime   │
   └──────────┘ state  └──────────────┬──────────────┘
                                      │
      ┌───────────────────────────────┼───────────────────────────────┐
      │  lookahead scheduler (25 ms)  │                               │
      ▼                               ▼                               ▼
 scheduleStep()              playTrackSound()                 exportWav()
      │                               │                               │
      │  polyrhythm index             │  voice dispatch               │  OfflineAudioContext
      │  probability gate             │  ─ synthKick                  │  seeded PRNG
      │  ratchet expansion            │  ─ synthSnare                 │  mirrored bus
      │  humanise jitter              │  ─ synthHat                   │  24-bit encode
      └───────────────┬───────────────┘  ─ synthPerc                  │
                      │                  ─ synthGlitch                │
                      ▼                  ─ synthSub                   ▼
        ┌──────────────────────────────────────────┐        ┌──────────────────┐
        │                MASTER BUS                │        │   RIFF/WAVE      │
        │  busIn → crush → filter → drive → limit  │        │   Blob → .wav    │
        │              ↘ delay ↗                   │        └──────────────────┘
        └──────────────────────┬───────────────────┘
                               ▼
                     analyser → destination
                               │
                               ▼
                        vector scope (canvas)
```

Three properties are load-bearing:

- **The scheduler never sleeps on the audio clock.** A `setInterval` wakes
  every 25 ms and schedules any step falling inside the next 100 ms. Audio
  events are queued against `AudioContext.currentTime`, so UI jank, garbage
  collection and tab throttling cannot move a hit.
- **Rendering is one-way.** State mutates, `renderAllTracks()` rebuilds the
  grid from state, and nothing reads visual state back into the model.
- **Live and offline paths are structurally parallel.** The bounce rebuilds
  the identical node graph rather than approximating it.

Full treatment: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## The six voices

| # | Voice | Engine | Character |
|---|---|---|---|
| 0 | **KICK / TRANSIENT FM** | Sine with 3-stage exponential pitch sweep + triangle FM click + exponentially decayed noise transient | Sub-punch with an audible beater |
| 1 | **SNARE / METALLIC WIRE** | Triangle body with pitch drop + bandpass-filtered white noise (Q 2.4) | Wire snare, resonant and snappy |
| 2 | **HAT / REZ MICROSPLICE** | Six square oscillators at inharmonic ratios `[2, 3.01, 4.15, 5.4, 6.8, 8.2]` through a 6.8 kHz highpass | Metallic, 808-adjacent |
| 3 | **CONK / MODULAR CLANG** | Sine carrier with downward sweep, modulated by a sawtooth at ratio 2.87 | Industrial FM bell |
| 4 | **GLITCH / BIT SHREDDER** | Randomised saw/triangle, exponential pitch collapse to 120 Hz, randomised bandpass at Q 8 | Non-deterministic grain |
| 5 | **ACID SUB / HARMONIC SINK** | Sawtooth through an enveloped resonant lowpass (Q 5.5) | 303-derived squelch |

Every voice takes `(ctx, dest, time, vel, pitchShift)` and is therefore
context-agnostic: the same function runs against the live `AudioContext` and
against the `OfflineAudioContext` during a bounce.

Full treatment: **[docs/SOUND-DESIGN.md](docs/SOUND-DESIGN.md)**.

---

## How the rhythm engine works

### Timing

The scheduler runs the standard Web Audio lookahead pattern. A timer wakes
every 25 ms; while the next note falls within the next 100 ms, it schedules and
advances. `stepIndex` is a monotonically increasing global counter, and each
lane indexes it modulo its own length:

```
trackStepIndex = globalStep % track.currentLength
```

That single modulo is the entire polyrhythm mechanism. With lengths 13, 13,
16, 7, 9 and 13 the composite cycle is `lcm(13, 16, 7, 9) = 13 104` steps — a
little over 19 minutes at 168 BPM before the matrix realigns.

### Swing

Applied to odd-numbered global steps only:

```
swingOffset = (swing × 0.35) × (secondsPerBeat × 0.25)
```

The 0.35 coefficient caps the maximum displacement at 35 % of a step, which
keeps swing musical rather than turning the grid into a shuffle of its own.

### Ratchets

A ratchet divides a step into 1–4 equal sub-triggers. Each repeat loses 12 %
velocity with a floor of 20, so a 4× burst reads as a decaying drill fill
rather than four identical clicks.

### Probability

```
if (random() × 100 > step.probability × fx.globalProb) skip
```

Per-step and global probability multiply rather than override, so a 60 % step
under an 80 % global gate fires 48 % of the time.

### Humanise

```
jitter = (random() − 0.5) × (fx.humanize / 1000)     // seconds
triggerTime = max(stepTime, stepTime + offset + jitter)
```

The `max()` clamp matters: without it, jitter on the first sub-trigger of a
step could push a hit earlier than the step boundary and leak into the
previous step.

Full treatment: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** and
**[docs/PATTERNS.md](docs/PATTERNS.md)**.

---

## Project scale

| Metric | Value |
|---|---|
| Total source | **1 file**, 2 736 lines, ≈93 KB |
| JavaScript | ≈1 727 lines (one inline `<script>`) |
| CSS | ≈737 lines (one inline `<style>`) |
| Runtime dependencies | **0** |
| Build step | **none** |
| Synthesis voices | 6 |
| Allocated steps per track | 32 |
| Selectable lane length | 1–32 |
| Shipped presets | 9 |
| Export sample rate | 48 kHz |
| Export bit depth | 24-bit (16-bit available) |
| Tooling scripts | 3 (validate, link check, dev server) |

---

## Why zero dependencies

This is a deliberate engineering constraint, not an accident of scope.

- **Audio instruments are long-lived artefacts.** A package that is
  unmaintained in three years is a liability in an app that should still run in
  fifteen. Everything here is built on the Web Audio API, which is a W3C
  standard with a stability guarantee no npm package can offer.
- **The hard parts are already in the platform.** Lookahead scheduling,
  `WaveShaper`, `BiquadFilter`, `DynamicsCompressor`, `OfflineAudioContext` and
  `AnalyserNode` cover what a framework would otherwise provide.
- **A single file is a distribution format.** It survives being emailed,
  archived, forked, embedded in a CMS or opened from a filesystem with no
  server. A `node_modules` tree does not.
- **It is legible.** A reviewer can read the entire engine in one sitting.
  For a portfolio piece, that is the point.

The trade-off is accepted knowingly: no module system, no type-checking, no
framework-level state management. See
**[docs/MAINTAINABILITY.md](docs/MAINTAINABILITY.md)** for how those risks are
managed, and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the
conventions that keep a 1 700-line script navigable.

---

## Documentation

| Document | Contents |
|---|---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | System design, state model, scheduler, signal flow, module boundaries, design decisions with rationale |
| **[docs/SOUND-DESIGN.md](docs/SOUND-DESIGN.md)** | Voice-by-voice DSP reference with parameters, envelopes and spectra |
| **[docs/API.md](docs/API.md)** | `BureauEngine` reference: every method, property, event binding and DOM contract |
| **[docs/PATTERNS.md](docs/PATTERNS.md)** | Pattern data model, preset schema, authoring guide, Euclidean algorithm |
| **[docs/EXPORT.md](docs/EXPORT.md)** | Offline rendering pipeline, determinism, WAV byte layout |
| **[docs/WORKFLOWS.md](docs/WORKFLOWS.md)** | End-to-end user workflows, keyboard map, recipes |
| **[docs/TESTING.md](docs/TESTING.md)** | Test strategy, manual matrices, automated static checks |
| **[docs/PERFORMANCE.md](docs/PERFORMANCE.md)** | Budgets, allocations, profiling methodology, known hot paths |
| **[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)** | Keyboard, ARIA, motion, contrast; conformance and gaps |
| **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** | GitHub Pages, self-hosting, embedding, archival |
| **[docs/DESIGN.md](docs/DESIGN.md)** | Visual language, interaction design, the Bureau conceit |
| **[docs/MAINTAINABILITY.md](docs/MAINTAINABILITY.md)** | Long-term stewardship, invariants, refactoring policy |
| **[docs/ROADMAP.md](docs/ROADMAP.md)** | Prioritised future work with rationale |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How to propose, build and land a change |
| **[CHANGELOG.md](CHANGELOG.md)** | Released changes, kept current |

---

## Browser support

Requires the Web Audio API and `OfflineAudioContext`.

| Browser | Status | Notes |
|---|---|---|
| Chrome / Edge 90+ | ✅ Full | Reference implementation |
| Firefox 90+ | ✅ Full | |
| Safari 14.1+ | ✅ Full | Requires a user gesture before audio starts — the UI handles this |
| Mobile Chrome / Safari | ⚠️ Degraded | Works; layout is compact and touch targets are small. Not a design target |

Progressive enhancement: if `OfflineAudioContext` is unavailable, export is
unavailable but sequencing continues. If `AudioContext` is unavailable the
transport is inert and the UI remains explorable.

---

## Contributing

This is a portfolio-grade open-source project and contributions are welcome.
The short version:

```bash
npm run check     # validate the app + verify all doc links
```

Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** before opening a pull
request. It covers the no-dependency rule (it is load-bearing, not
incidental), the code conventions the single-file format requires, and the
sonic-change review path for anything that alters how a preset sounds.

Good first contributions are listed in
**[docs/ROADMAP.md](docs/ROADMAP.md)** under *Good first issue*.

---

## Roadmap

Near-term direction, in priority order:

1. **Pattern save/load** — serialise the matrix to JSON and to a shareable URL
   fragment, so a pattern is not lost on reload.
2. **Per-track bus effects** — move crush and drive off the master so voices
   can be treated independently.
3. **Test harness** — headless render assertions on the offline path.
4. **MIDI output and clock sync** — the app is already a precise clock.
5. **Modularisation with an import-map escape hatch** — split the source while
   keeping a build-free single-file distribution.

Full rationale and trade-offs: **[docs/ROADMAP.md](docs/ROADMAP.md)**.

---

## Design & engineering rationale

A short account of the decisions a reviewer is most likely to question.

<details>
<summary><strong>Why one file instead of modules?</strong></summary>

The single-file format is the distribution strategy, and for an audio
instrument it is a strong one: the artefact is portable, archivable and
inspectable. It is also the reason the project can claim zero dependencies and
no build step honestly, rather than "no build step, provided you run this
bundler first".

The cost is a 1 700-line script. That is managed with conventions rather than
tooling: section banner comments, a single state-owning class, pure-ish synth
functions that take a context parameter, and a validator in CI that catches the
failure mode the format invites — a `getElementById` whose markup was removed.
</details>

<details>
<summary><strong>Why rebuild the whole grid on every change?</strong></summary>

`renderAllTracks()` destroys and recreates up to 192 cells per interaction.
Measured cost is around 1 ms, well inside a frame, and it removes an entire
class of state-synchronisation bug: the DOM can never disagree with the model,
because the DOM is always derived from the model.

The cost is focus loss, which would make keyboard editing impossible. That is
solved explicitly: the focused cell is captured before teardown and restored
after, so every toggle keeps the caret where the user left it.
</details>

<details>
<summary><strong>Why is the bounce seeded when live playback is not?</strong></summary>

Live playback uses `Math.random()` on purpose — the instrument should not play
the identical thing twice. A bounce has the opposite requirement: it is a
deliverable, and re-rendering it must produce identical bytes so that a change
in the file means a change in the audio, not a change in the coin flips. The
offline path therefore draws from a `mulberry32` stream seeded per render, and
the seed is reported in the export dialog and the filename.
</details>

<details>
<summary><strong>Why is crush on the master bus, not per voice?</strong></summary>

The original design threaded a `crush` flag into all six generators, and none
of them read it. Fixing it per-voice would have meant one `WaveShaper` per
fired trigger — and with 4× ratchets across six lanes at 210 BPM that is
hundreds of 176 KB curve allocations per bar. A single shaper on the master bus
is both cheaper and more musically conventional: crushing the summed mix is how
the effect is normally used.
</details>

<details>
<summary><strong>Why 24-bit export?</strong></summary>

The render graph is float32 end to end, and the material has an unusually wide
dynamic range: quiet micro-grain detail sits underneath a loud, limited master.
Truncating that to 16-bit discards roughly 48 dB of resolution exactly where
the interesting detail lives. 24-bit is also what a mastering engineer expects
to receive, and the encoder cost is three bytes per sample.
</details>

<details>
<summary><strong>Why no tests?</strong></summary>

There is no unit-test suite, and that is a real gap tracked in
[docs/TESTING.md](docs/TESTING.md). Audio DSP is genuinely hard to unit-test —
the meaningful assertions are perceptual and spectral — but the offline render
path is deterministic, seeded and pure, which makes it unusually testable.
Building that harness is the highest-priority engineering item on the
[roadmap](docs/ROADMAP.md). What exists today is static analysis
(`tools/validate.mjs`) plus a documented manual test matrix.
</details>

---

## License

Released under the **[MIT License](LICENSE)**.

Copyright © 2025 zazieproductions.

You may use, copy, modify, merge, publish, distribute, sublicense and sell
copies of this software, provided the copyright notice and permission notice
are included. The software is provided "as is", without warranty of any kind.

The visual design, the interface copy and the "Bureau of Unreasonable Rhythms"
concept are part of the project's presentation; the code is MIT-licensed and
free to use.

---

## Acknowledgements

Built on the Web Audio API, and on the rhythmic vocabulary established by
Autechre, Aphex Twin, Squarepusher, Boards of Canada, µ-Ziq, Luke Vibert and
the rest of the Warp roster — artists who treated the sequencer grid as a site
of experiment rather than a metronome.

The preset names are homages. They are not affiliated with, endorsed by, or
connected to those artists or their labels.

The lookahead scheduling pattern follows the approach documented by Chris
Wilson in *A Tale of Two Clocks*. The Euclidean generator implements the
Bjorklund algorithm as popularised by Godfried Toussaint's
*The Euclidean Algorithm Generates Traditional Musical Rhythms*.
