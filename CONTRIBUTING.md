# Contributing

**Form 909-WARP** — *The Bureau of Unreasonable Rhythms*

Thank you for considering a contribution. This project is a portfolio-grade
instrument with an unusual constraint set, so please read this before opening a
pull request — it will save you a round trip.

---

## Contents

1. [First principles](#1-first-principles)
2. [Getting set up](#2-getting-set-up)
3. [The three rules](#3-the-three-rules)
4. [Ways to contribute](#4-ways-to-contribute)
5. [Development workflow](#5-development-workflow)
6. [Code conventions](#6-code-conventions)
7. [Change types and review paths](#7-change-types-and-review-paths)
8. [Pull request checklist](#8-pull-request-checklist)
9. [Commit and PR conventions](#9-commit-and-pr-conventions)
10. [Reporting bugs](#10-reporting-bugs)
11. [Code of conduct](#11-code-of-conduct)

---

## 1. First principles

Form 909-WARP is a **single self-contained HTML file with zero dependencies and
no build step**. That is not an accident of how it started — it is the design.

Everything about the contribution process follows from it:

- The artefact you ship is the source you edit. There is no compilation between
  them.
- Nothing may be added that requires `npm install` to run the application.
- Nothing may be added that requires a bundler to read or modify it.

If a change would break any of those, open an issue to discuss it before
writing code. There is a credible path to modularising the source — see
[ROADMAP.md §4.1](docs/ROADMAP.md#41-modularisation-with-an-import-map-escape-hatch)
— but it has a specific shape and it is not yet taken.

---

## 2. Getting set up

```bash
git clone https://github.com/zazieproductions/Form-909-Warp-IDM-Drum-Machine.git
cd Form-909-Warp-IDM-Drum-Machine
```

That is the entire setup. There is nothing to install.

```bash
npm run serve          # serve at http://localhost:8080/
npm run check          # validate + link check
```

Both scripts are pure Node (18+) with no packages. You can also simply open the
HTML file — the dev server exists because some browser features behave
differently under `file://`, not because the app needs one.

### Before you touch anything

Read, in this order:

1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how it is put together
2. **[docs/PATTERNS.md](docs/PATTERNS.md)** — the data model
3. **[docs/API.md](docs/API.md)** — the method and DOM reference

Then open the file, load a preset, and press <kbd>Space</kbd>. Understanding
what the instrument *does* is a prerequisite for changing how it works.

---

## 3. The three rules

### Rule 1 — Zero runtime dependencies

No npm packages, no CDN scripts, no frameworks. The application must run from a
filesystem with no network.

Development tooling is exempt but must never be required to run, read or edit
the application. The existing tooling has no dependencies at all; keep it that
way.

### Rule 2 — One file, no build

All CSS and JavaScript stay inline. The moment a build step is needed, the
project's defining property is gone.

### Rule 3 — Live and offline stay in parity

If you add or change anything in the live audio path, the same change must be
made in `exportWav()`. This is the rule that has actually been broken, and the
bugs it produces are subtle: a bounce that is audibly cleaner, denser or louder
than what the performer heard.

The parity table is in
[docs/ARCHITECTURE.md §9](docs/ARCHITECTURE.md#3-parity-with-live-playback).
Check it on every audio change.

---

## 4. Ways to contribute

| Contribution | Where to start |
|---|---|
| **A new preset** | [docs/PATTERNS.md §6](docs/PATTERNS.md#6-authoring-a-preset) — the friendliest entry point |
| **A bug fix** | Open an issue first, or comment on an existing one |
| **Accessibility work** | [docs/ACCESSIBILITY.md §8](docs/ACCESSIBILITY.md#8-known-gaps) lists the gaps with remedies |
| **Documentation** | Always welcome; corrections to factual errors most of all |
| **Performance** | [docs/PERFORMANCE.md §10](docs/PERFORMANCE.md#10-optimisation-policy) — measure first |
| **Tests** | [docs/TESTING.md §7](docs/TESTING.md#7-what-a-future-suite-should-assert) — the highest-value engineering work available |
| **A new voice** | [docs/ARCHITECTURE.md §15](docs/ARCHITECTURE.md#15-extension-points), and expect a sonic review |

Good first issues are listed in
[docs/ROADMAP.md §7](docs/ROADMAP.md#7-good-first-issues).

---

## 5. Development workflow

```bash
git checkout -b feature/my-change
# … make the change …
npm run check
# … run the relevant manual tests (docs/TESTING.md §4) …
git commit -m "feat(scope): description"
git push origin feature/my-change
```

Then open a pull request against `main`.

### Iterating

There is no watch mode and nothing to rebuild. Edit, save, reload. The dev
server sets `cache-control: no-store`, so a hard refresh is never needed.

### Debugging

| Task | Approach |
|---|---|
| Inspect engine state | `bureau` is a global — `bureau.tracks`, `bureau.fx`, `bureau.stepIndex` |
| Inspect a step | `bureau.tracks[0].steps[3]` |
| Watch scheduling | Log `nextNoteTime - bureau.audioCtx.currentTime` in `scheduler()`; it should hover near 0.1 |
| Verify a bounce | `await bureau.exportWav(2)` in the console; inspect the resolved object |
| Check the graph | Breakpoint in `setupMasterBus()` and walk the node connections |

---

## 6. Code conventions

### Structure

The script is organised in banner-delimited sections:

```js
/* =========================================================================
   SECTION NAME
   ========================================================================= */
```

Add a banner when you add a section. Keep the existing order:
constants → engine → presets → render → generators → bindings → boot.

### Naming

| Kind | Convention | Example |
|---|---|---|
| DOM id | camelCase | `fxCrush`, `exportModal` |
| Value read-out | source id + `Val` | `fxCrushVal` |
| Dynamic per-track id | `role-${tIdx}` | `mute-${tIdx}` |
| Method | camelCase | `scheduleStep` |
| Private-ish member | leading `_` | `_crushCurve` |
| Constant | SCREAMING_SNAKE | `TRACK_CONFIGS` |

### Style

The existing style is 2-space indentation, no semicolon-less lines, `const` by
default and `let` only when reassigned. Match what is there rather than
importing preferences from elsewhere.

```js
// Schedules — state first, then effects
scheduleStep(globalStep, time) {
  const anySolo = this.tracks.some(t => t.solo);
  this.tracks.forEach((track, tIdx) => { /* … */ });
}

// Voice generators — pure, five parameters, no globals
synthVoice(ctx, dest, time, vel, pitchShift) { /* … */ }
```

### Comments

Comment **why**, not **what**. The code states what it does; the reasoning is the
part that cannot be recovered later.

```js
// No
// Set oversample to none
this.crushShaper.oversample = 'none';

// Yes
// 'none' not '4x': oversampling would low-pass the staircase and undo the
// effect. The aliasing is the sound.
this.crushShaper.oversample = 'none';
```

### JSDoc

Every method on `BureauEngine` and every standalone function carries JSDoc.
This is the project's substitute for type checking.

```js
/**
 * @param {number} numBars number of 4-beat patterns to render
 * @param {(pct:number) => void} [onProgress] called with 0..100
 * @returns {Promise<{blob:Blob, seed:number, duration:number, sampleRate:number, bitDepth:number}>}
 */
```

### Invariants

These must hold after your change:

| # | Invariant |
|---|---|
| I1–I4 | `getElementById` targets, `label[for]` targets, CSS variables and script syntax all resolve — enforced by `npm run validate` |
| I5 | The live and offline graphs are parameter-parallel |
| I6 | Synth functions never touch the DOM |
| I7 | `renderAllTracks` never mutates musical state |
| I8 | Audio events are scheduled against `currentTime`, never "now" |
| I9 | `stepIndex` is never reset except by `start()` |
| I10 | Every pointer interaction has a keyboard equivalent |
| I11 | Every `fx` field is consumed by both graphs, or documented as not |

---

## 7. Change types and review paths

### Documentation

**Review:** `npm run check` passes. That is all.

### Interface

Layout, styling, labelling, interaction.

**Review:** run the accessibility checks in
[docs/TESTING.md §4](docs/TESTING.md#4-manual-test-matrix) (rows A1–A9).
Re-measure contrast if any colour changed. Include screenshots for visual
changes.

### Structural

Audio graph, scheduler, state model.

**Review:** verify invariants I5–I11; re-run the parity table; run the full
manual matrix; add a changelog entry. Expect close review.

### Sonic

Any change to a voice, the master bus, or a preset.

**Review:** all nine presets must be listened to before and after. State
explicitly **which presets change and how**.

**Rationale:** the presets are the project's artistic output. *Case 01:
Confield Lattice* should keep sounding like itself. A change that alters how a
preset sounds is a content decision, not only a code decision — and per the
[versioning policy](docs/MAINTAINABILITY.md#9-release-process), it may warrant
a major version bump.

If you believe a voice genuinely needs to change, make that argument in the
issue first. It may well be accepted.

---

## 8. Pull request checklist

Before submitting:

- [ ] `npm run check` passes
- [ ] The application runs from `file://` with no network
- [ ] No dependencies added
- [ ] All nine presets load without error
- [ ] Transport starts and stops cleanly
- [ ] A lane-length change round-trips (16 → 7 → 16)
- [ ] The bounce still matches live playback
- [ ] Keyboard focus is preserved across a step toggle
- [ ] The export modal opens, traps focus, and restores it on close
- [ ] `CHANGELOG.md` updated under **Unreleased**
- [ ] Documentation updated if behaviour changed
- [ ] For sonic changes: which presets change, and how
- [ ] For interface changes: accessibility rows A1–A9 run

---

## 9. Commit and PR conventions

### Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add per-lane randomise
fix(export): apply humanise jitter in the offline path
docs(architecture): document the crush curve memoisation
perf(crush): memoise the transfer curve on bit depth
a11y(grid): preserve focus across re-render
refactor(engine): derive solo state from tracks
test(export): add deterministic render assertions
chore(ci): add Node 20 to the matrix
```

Scopes in use: `engine`, `scheduler`, `voices`, `bus`, `export`, `grid`,
`presets`, `ui`, `a11y`, `docs`, `ci`, `tools`.

### Pull requests

- **Title** in conventional-commit form
- **What** changed, and **why**
- **How it was tested** — which rows of the manual matrix
- **For sonic changes** — which presets are affected
- **Screenshots** for visual changes
- **Closes #N** if it resolves an issue

Keep pull requests focused. One concern per PR: a bug fix and a refactor
should be two PRs even when they touch the same lines.

---

## 10. Reporting bugs

Open an issue using the bug report template. For audio bugs especially, include:

| Field | Why |
|---|---|
| Browser and version | Web Audio behaviour differs |
| OS | Autoplay policy and audio device handling differ |
| Steps to reproduce | Reproducible means fixable |
| Expected vs actual | For audio, describe what you hear |
| BPM and preset | Most timing bugs are tempo-dependent |
| Console output | Errors are logged with the original object |

**Audio bugs are the highest-value reports.** They are also the hardest to
describe. "The bounce is missing hits that play live" is a perfectly good bug
report; you do not need to diagnose it.

Security issues: please do not open a public issue. See
[SECURITY.md](SECURITY.md).

---

## 11. Code of conduct

Participation is governed by the
[Contributor Covenant](CODE_OF_CONDUCT.md). By contributing you agree to abide
by it.

Be direct about code, generous about people. This project involves subjective
aesthetic judgement — there is no objective "correct" snare sound — and the
review process works only if disagreement about a kick drum stays a
disagreement about a kick drum.

---

## Licence

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), the same terms as the project.

---

*See also: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[docs/TESTING.md](docs/TESTING.md) ·
[docs/MAINTAINABILITY.md](docs/MAINTAINABILITY.md) ·
[docs/ROADMAP.md](docs/ROADMAP.md)*
