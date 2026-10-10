# Changelog

All notable changes to Form 909-WARP are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with one project-specific interpretation: **a change that makes existing
patterns sound materially different is a major version bump**, even when no API
moved. A pattern is a user artefact.

---

## [Unreleased]

### Added

- **Expanded the curated pattern archive from 9 to 21 cases**, adding offset,
  breakcore, ambient, granular-glitch, high-speed drill and odd-meter material.
- **Style-aware generative patterns** with Braindance, Breakcore, Glitch
  Collage, Polyrhythm, Sparse/Ambient, Drill Fracture and Surprise Mix modes.
  Each seed varies lane lengths, tempo, role-shaped density, ratchets, pitch
  locks and matching performance controls.
- **Real-time session recording.** `RECORD LIVE` captures the post-effects
  master output through the browser's `MediaRecorder`; `STOP + SAVE` downloads
  a playable audio file in a browser-supported format. Recording starts the
  transport when idle, but leaves an already-running transport alone on stop.
- Correct handling of preset velocity/probability locks set to zero.
- Made audio initialisation truly idempotent so repeated controls/recording
  gestures do not spawn duplicate oscilloscope animation loops.

### Notes

- Live captures use the browser's supported compressed audio container (often
  WebM/Opus), unlike the separate deterministic 24-bit offline WAV export.

## [1.1.0] — 2025-11-14

A correctness and accessibility release. Three advertised capabilities did not
match their implementation; all three were corrected, and the interface was
brought to WCAG 2.2 AA.

### Fixed

#### Bit crush was a dead control

The `BIT CRUSH` slider stored its value and nothing else. `playTrackSound()`
computed an `isCrush` flag, threaded it into all six voice generators as a
`crush` parameter — and no generator body ever read it. The control had no
effect on the audio at any setting.

- **Implemented** the missing DSP: a `WaveShaper` stair-step quantiser mapping
  `fx.crush` 0→1 onto 16→3 bits of amplitude resolution.
- **Placed on the master bus** rather than per voice, because a dense 4× ratchet
  across six lanes fires hundreds of triggers per bar and each curve allocation
  is 176 KB.
- **Memoised on bit depth**, so a full slider sweep allocates 14 curves rather
  than 101.
- **Set `oversample: 'none'`** deliberately — the opposite of the drive stage.
  Oversampling would low-pass the staircase and largely undo the effect.
- **Removed** the now-dead `crush` parameter from all six generator signatures.
- **Wired** the slider and `loadPreset()` to rebuild the curve.

*Audible consequence: presets with a non-zero crush setting now sound as
intended. `vnares` (0.42) and `boiler` (0.38) change most.*

#### The bounce did not match playback

`exportWav()` omitted several steps that live playback applies. A bounce was
audibly cleaner, denser and louder than what the performer had been monitoring.

| Restored | Effect of the omission |
|---|---|
| Humanise jitter | Timing was mechanically exact |
| Probability gate | Every step fired, every time |
| Drill injection | Authored ratchets only; no injected drills |
| Bit-crush stage | Bounce was clean regardless of the setting |
| Master trim (0.88) | Bounce was ≈1.1 dB hotter |
| Limiter attack and release | Different compression behaviour |
| Filter Q (1.8) | Slightly different resonance |

