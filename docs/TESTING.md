# Testing

**Form 909-WARP** — strategy, coverage and how to run it

---

## Contents

1. [Honest status](#1-honest-status)
2. [Strategy](#2-strategy)
3. [Automated checks](#3-automated-checks)
4. [Manual test matrix](#4-manual-test-matrix)
5. [Audio verification](#5-audio-verification)
6. [Regression checklist](#6-regression-checklist)
7. [What a future suite should assert](#7-what-a-future-suite-should-assert)

---

## 1. Honest status

**There is no unit or integration test suite.** This is a real gap and it is
stated plainly rather than implied away.

What exists instead:

| Layer | Mechanism |
|---|---|
| Static analysis | `tools/validate.mjs` — 6 classes of structural check, runs in CI |
| Documentation integrity | `tools/check-links.mjs` — every relative Markdown link resolves |
| Manual verification | The matrix in [§4](#4-manual-test-matrix), run before each release |
| Deterministic seam | The offline render path is seeded and pure, and is ready to be tested |

The reasoning is in [§2](#2-strategy), and the plan for closing the gap is in
[§7](#7-what-a-future-suite-should-assert). It is the highest-priority
engineering item on the [roadmap](ROADMAP.md).

---

## 2. Strategy

### Why an instrument is hard to unit-test

Three properties defeat conventional testing here, and it is worth being
specific about which is which.

**The live path is not testable in the ordinary sense.** It depends on a
running `AudioContext`, a hardware clock and `Math.random()`. Its output is
sound. Asserting on it requires either mocking the entire Web Audio API —
which would test the mock — or capturing and analysing real output, which needs
a browser engine.

**The interesting assertions are perceptual.** "Does the kick sound good" is not
a boolean. Useful proxies exist — spectral centroid, RMS, peak, onset detection
— but they need calibration before they can fail meaningfully.

**The output is stochastic by design.** Probability, drill injection, humanise
jitter and the glitch voice's randomised timbre mean two runs are never
identical. An assertion has to be statistical or seeded.

### What *is* testable

The offline render path is unusually well suited to testing, and this is not an
accident — it was made deterministic specifically so it could be:

- `exportWav()` is **pure**: same state + same seed → identical bytes
- It needs **no audio hardware** — `OfflineAudioContext` renders headlessly
- It produces a **concrete artefact** — a WAV `Blob` that can be decoded and
  measured
- Its **graph is inspectable** — node types and parameter values are
  enumerable

That is the seam a test suite should be built on.

### What static analysis covers instead

Without a runtime, the highest-value checks are the ones that catch the failure
mode the single-file, no-bundler format invites: a reference to something that
is no longer there. `tools/validate.mjs` enforces six invariants automatically;
see [§3](#3-automated-checks).

---

## 3. Automated checks

```bash
npm run validate    # structural integrity of the app
npm run links       # documentation link integrity
npm run check       # both
```

Both run in CI on every push and pull request, on Node 18 and 20.

### `tools/validate.mjs`

| # | Check | Catches |
|---|---|---|
| 1 | The inline script parses | A syntax error that would otherwise only appear at runtime |
| 2 | Every `getElementById('x')` resolves to `id="x"` | Renaming or removing an element without updating its reference |
| 3 | Every dynamic id template has a query or a label | Dead `id="foo-${i}"` minting |
| 4 | Every `<label for="x">` resolves | A label pointing at a control that moved |
| 5 | Every `var(--x)` is declared in `:root` | A token typo silently rendering as no colour |
| 6 | Structural tags balance; doctype and `lang` present | Malformed markup |

Check 3 was added after a fix introduced `id="len-${tIdx}"` purely to satisfy a
`<label for>`, with no `getElementById` counterpart — the first version of the
checker flagged it as dead and had to be taught the distinction.

### `tools/check-links.mjs`

Walks every Markdown file, strips fenced code blocks, and verifies each
relative link resolves. Absolute URLs, same-file anchors and mailto are skipped
as out of scope.

### Why no linter

ESLint and Prettier would improve consistency, but both require dependencies,
and zero dependencies is a load-bearing constraint — see
[ARCHITECTURE.md §2](ARCHITECTURE.md#2-constraints). The conventions they would
enforce are documented in
[CONTRIBUTING.md](../CONTRIBUTING.md#code-conventions) and checked in review.

---

## 4. Manual test matrix

Run before tagging a release. Each row has an explicit pass criterion.

### Transport and timing

| # | Test | Pass criterion |
|---|---|---|
| T1 | Start with <kbd>Space</kbd> | Audio begins within ~100 ms; button reads HALT |
| T2 | Stop with <kbd>Space</kbd> | Audio stops; `current-cursor` cleared from all lanes |
| T3 | Run for 5 minutes | No audible drift against a metronome; no accumulating latency |
| T4 | Change BPM while playing | Tempo changes; no glitch or double-trigger |
| T5 | Set BPM to 40, then 360 | Both extremes stable; no dropped or duplicated steps |
| T6 | Background the tab for 60 s | Audio continues; scheduling does not break up on return |

### Pattern editing

| # | Test | Pass criterion |
|---|---|---|
| P1 | Click a cell | Toggles; audible on the next pass of that step |
| P2 | <kbd>Shift</kbd>+click repeatedly | Ratchet cycles 1→2→3→4→1; `nx` subscript follows |
| P3 | Right-click a cell | Inspector binds; step does **not** toggle |
| P4 | Adjust each of the four inspector sliders | Value applies to the selected step only |
| P5 | Set a lane length to 1, then 32 | Lane renders 1, then 32 cells; no errors |
| P6 | Set length 16 → 7 → 16 | Steps hidden at 7 reappear at 16 with parameters intact |
| P7 | Mute a lane | Silent; other lanes unaffected |
| P8 | Solo a lane | Only that lane sounds |
| P9 | Solo lane A then lane B | Only lane B sounds |
| P10 | Press **GEN** on each lane | A Euclidean distribution appears; ticker reports the density |
| P11 | Press **MUTATE** five times | Pattern evolves without error; density stays broadly similar |
| P12 | Generate each of the six styles, then **SURPRISE MIX** | Fresh six-lane patterns appear; BPM, lengths and style settings stay in range |
| P13 | Generate successive seeds without changing style | Pattern changes without errors; no lane exceeds 32 steps |
| P14 | **PURGE ALL** | All steps inactive; ratchets reset to 1 |

### Presets

| # | Test | Pass criterion |
|---|---|---|
| R1 | Load each of the 21 presets in turn | BPM, lengths, crush, drive, swing and pattern all apply |
| R2 | Load `vnares` (210 BPM, 7/8) | Timing is stable at the fastest setting |
| R3 | Load `subliminal` (lengths 13/13/16/7/9/13) | Lanes render at their own lengths; drift is audible |
| R4 | Load `empty` | All lanes clear; no residual active steps |

### Effects

| # | Test | Pass criterion |
|---|---|---|
| F1 | Sweep BIT CRUSH 0 → 1 | Audible progressive degradation; no dropouts |
| F2 | Sweep each of the six bus sliders through its full range | Continuous change; no NaN silence or exception |
| F3 | Set delay feedback to 0.85 | Tails build without runaway gain |
| F4 | Set cutoff to 150 Hz | Material becomes muffled but audible |
| F5 | Set jitter to 25 ms | Timing loosens audibly; downbeat stays legible |
| F6 | Set swing to 50 % | Heavy shuffle; no scheduling error |
| F7 | Set global probability to 10 % | Pattern thins out; no exception |
| F8 | Set drill density to 100 % | Plain steps become ratchets |

### Export

| # | Test | Pass criterion |
|---|---|---|
| X1 | Export 2 patterns | Downloads; opens in a DAW; plays |
| X2 | Export 16 patterns | Completes; progress bar advances |
| X3 | Export twice with the same seed | Files are byte-identical |
| X4 | A/B the bounce against live playback | Same density, same swing, same level (±0.5 dB) |
| X5 | Verify the header | `BitsPerSample = 24`, `SampleRate = 48000`, `NumChannels = 2` |
| X6 | Export with delay feedback at 0.85 | Tail rings out; not audibly truncated |
| X7 | Cancel mid-render | Dialog closes; no orphaned download |

### Live recording

| # | Test | Pass criterion |
|---|---|---|
| L1 | Press **RECORD LIVE** while stopped | Capture starts, transport starts, timer advances, button announces the active state |
| L2 | Stop a take after audible playback | A non-empty browser-supported audio file downloads and opens in a player |
| L3 | Start capture while transport is already playing | Recording starts without resetting playback; stopping capture leaves transport running |
| L4 | Start capture while stopped, then stop it | Recording and the transport it started both stop; the downloaded take is playable |
| L5 | Test where `MediaRecorder` is unavailable | A clear status message appears and transport is not left running |

### Accessibility

| # | Test | Pass criterion |
|---|---|---|
| A1 | Unplug the mouse; build a pattern | Everything is reachable and operable by keyboard |
| A2 | Toggle one step 20 times | Focus never leaves the cell |
| A3 | Tab through the whole interface | Focus is always visible; order is logical |
| A4 | Open the export modal, press <kbd>Tab</kbd> repeatedly | Focus stays inside the dialog |
| A5 | Press <kbd>Esc</kbd> in the modal | Closes; focus returns to EXPORT |
| A6 | Enable reduced motion at the OS level | Animations stop; layout unchanged |
| A7 | Enable high contrast | Borders and cells become clearly delineated |
| A8 | Run VoiceOver or NVDA | Every control announces a name and state |
| A9 | Zoom to 200 % | No content lost or clipped |

### Browsers

Run T1–T3, P1–P2, all six generator styles, R1, X1, L1–L4 and A1–A5 in Chrome, Firefox and Safari. Confirm the live recording's file extension matches the browser's supported MediaRecorder format.

---

## 5. Audio verification

### A/B against live playback

The most important audio test is manual and has a concrete criterion:

1. Load a preset, press **RECORD LIVE**, play for at least four patterns, then
   stop and save the real-time take.
2. Export the same preset at 4 patterns.
3. Compare the shared passage by listening (or by aligning the recordings in a
   DAW); live probability and glitch randomness mean individual takes differ.

**Pass criterion:** the bounce has the same density, the same swing feel, the
same level within ±0.5 dB, and no missing or extra hits.

Before v1.1 this test failed — the bounce was audibly cleaner, denser and about
1.1 dB hotter, because the offline path omitted humanise, probability, drill
injection, crush and the master trim. See the [changelog](../CHANGELOG.md).

### Header verification

```bash
xxd -l 48 BUREAU_UNREASONABLE_*.wav
```

```
00000000: 5249 4646 ... 5741 5645 666d 7420 1000  RIFF...WAVEfmt .
00000010: 0000 0100 0200 80bb 0000 00ee 0200 0600  ................
00000020: 1800 6461 7461 ...                       ..data
```

Decoding: `0xbb80` = 48 000 Hz; `0x0006` block align = 6 bytes (2 ch × 24-bit);
`0x0018` = 24 bits per sample.

### Spectral sanity

For a quick check, import the bounce into any DAW or run:

```bash
ffprobe -show_streams BUREAU_UNREASONABLE_*.wav
```

Confirm: `codec_name=pcm_s24le`, `sample_rate=48000`, `channels=2`, and a peak
level below 0 dBFS.

---

## 6. Regression checklist

Before merging any change, confirm:

- [ ] `npm run check` passes
- [ ] All 21 presets load without error
- [ ] Every generator style produces a valid pattern
- [ ] Transport starts and stops cleanly
- [ ] Live record captures, downloads and finalizes a take
- [ ] A lane-length change round-trips (16 → 7 → 16)
- [ ] The bounce matches live playback (X4)
- [ ] The focused cell keeps focus across a toggle (A2)
- [ ] The modal opens, traps, and restores focus (A4, A5)

For a change to the audio path, additionally:

- [ ] Parity table in [ARCHITECTURE.md §9](ARCHITECTURE.md#9-the-offline-render-path) still holds
- [ ] Every `fx` field is consumed by both graphs, or documented as not
- [ ] Levels are unchanged within ±0.5 dB

---

## 7. What a future suite should assert

A concrete plan, highest value first.

### Tier 1 — Deterministic render assertions

Headless, no audio hardware, high confidence.

```js
// Same state + same seed ⇒ identical bytes
const a = await bureau.exportWav(2, null, { seed: 42 });
const b = await bureau.exportWav(2, null, { seed: 42 });
assert.deepStrictEqual(await a.blob.arrayBuffer(), await b.blob.arrayBuffer());

// Different seeds ⇒ different bytes (proves the RNG is actually consumed)
const c = await bureau.exportWav(2, null, { seed: 43 });
assert.notDeepStrictEqual(await a.blob.arrayBuffer(), await c.blob.arrayBuffer());
```

Plus: peak ≤ 0 dBFS; no `NaN` in the buffer; RMS within an expected band; the
WAV header fields match the requested sample rate, channels and bit depth;
buffer length matches `ceil(sampleRate × duration)`.

### Tier 2 — Timing assertions

Instrument `scheduleStep` with a spy, run the scheduler over N steps, and assert
on the emitted times:

| Assertion | Why |
|---|---|
| Every scheduled time is ≥ `currentTime` | Nothing scheduled in the past |
| Step intervals equal `(60/bpm) × 0.25` ± swing | Tempo maths is correct |
| Swing appears only on odd steps | Swing application is correct |
| Ratchet sub-times are evenly spaced by `stepDur / ratchets` | Drill timing is correct |
| No time is earlier than its step boundary | The humanise clamp works |

### Tier 3 — Statistical assertions

For the stochastic layers, assert on distributions rather than instances:

- With `prob = 0`, a step never fires over 10 000 trials
- With `prob = 100`, it always fires
- With `prob = 50` over 10 000 trials, the observed rate is 50 % ± 2 %
- With `globalProb = 0.5` and `prob = 100`, the observed rate is 50 % ± 2 %
- Humanise jitter is bounded by `±humanize / 2000` seconds

### Tier 4 — Structural assertions on the graph

Walk the constructed node graph and assert its shape: node types in order,
parameter values equal to `fx`, and — critically — that the live and offline
graphs match. This is the automated form of the parity table, and it is the
check that would have caught the v1.0 export bugs.

### Tier 5 — Accessibility automation

axe-core in a headless browser, on: the default state, one preset loaded, and
the export modal open. This catches ARIA regressions that static analysis
cannot.

### Harness

A browser-based runner (Playwright or Web Test Runner) is the honest choice,
because `AudioContext` and `OfflineAudioContext` need a real engine. Node has no
Web Audio implementation that is faithful enough for DSP assertions.

Adding a dev-only browser runner does not violate the zero-dependency rule: the
constraint applies to the **shipped artefact**, not to development tooling.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [PERFORMANCE.md](PERFORMANCE.md) ·
[ACCESSIBILITY.md](ACCESSIBILITY.md) · [ROADMAP.md](ROADMAP.md)*
