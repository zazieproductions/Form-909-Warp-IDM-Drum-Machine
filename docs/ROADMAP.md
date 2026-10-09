# Roadmap

**Form 909-WARP** — prioritised future work, with the reasoning

Priorities are ordered by value to a user of the instrument, not by
implementation ease. Each item states the problem it solves, the approach, the
trade-off, and what would change the priority.

---

## Contents

1. [How to read this](#1-how-to-read-this)
2. [Now — v1.2](#2-now--v12)
3. [Next — v1.3](#3-next--v13)
4. [Later — v2.0](#4-later--v20)
5. [Under consideration](#5-under-consideration)
6. [Explicitly rejected](#6-explicitly-rejected)
7. [Good first issues](#7-good-first-issues)

---

## 1. How to read this

| Field | Meaning |
|---|---|
| **Problem** | What is wrong or missing, stated as a user-facing issue |
| **Approach** | The intended solution |
| **Trade-off** | What is given up |
| **Size** | Rough effort: S (hours), M (days), L (weeks) |
| **Reprioritise if** | The condition that would move it up |

---

## 2. Now — v1.2

### 2.1 Pattern save and load

**Problem.** Closing the tab loses everything. There is no way to save a
pattern, share one, or return to one. For an instrument, this is the most
significant missing capability.

**Approach.** Serialise `tracks`, `bpm` and all nine `fx` fields to JSON using
the schema already specified in
[PATTERNS.md §9](PATTERNS.md#9-serialisation). Three surfaces:

1. **File** — export/import a `.f909.json` document.
2. **Clipboard** — copy/paste a pattern as text.
3. **URL fragment** — encode the state into `#` so a link *is* a pattern. This
   is the highest-value of the three, because it makes sharing trivial and needs
   no server.

URL encoding needs compression — a full matrix is ~200 fields. A compact
per-step encoding (active bit, 4-bit ratchet, 7-bit velocity, 7-bit
probability, 6-bit pitch) plus `btoa` should fit a typical pattern into a few
hundred characters.

**Trade-off.** URL-fragment state makes bookmarks fragile across format
changes, so the schema needs a version field from the start.

**Size:** M. **Reprioritise if:** anyone asks for it. They will.

---

### 2.2 Automated test harness

**Problem.** There is no test suite. Every release depends on manual
verification. See [TESTING.md §1](TESTING.md#1-honest-status).

**Approach.** Build the tiered suite described in
[TESTING.md §7](TESTING.md#7-what-a-future-suite-should-assert), starting with
Tier 1 (deterministic render assertions), which needs no audio hardware and can
be written today.

Tier 4 — asserting that the live and offline graphs match — is the one that
would have caught the v1.0 export bugs, and it is the strongest argument for
building this.

**Trade-off.** A browser-based runner is required, which adds a development
dependency. Permitted under the [dependency
policy](MAINTAINABILITY.md#6-dependency-policy), since it is not needed to run,
read or edit the application.

**Size:** M (Tier 1–2), L (all five tiers). **Reprioritise if:** a second
regression ships.

---

### 2.3 Split the status ticker

**Problem.** The `aria-live` region mixes actionable status messages with
decorative Bureau announcements that rotate every 7 seconds while playing. For
a screen-reader user that is unsolicited chatter — see
[ACCESSIBILITY.md §G2](ACCESSIBILITY.md#g2--the-status-ticker-rotates-decorative-content).

**Approach.** Two regions: `role="status"` for actions, `role="log"` (or a
plain non-live container) for flavour. Only the former announces.

**Trade-off.** Slightly more markup; the ticker can no longer be a single
element.

**Size:** S. **Reprioritise if:** reported by a screen-reader user.

---

### 2.4 Undo for grid edits

**Problem.** No undo. See
[DESIGN.md §5](DESIGN.md#5-interaction-design) for the original reasoning — it
was defensible for knob-twiddling, but a mistyped lane length or an accidental
**PURGE ALL** destroys work.

**Approach.** A bounded stack of serialised pattern snapshots (say 30 deep),
pushed on any grid mutation and navigated with
<kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Shift</kbd>+<kbd>Ctrl</kbd>+<kbd>Z</kbd>. The
state is small enough that snapshots are cheap.

**Trade-off.** Adds state that must be kept in sync. Mitigated by deriving
snapshots from the same serialiser as [2.1](#21-pattern-save-and-load).

**Size:** M. **Depends on:** 2.1 for the serialiser. **Reprioritise if:**
frequently requested.

---

## 3. Next — v1.3

### 3.1 Per-track effect buses

**Problem.** Crush, drive and the filter are master-bus only. You cannot crush
the drums and leave the sub clean, which is the single most common thing a
producer would want to do next.

**Approach.** Give each track its own send into a per-track chain, with the
master bus retained for glue. Requires:

- A per-track gain node between `playTrackSound` and `busIn`
- Per-track crush/drive nodes (crush curves are memoised, so the memory cost is
  bounded at 14 curves shared across all instances)
- UI: a per-lane effects strip, or a "focus lane" mode to avoid tripling the
  interface's size

The UI question is the hard part, not the DSP.

**Trade-off.** More nodes per trigger; more interface surface. This is also the
change most likely to alter how existing presets sound, and therefore likely a
major version.

**Size:** L. **Reprioritise if:** it is the most-requested feature.

---

### 3.2 MIDI output and clock sync

**Problem.** The engine is already a sample-accurate clock driving six voices.
There is no reason it could not drive external hardware or a DAW instead.

**Approach.** Two capabilities, in order of usefulness:

1. **MIDI clock output** — send timing so external gear follows Form 909-WARP.
2. **MIDI note output** — map each voice to a note number so the pattern
   drives a sampler or drum machine.

The Web MIDI API is well supported in Chrome and Edge, unavailable in Safari.
Feature-detected and offered only where present.

**Trade-off.** Safari support is absent. Web MIDI also requires a permission
prompt, which is a small amount of friction on first use.

**Size:** M. **Reprioritise if:** requested by anyone using hardware.

---

### 3.3 A seventh voice

**Problem.** Six voices is a good kit, but a dedicated ride/cymbal or a
noise-sweep texture voice would extend the range.

**Approach.** Follow the extension procedure in
[ARCHITECTURE.md §15](ARCHITECTURE.md#15-extension-points): append to
`TRACK_CONFIGS`, add a switch case, write the generator, extend all nine
presets.

**Trade-off.** A seventh lane makes the grid taller and every preset longer.
The candidate voices (a metallic ride built on the hat's inharmonic-ratio
technique, or a filtered-noise sweep) are both straightforward.

**Size:** S for the voice, M with preset extensions. **Reprioritise if:** a
specific voice is requested repeatedly.

---

### 3.4 Self-hosted fonts

**Problem.** Three webfonts load from Google Fonts. The application works
without them, but it is not fully offline, and it is the only external request.

**Approach.** Embed WOFF2 subsets. The three faces are small; base64-embedding
would add roughly 30–60 KB to a 93 KB file.

**Trade-off.** A ~50 % increase in file size, and the fonts become part of the
artefact — which is arguably the right outcome for a single-file application.

**Size:** S. **Reprioritise if:** offline use matters, or if the external
request is considered a privacy issue.

---

## 4. Later — v2.0

### 4.1 Modularisation with an import-map escape hatch

**Problem.** A 1 700-line script is the main cost of the single-file format.
Splitting it would improve navigability — but a naive split requires a bundler,
which would destroy the project's defining property.

**Approach.** Split the source into ES modules under `src/` for development,
and keep a single-file build for distribution, using an **import map** so the
development tree runs directly in a browser with no bundler:

```html
<script type="importmap">
  { "imports": { "./engine.js": "./src/engine.js" } }
</script>
```

- `src/` — modules, developed against directly
- root `index.html`-equivalent — the concatenated single-file artefact
- `tools/build.mjs` — concatenates `src/` into the single file (pure Node, no
  dependencies)

Both trees stay runnable with no toolchain. The built artefact stays committed
so the repository never requires a build to use.

**Trade-off.** Two representations that must be kept in sync, and a build step
in the contributor workflow — though not in the user's. This is the largest
architectural decision the project faces and should not be taken lightly.

**Size:** L. **Reprioritise if:** the script exceeds ~3 000 lines, or a second
maintainer joins and navigability becomes a real cost.

---

### 4.2 Song mode

**Problem.** No arrangement capability. Long-form work currently means
bouncing sections and arranging them elsewhere.

**Approach.** A pattern list with per-entry repeats and transitions, rendered
as one continuous offline bounce.

**Trade-off.** Significant new state and UI. It also changes the instrument's
character from "an instrument you play" to "a sequencer you program", which may
not be desirable.

**Size:** L. **Reprioritise if:** demanded. Otherwise the bounce-and-arrange
workflow in [WORKFLOWS.md](WORKFLOWS.md#4-recipes) is an adequate answer.

---

### 4.3 Per-step length and micro-timing

**Problem.** Swing is global. Per-step timing offsets — the thing that
separates a good IDM groove from a quantised one — are not available.

**Approach.** Add a per-step micro-offset in milliseconds, editable in the
inspector, applied after swing.

**Trade-off.** A fifth per-step parameter; the inspector gets busier; and it
interacts with ratchet sub-division in ways that need care.

**Size:** M. **Reprioritise if:** requested.

---

### 4.4 Stereo

**Problem.** Output is dual-mono. No panning, no width.

**Approach.** `StereoPannerNode` per voice, with a per-track pan control.

**Trade-off.** The delay and reverb paths become stereo-aware, which
complicates the parity table considerably.

**Size:** M. **Reprioritise if:** requested.

---

## 5. Under consideration

Smaller items, not yet scheduled.

| Item | Notes |
|---|---|
| 16-bit dither | Flat TPDF dither would improve 16-bit exports; inaudible at 24-bit |
| Broadcast Wave (`bext`) chunk | Adds origin and timing metadata to exports |
| True-peak measurement | Report peak headroom in the export dialog rather than relying on the fixed trim |
| More presets | The archive is at nine; contributions welcome |
| Keyboard shortcuts for presets | Number keys 1–9 |
| Per-lane randomise | Stochastic fill for one lane rather than the whole matrix |
| Velocity-sensitive drag | Drag vertically across a cell to set velocity |
| Offline render to other formats | FLAC and Opus are possible in-browser; WAV is the honest default |
| Automation lanes | Record slider movement and play it back |
| Skip link and landmarks | Small accessibility win if the page grows |

---

## 6. Explicitly rejected

Recorded so the same suggestions do not need re-litigating. See also
[DESIGN.md §8](DESIGN.md#8-what-the-design-refuses-to-do).

| Rejected | Why |
|---|---|
| A React/Vue/Svelte port | Requires a build step; the UI is four widget types over one array |
| TypeScript | Requires compilation, which breaks the single-file property |
| A sample-based mode | Sampling contradicts the synthesis-from-primitives premise |
| A light theme | Breaks the metaphor and the contrast model |
| 3D skeuomorphic knobs | Sliders are more usable, more accessible and show their value |
| Mobile-first redesign | Sixteen to thirty-two steps across requires width |
| Cloud pattern storage | Introduces a service dependency, an account system and a privacy question |
| A native wrapper (Electron etc.) | Solves a problem the web version does not have |
| Monetisation | Out of scope; the project is MIT-licensed and free |

---

## 7. Good first issues

Genuinely tractable, well-scoped, and useful. Each teaches part of the codebase
and none requires understanding all of it.

| Issue | Area | Teaches |
|---|---|---|
| Add a tenth preset | `PRESETS`, [PATTERNS.md](PATTERNS.md) | The pattern schema and preset authoring |
| Add keyboard shortcuts 1–9 for presets | Event bindings | The binding layer and keyboard handling |
| Add a boolean non-colour indicator to active cells | CSS | The grid's visual encoding; closes [G1](ACCESSIBILITY.md#g1--step-state-is-conveyed-by-colour-alone) |
| Split the status ticker | DOM, ARIA | Live regions; closes [G2](ACCESSIBILITY.md#g2--the-status-ticker-rotates-decorative-content) |
| Scope `user-select: none` to interactive surfaces | CSS | Closes [G3](ACCESSIBILITY.md#g3--text-selection-is-disabled-globally) |
| Move event delegation onto the grid | `renderAllTracks` | The render layer |
| Memoise the drive curve | `updateDriveCurve` | The allocation profile in [PERFORMANCE.md](PERFORMANCE.md) |
| Add per-lane randomise | `generateEuclidean` neighbourhood | The generator pattern |
| Write Tier 1 render assertions | [TESTING.md](TESTING.md) | The offline render path |
| Improve `tools/validate.mjs` | Tooling | The invariant set |

Before starting, please read [CONTRIBUTING.md](../CONTRIBUTING.md) and open an
issue so the work is not duplicated.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) ·
[MAINTAINABILITY.md](MAINTAINABILITY.md) ·
[CONTRIBUTING.md](../CONTRIBUTING.md) · [CHANGELOG.md](../CHANGELOG.md)*
