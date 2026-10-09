# Maintainability

**Form 909-WARP** — how this project is kept healthy over years, not weeks

A single-file, zero-dependency, no-build application is unusually durable — and
unusually easy to rot quietly, because nothing in the toolchain will tell you
when it does. This document is the counterweight: the conventions, invariants
and review practices that substitute for a compiler.

---

## Contents

1. [The durability argument](#1-the-durability-argument)
2. [The risk it creates](#2-the-risk-it-creates)
3. [Substitutes for a build step](#3-substitutes-for-a-build-step)
4. [Code conventions](#4-code-conventions)
5. [Invariants](#5-invariants)
6. [Dependency policy](#6-dependency-policy)
7. [Browser API risk](#7-browser-api-risk)
8. [Change classification](#8-change-classification)
9. [Release process](#9-release-process)
10. [Bus factor](#10-bus-factor)
11. [Refactoring policy](#11-refactoring-policy)
12. [Archival](#12-archival)

---

## 1. The durability argument

The project will still run in fifteen years, and that claim can be defended
specifically:

| Risk | Why it does not apply |
|---|---|
| Dependency abandonment | There are no dependencies |
| Registry disappearance | Nothing is fetched at runtime except three webfonts |
| Build-tool obsolescence | There is no build |
| Language drift | The code is ES2017-era JavaScript: classes, template literals, arrow functions, spread, optional chaining. Nothing exotic. |
| Platform API removal | Web Audio is a W3C standard with a strong backwards-compatibility commitment |
| Format obsolescence | HTML and WAV are among the most durable formats in existence |

The artefact is the source. There is no state in which the repository is
present but the application is not runnable.

---

## 2. The risk it creates

The same properties generate their own failure modes.

| Risk | Mitigation |
|---|---|
| A 1 700-line script becomes unnavigable | Section banners; one state owner; pure voice functions ([§4](#4-code-conventions)) |
| A renamed DOM id silently breaks a code path | `tools/validate.mjs` check 2, in CI |
| A CSS token typo renders as no colour | `tools/validate.mjs` check 5 |
| Live and offline graphs drift apart | The parity table in [ARCHITECTURE.md §9](ARCHITECTURE.md#9-the-offline-render-path), checked in review |
| Duplicated graph construction rots | Recorded as [D6](ARCHITECTURE.md#d6--full-mirror-instead-of-shared-graph-code); revisit at the third divergence |
| Documentation rots | `tools/check-links.mjs`, plus docs living beside the code they describe |
| No type checking | JSDoc on every public method; parameter tables in [API.md](API.md) |

---

## 3. Substitutes for a build step

What a compiler would have caught, and what catches it instead.

| Normally caught by | Caught here by |
|---|---|
| Syntax errors | `node --check` of the extracted script, in CI |
| Unresolved references | `tools/validate.mjs` id/label/variable resolution checks |
| Type errors | JSDoc + review; no runtime checking |
| Dead code detection | Review, plus the dynamic-id check |
| Lint rules | Documented conventions in [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Test failures | [Manual test matrix](TESTING.md#4-manual-test-matrix); automated suite planned |
| Bundle size limits | Not applicable — the artefact *is* the source |

### Running the checks

```bash
npm run check
```

Runs both validators. Both are pure Node, no packages, and complete in under a
second. They run in CI on every push and pull request, on Node 18 and 20.

---

## 4. Code conventions

### Section banners

The script is divided by banner comments. Adding a section means adding a
banner in the established style:

```js
/* =========================================================================
   SECTION NAME
   ========================================================================= */
```

### Naming

| Kind | Convention | Example |
|---|---|---|
| DOM id | kebab-case | `fxCrush`, `stepVel`, `exportModal` |
| Value read-out id | source id + `Val` | `fxCrushVal` |
| Dynamic per-track id | `role-${tIdx}` | `mute-${tIdx}`, `lane-${tIdx}` |
| Method | camelCase | `scheduleStep`, `updateCrushCurve` |
| Private-ish member | leading underscore | `_crushCurve`, `_crushBits` |
| Constant | SCREAMING_SNAKE | `TRACK_CONFIGS`, `LORE_QUOTES` |

### Function shape

- **Voice generators are pure.** `(ctx, dest, time, vel, pitchShift)`. They read
  no global state — that is what makes the offline path trustworthy.
- **`renderAllTracks` is a projection.** It reads state and writes DOM; it never
  mutates musical state.
- **The engine owns state.** Nothing outside `BureauEngine` writes to
  `tracks`, `fx` or `bpm`.

### Comments

Comment *why*, not *what*. The code says what it does; the decision record is
the part that cannot be recovered from source.

```js
// Bad
// Set the crush curve
this.crushShaper.curve = curve;

// Good
// `none` not '4x': oversampling would low-pass the staircase and largely
// undo the effect. The aliasing is the sound.
this.crushShaper.oversample = 'none';
```

### JSDoc

Every method on `BureauEngine` and every standalone function carries a JSDoc
block. This is the substitute for type checking:

```js
/**
 * @param {number} numBars number of 4-beat patterns to render
 * @param {(pct:number) => void} [onProgress] called with 0..100
 * @returns {Promise<{blob:Blob, seed:number, duration:number, sampleRate:number, bitDepth:number}>}
 */
```

---

## 5. Invariants

These must hold after any change. The first four are enforced automatically;
the rest are review responsibilities, and each is written down so a reviewer
knows to check it.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Every `getElementById` target exists | `tools/validate.mjs` |
| I2 | Every `label[for]` resolves | `tools/validate.mjs` |
| I3 | Every `var(--x)` is declared in `:root` | `tools/validate.mjs` |
| I4 | The inline script parses | `tools/validate.mjs` |
| I5 | Live and offline graphs are parameter-parallel | Review |
| I6 | Synth functions never touch the DOM | Review |
| I7 | `renderAllTracks` never mutates musical state | Review |
| I8 | Audio events are scheduled against `currentTime`, never "now" | Review |
| I9 | `stepIndex` is never reset except by `start()` | Review |
| I10 | Every pointer interaction has a keyboard equivalent | Review |
| I11 | Every `fx` field is consumed by both graphs, or documented as not | Review |

I5 and I11 are the ones that have actually broken. They are the first thing to
check in any review touching audio or presets.

---

## 6. Dependency policy

**Runtime dependencies: zero. This is a hard rule.**

| Category | Policy |
|---|---|
| Runtime npm packages | Not permitted |
| CDN scripts | Not permitted |
| Webfonts | Permitted — the application degrades gracefully without them |
| **Development** tooling | Permitted, with conditions |

Development dependencies must:

1. Never be required to run the application
2. Not be required to read or modify the source
3. Be replaceable by hand in under an hour

The current tooling has **no dependencies at all** — `tools/validate.mjs`,
`tools/check-links.mjs` and `tools/serve.mjs` are all pure Node. That
preference should continue: a validator that needs `npm install` is a validator
that will not run in five years.

If a browser-based test runner is added (see [TESTING.md](TESTING.md)), it is a
development dependency and therefore permitted — but the repository must remain
in a state where the application can be used, read and edited with nothing
installed.

### Adding a webfont

Three fonts are loaded from Google Fonts. Adding a fourth should be justified by
a role the existing three cannot fill. Self-hosting the fonts is a reasonable
future change that would make the application fully offline — tracked in
[ROADMAP.md](ROADMAP.md).

---

## 7. Browser API risk

The application depends on these platform APIs. Each is assessed for removal
risk.

| API | Risk | Notes |
|---|---|---|
| `AudioContext` | Very low | W3C Recommendation, universally supported |
| `OfflineAudioContext` | Very low | W3C Recommendation; the app degrades gracefully without it |
| `OscillatorNode`, `GainNode`, `BiquadFilterNode` | Very low | Core primitives |
| `WaveShaperNode` | Low | Core primitive |
| `DelayNode`, `DynamicsCompressorNode` | Low | Core primitives |
| `AnalyserNode` | Low | Used only for the scope; failure is isolated |
| `OfflineAudioContext.suspend()` | Medium | Used only for progress; degrades to a two-stage bar |
| `structuredClone`, `AudioWorklet`, etc. | — | Not used, deliberately |

### What would break the application

- Removal or renaming of a Web Audio node type — very unlikely
- A change to `OfflineAudioContext` constructor semantics — unlikely
- A change to `WaveShaperNode` curve semantics — unlikely

### What would degrade it

- Loss of `suspend()`/`resume()` on offline contexts — progress reporting only
- Loss of `prefers-reduced-motion` support — the media query is ignored
- Font unavailability — typography only

### Monitoring

There is no automated cross-browser monitoring. Before each release, the manual
matrix in [TESTING.md](TESTING.md#4-manual-test-matrix) is run in Chrome,
Firefox and Safari. The long-term plan is a headless-browser check in CI.

---

## 8. Change classification

Every pull request falls into one of four classes. The class determines the
review burden.

### Structural

Changes to the audio graph, scheduler or state model.

**Requires:** I1–I11 checked; the parity table re-verified; the manual matrix
run; a note in the changelog.

**Reviewers:** a maintainer, plus a second pair of eyes on anything touching
scheduling.

### Sonic

Changes to a voice, the bus, or a preset.

**Requires:** before/after listening on all nine presets; an explicit statement
of which presets change and how; the changelog entry noting it is a sonic
change.

**Rationale:** presets are the project's artistic output. Changing how they
sound is a content decision, not only a code decision, and users have a
reasonable expectation that *Case 01* keeps sounding like *Case 01*.

### Interface

Changes to layout, styling, labelling or interaction.

**Requires:** the accessibility matrix run; contrast re-measured if any colour
changes; screenshots for visual changes.

### Documentation

**Requires:** `npm run check` passes. Nothing more.

---

## 9. Release process

```
1.  Confirm `npm run check` passes.
2.  Run the manual test matrix (TESTING.md §4) on Chrome, Firefox, Safari.
3.  Run the regression checklist (TESTING.md §6).
4.  Update CHANGELOG.md — move Unreleased to a version heading with the date.
5.  Bump the version in package.json.
6.  Commit: "Release vX.Y.Z".
7.  Tag: git tag -a vX.Y.Z -m "vX.Y.Z — summary".
8.  Push the branch and the tag.
9.  GitHub Actions deploys to Pages from the tag.
10. Create a GitHub Release from the changelog entry.
```

### Versioning

Semantic versioning, interpreted for an instrument:

| Bump | When |
|---|---|
| **Major** | A change that makes existing patterns sound materially different, or breaks the file's self-containment |
| **Minor** | A new voice, preset, effect or export capability |
| **Patch** | Bug fixes, documentation, accessibility and performance work with no sonic change |

The major-bump rule matters: a pattern is a user artefact, and a change that
alters how a saved pattern sounds is a breaking change even though no API
moved.

---

## 10. Bus factor

Currently 1. The mitigations are entirely documentary, and they are the reason
this documentation exists.

A new maintainer should be able to, from the repository alone:

- Run the application ([README](../README.md#quick-start))
- Understand the architecture ([ARCHITECTURE.md](ARCHITECTURE.md))
- Find any parameter and its range ([API.md](API.md))
- Modify a voice ([SOUND-DESIGN.md](SOUND-DESIGN.md))
- Add a preset ([PATTERNS.md](PATTERNS.md))
- Understand why the offline path is built as it is ([EXPORT.md](EXPORT.md))
- Release a version ([§9](#9-release-process))
- Verify a change ([TESTING.md](TESTING.md))

**Recruiting a second maintainer is an explicit project goal.** The
documentation is written so that the barrier to that is low.

---

## 11. Refactoring policy

### Do refactor when

- A second instance of the same logic appears and the abstraction is obvious
- A documented invariant has been broken, and the fix is to make it
  unbreakable
- A section has outgrown its banner and the split is natural
- A performance budget is exceeded

### Do not refactor when

- It would introduce a dependency
- It would require a build step
- It would split the single file without the [import-map escape
  hatch](ROADMAP.md) in place
- The current code is merely inelegant but correct and understood

### Three specific refactors under consideration

**Extract `buildBus(ctx)`.** The live and offline graphs are currently built
separately. A shared factory is cleaner and would make I5 structural rather
than a review item. **Blocked on:** the two graphs still differ in meaningful
ways (the analyser, the seeded RNG, live parameter automation). Revisit when
they no longer do — see [D6](ARCHITECTURE.md#d6--full-mirror-instead-of-shared-graph-code).

**Event delegation on the grid.** 576 direct listeners across 192 cells. Not
currently a measured cost. **Revisit when:** profiling on a low-end device
shows listener attachment or detachment in the profile.

**Memoise the drive curve.** The one remaining allocation hot spot. **Revisit
when:** a quantisation key can be chosen that does not introduce audible
stepping in the control's response.

---

## 12. Archival

Because the artefact is a single self-contained file, archival is trivial and
worth stating explicitly:

**To archive a working copy:** save the HTML file. That is sufficient.

**To archive the full project:** `git clone`, or download the repository at a
tagged release.

**To verify an archived copy years later:** open it in a browser. If the
webfonts are unavailable the typography will differ; everything else will work.

**Recommended practice for anyone forking:** keep the single-file property. It
is the reason the project is durable, and it is easy to lose by accident — one
`src/` directory and one bundler is all it takes.

### What would not survive

- The GitHub Pages deployment (external service)
- The Google Fonts request (external service, graceful degradation)
- Issue and PR history (external service)

None of these is required to run the instrument.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) ·
[CONTRIBUTING.md](../CONTRIBUTING.md) · [TESTING.md](TESTING.md) ·
[ROADMAP.md](ROADMAP.md)*