All are now mirrored. See
[docs/EXPORT.md §3](docs/EXPORT.md#3-parity-with-live-playback).

#### The export claimed 24-bit and wrote 16-bit

The UI advertised "EXPORT 24-BIT WAV" and reported "ENCODING 24-BIT PCM", while
`bufferToWaveBlob()` wrote `BitsPerSample = 16`.

- **Implemented true 24-bit encoding** rather than relabelling the button — the
  feature was worth having, and the render graph is float32 end to end.
- 16-bit remains available via `{ bitDepth: 16 }`.
- Corrected a related scaling bug in the 16-bit path: values between −0.5 and 0
  were scaled by 32767 instead of 32768, a 1-LSB asymmetry.

#### Export progress was not real

`exportWav()` accepted an `onProgress` callback and never called it; the UI set
the bar to 40 % and then 100 %.

- Progress now derives from ten scheduled `suspend()` checkpoints on the
  `OfflineAudioContext`.
- Degrades honestly (5 % → 50 % → 100 %) where `suspend`/`resume` is
  unsupported, rather than animating a plausible-looking fake.
- A 120-second deadline guarantees the UI cannot hang on a stalled render.

#### Bounces were not reproducible

The offline path used `Math.random()`, so re-rendering the same pattern
produced different audio.

- `exportWav()` now draws from a seeded `mulberry32` stream.
- The seed is reported in the export dialog and returned on the result object.
- Passing `{ seed }` reproduces a render byte-for-byte.
- Live playback still uses `Math.random()` — a performance *should* differ
  between passes; a deliverable should not.

#### Shadow solo state could desynchronise

`BureauEngine` maintained `this.mutes` and `this.solos` arrays alongside
`track.mute` and `track.solo`. `this.mutes` was never read at all.

- Removed both arrays; solo is now derived with
  `this.tracks.some(t => t.solo)`, giving one source of truth.

#### Missing document type declaration

`<!DOCTYPE html>` was absent, putting every browser into quirks mode.

#### The engine aborted entirely when Web Audio was unavailable

`initAudio()` called `new AudioContext(...)` unguarded. If Web Audio was
missing — an old browser, a locked-down environment, a blocked context — the
exception propagated into the click handler and aborted it *before* the pattern
edit it was guarding had been applied. The interface was not explorable, which
contradicted the documented progressive-enhancement behaviour.

- `initAudio()` no longer throws; it returns a boolean and sets
  `audioUnavailable`, so the instrument is silent but fully usable.
- `start()` refuses to schedule without an audio context.
- `togglePlayback()` announces the degradation instead of failing silently.
- The vector scope is isolated in its own `try`/`catch`: a canvas without a 2D
  context now costs the waveform, not the audio.

#### `exportWav()` crashed when optional arguments were `null`

Default parameters apply only to `undefined`, not `null`. Passing
`exportWav(bars, null, null)` — a natural thing for a caller with an optional
callback — threw on the first progress report. Optional arguments are now
normalised.

### Added — accessibility

The interface had no ARIA, no focus management and no keyboard path to the grid.

**Keyboard**

- Step cells are operable: <kbd>Enter</kbd> toggles,
  <kbd>Shift</kbd>+<kbd>Enter</kbd> cycles the ratchet, <kbd>←</kbd>/<kbd>→</kbd>
  move within a lane.
- Only active steps join the tab order, so traversing the grid visits the notes
  that sound rather than all 192 positions.
- <kbd>Esc</kbd> closes the export modal; <kbd>Tab</kbd> is trapped inside it.
- The global <kbd>Space</kbd> transport binding stands down when focus is in a
  form control or a step cell.

**Focus**

- `:focus-visible` outlines throughout, so pointer users do not see rings.
- **`renderAllTracks()` now preserves focus across re-render.** It destroys and
  rebuilds the grid, which previously dropped focus to `<body>` — making
  keyboard editing impossible, since every toggle ended the session. The focused
  cell is captured before teardown and restored afterwards.

**Semantics**

- Step cells: `role="button"`, `aria-pressed`, and an accessible name carrying
  everything the visual cell encodes —
  *"KICK / TRANSIENT FM, step 3, on, ratchet 2 times, plus 7 semitones, probability 80 percent."*
- Mute, solo, transport and the Euclid generators: `aria-pressed` and
  `aria-label`.
- All 13 range inputs and both number inputs: explicit `<label for>`.
- Oscilloscope: `role="img"` with a label. Status ticker: `role="status"`,
  `aria-live="polite"`.
- Export modal: `role="dialog"`, `aria-modal`, labelled, with `hidden` as the
  single source of truth for visibility.
- Progress bar: `role="progressbar"` with a live `aria-valuenow`.
- Every inline SVG: `aria-hidden="true"`.

**Motion and contrast**

- `prefers-reduced-motion: reduce` neutralises all animations and removes the
  scanline overlay, without changing layout or hit targets.
- `prefers-contrast: more` raises border contrast and lightens inactive cells.
- **`--text-dim` corrected** from `#64748b` to `#74839a`. The old value measured
  3.82:1 on `--panel-bg`, failing WCAG AA for the 9–10 px labels it is used on.
  The new value measures 4.72:1.

### Added — project

- `tools/validate.mjs` — six classes of structural check, running in CI
- `tools/check-links.mjs` — documentation link integrity
- `tools/serve.mjs` — dependency-free dev server
- `package.json` with `validate`, `links`, `check` and `serve` scripts
- `.github/workflows/ci.yml` — validation and link checks on Node 18 and 20
- `.github/workflows/pages.yml` — GitHub Pages deployment
- Issue and pull request templates
- Full documentation set under `docs/` and at the repository root

### Changed

- Export filename now includes the bit depth:
  `BUREAU_UNREASONABLE_168BPM_24BIT_2025-11-14T09-32-07.wav`
- The export dialog reports the seed used.
- The play button's label, icon and `aria-pressed` are produced by a single
  `renderPlayButton()` function instead of duplicated markup strings.
- Mute and solo announce through the ticker.
- Added `<meta name="description">`, Open Graph tags and `<meta name="color-scheme">`.

### Known issues

Documented rather than deferred silently — see
[docs/ACCESSIBILITY.md §8](docs/ACCESSIBILITY.md#8-known-gaps).

- Step state is conveyed by colour alone (mitigated by `aria-pressed` and the
  accessible name).
- The status ticker rotates decorative content into an `aria-live` region every
  7 seconds while playing.
- `user-select: none` is applied globally.
- Touch targets are below 44 × 44 px; mobile is not a design target.
- The focus trap is manual rather than a native `<dialog>`.
- There is no automated test suite.

---

## [1.0.0] — 2025-10-28

Initial release.

### Added

- Six-voice synthesis engine built entirely from Web Audio primitives: FM kick,
  dual-layer snare, six-operator metallic hat, FM percussion bell, randomised
  glitch grain, and acid sub.
- Polyrhythmic step sequencer: six lanes, 32 allocated slots each, individually
  selectable lengths from 1 to 32 steps.
- Per-step parameter locks: velocity (0–127), ratchet (1–4), probability (0–100 %)
  and pitch offset (±24 semitones).
- Lookahead scheduler: 25 ms wake interval, 100 ms scheduling horizon.
- Swing (0–50 %) on odd steps, with velocity-decayed ratchet expansion.
- Global probability gate, drill-density injection and humanise jitter (0–25 ms).
- Master bus: bit crush, drive saturation, resonant low-pass, feedback delay,
  limiter, master trim.
- Live vector scope on a CRT-styled canvas.
- Euclidean rhythm generation per lane via the Bjorklund algorithm.
- **MUTATE** (stochastic deviation) and **GENERATIVE SEED** (new pattern).
- Nine curated presets: Confield Lattice, Drukqs Drill Incident, Squarepusher's
  Slip, Sub-Surface 13/16 Poly, Gonkulator Modular FM, Snares 7/8
  Break-Stutter, Raster Minimalism, Bureau Boiler Room, Blank Slate.
- Offline WAV export at 48 kHz, in 2/4/8/16-pattern lengths.
- Responsive layout at 1100 px and 800 px breakpoints.
- "Bureau of Unreasonable Rhythms" interface conceit with a rotating status
  ticker.

---

## [Unreleased]

Nothing yet. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is planned.

---

## Legend

| Tag | Meaning |
|---|---|
| **Added** | New capability |
| **Changed** | Existing behaviour modified |
| **Fixed** | Defect corrected |
| **Deprecated** | Still present, to be removed |
| **Removed** | Removed entirely |
| **Security** | Vulnerability addressed |

---

[1.1.0]: https://github.com/zazieproductions/Form-909-Warp-IDM-Drum-Machine/releases/tag/v1.1.0
[1.0.0]: https://github.com/zazieproductions/Form-909-Warp-IDM-Drum-Machine/releases/tag/v1.0.0
[Unreleased]: https://github.com/zazieproductions/Form-909-Warp-IDM-Drum-Machine/compare/v1.1.0...HEAD
