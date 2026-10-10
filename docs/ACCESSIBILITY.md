# Accessibility

**Form 909-WARP** — conformance, implementation and known gaps

An audio instrument is an unusual accessibility problem: the primary output is
sound, the primary input is precise pointer work on a dense grid, and the
interface is deliberately styled as a piece of mid-century laboratory
equipment. This document records what has been done, what is measured, and what
is still outstanding.

---

## Contents

1. [Statement](#1-statement)
2. [Keyboard](#2-keyboard)
3. [Screen readers](#3-screen-readers)
4. [Motion](#4-motion)
5. [Contrast](#5-contrast)
6. [Modal dialog](#6-modal-dialog)
7. [Focus](#7-focus)
8. [Known gaps](#8-known-gaps)
9. [Testing](#9-testing)
10. [Reporting](#10-reporting)

---

## 1. Statement

**Target: WCAG 2.2 Level AA.**

Form 909-WARP is a creative instrument, not a form. Where a conformance
requirement and the instrument's function genuinely conflict, the conflict is
recorded in [§8 Known gaps](#8-known-gaps) rather than papered over.

The interface was brought from "almost entirely pointer-only, no ARIA, no focus
management" to its current state in v1.1. The remaining gaps are enumerated
honestly below.

---

## 2. Keyboard

Every pointer interaction has a keyboard equivalent.

| Key | Context | Action |
|---|---|---|
| <kbd>Tab</kbd> | Global | Move through controls and active step cells |
| <kbd>Space</kbd> | Global, outside form controls and cells | Start / stop the transport |
| <kbd>Enter</kbd> | Focused step cell | Toggle the step |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Focused step cell | Cycle ratchet 1→2→3→4→1 |
| <kbd>←</kbd> / <kbd>→</kbd> | Focused step cell | Move to the previous / next step in the lane |
| <kbd>Tab</kbd> | Inside the export modal | Cycle within the dialog (trapped) |
| <kbd>Esc</kbd> | Inside the export modal | Close the dialog |
| Arrow keys / typing | Range inputs, number inputs | Native browser behaviour |

### Why <kbd>Enter</kbd> and not <kbd>Space</kbd> on cells

<kbd>Space</kbd> is bound to the transport, and that binding is the one
everyone reaches for. Cells use <kbd>Enter</kbd> — the conventional activation
key for an element with `role="button"` — and the global handler explicitly
stands down when the event originates from a step cell, so the two never
collide.

### Why only active cells are tabbable

A full grid is 6 × 32 = 192 positions. Putting all of them in the tab order
would mean 192 keystrokes to traverse the sequencer. Instead:

- **Active steps** carry `tabindex="0"` and join the tab order.
- **Inactive steps** carry `tabindex="-1"` and are reached with the arrow keys.

A keyboard user therefore traverses *the notes that sound* — typically 20–40
positions — and can arrow into the empty space between them, which is where
they would want to add a note anyway. Activating a step promotes it into the
tab order on the next render.

---

## 3. Screen readers

### Semantics

| Element | Implementation |
|---|---|
| Step cells | `role="button"`, `aria-pressed`, descriptive `aria-label` |
| Lane | `role="group"` with `aria-label` naming the voice and its length |
| Mute / solo | `aria-pressed` plus `aria-label` naming the track |
| Transport | `aria-pressed`, dynamic `aria-label` ("Start"/"Stop the sequencer") |
| Oscilloscope | `role="img"` with `aria-label` |
| Status ticker | `role="status"`, `aria-live="polite"`, `aria-atomic="true"` |
| Export modal | `role="dialog"`, `aria-modal="true"`, labelled and described |
| Progress bar | `role="progressbar"` with live `aria-valuenow` |
| Decorative icons | `aria-hidden="true"` on every inline SVG |

### Accessible names

A step cell's name carries everything the visual cell encodes:

```
KICK / TRANSIENT FM, step 3, on, ratchet 2 times, plus 7 semitones, probability 80 percent.
```

This matters because the visual cell communicates state through colour, a
`2x` subscript and a probability bar — none of which a screen reader would
otherwise receive.

### Labelling

All 13 range inputs, the BPM and rendered lane-length number inputs, all three
selects and every icon-less button carry an explicit association: `<label
for="…">` where a visible label exists, `aria-label` where it does not. `tools/validate.mjs` fails CI if any
`label[for]` resolves to a missing id.

### The live region

`#loreTicker` is an `aria-live="polite"` status region. Loading a preset,
mutating, changing a lane length, starting/stopping a live take and completing
an export all announce through it. The live record button also updates its
accessible name and `aria-pressed` state; `#recordHint` explains that capture
records the master output and downloads a browser-supported audio file.

**Known concern.** While the transport runs, the ticker also rotates through
in-character Bureau announcements every 7 seconds. For a screen reader user
that is unsolicited chatter. It is decorative content, and suppressing it
without losing the genuinely useful status messages requires splitting the
region in two — tracked in [§8](#8-known-gaps).

---

## 4. Motion

The interface borrows heavily from CRT instrumentation: a scanline overlay,
blinking LEDs, a pulsing live-recording indicator and a phosphor-glow oscilloscope.
The record button's visual pulse mirrors a real capture state rather than a
decorative or always-armed indicator.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
  .scanlines { display: none; }
}
```

Animations are neutralised rather than deleted, so layout and hit targets are
identical with or without the preference. The scanline overlay is removed
outright because it is purely decorative and sits above content.

Not affected by the preference: the oscilloscope trace, which is a live readout
of the audio and is the instrument's only visual monitoring. It does update
continuously, which is its function rather than an animation.

---

## 5. Contrast

Measured against `--panel-bg` (`#12161b`), the surface most text sits on.

| Token | Value | Ratio | Verdict |
|---|---|---|---|
| `--text-bright` | `#f8fafc` | 17.36:1 | ✅ AAA |
| `--cyan-bright` | `#7dd3fc` | 10.89:1 | ✅ AAA |
| Export green | `#34d399` | 9.45:1 | ✅ AAA |
| `--cyan` | `#38bdf8` | 8.48:1 | ✅ AAA |
| `--amber` | `#f59e0b` | 8.46:1 | ✅ AAA |
| `--rad-green` | `#10b981` | 7.16:1 | ✅ AAA |
| `--text-mid` | `#94a3b8` | 7.08:1 | ✅ AAA |
| `--glitch-pink` | `#f43f5e` | 4.95:1 | ✅ AA |
| `--rad-red` | `#ef4444` | 4.83:1 | ✅ AA |
| `--text-dim` | `#74839a` | 4.72:1 | ✅ AA |

`--text-dim` was `#64748b` (3.82:1) through v1.0, which failed AA for the 9–10 px
labels it is used on — a common failure, since small text needs the full 4.5:1
and there is no "small text is basically large text" exemption. It was corrected
in v1.1.

### High contrast

```css
@media (prefers-contrast: more) {
  .module-box, .step-cell, .modal-dialog, .progress-bar-wrap {
    border-color: #94a3b8;
  }
  .step-cell { background: #1b2430; }
}
```

Panel and cell borders are intentionally low-contrast in the default theme —
they are decorative chrome, not component boundaries. Under
`prefers-contrast: more` they are raised to 7:1 and inactive cells are
lightened.

### Non-text contrast

Step cells are 24 × 38 px. Active cells are `#0284c7` against an inactive
`#141b22` — a large, high-contrast change. See [§8](#8-known-gaps) on colour
as the sole state indicator.

---

## 6. Modal dialog

The export dialog is a `<div>`, so native `<dialog>` behaviours are implemented
explicitly rather than inherited:

| Behaviour | Implementation |
|---|---|
| Semantics | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby` |
| Visibility | The `hidden` attribute is the single source of truth; `.modal-backdrop[hidden] { display: none }` |
| Focus on open | First focusable control inside the dialog |
| Focus trap | <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> wrap between first and last |
| Dismiss | <kbd>Esc</kbd>, the Discard button, or a click on the backdrop |
| Focus restore | Returns to the element that opened the dialog |
| Progress | `role="progressbar"` with a live `aria-valuenow` |

Using `hidden` rather than an inline `style.display` means assistive technology
and CSS agree on visibility in one step, with no possibility of the two
drifting.

> **Roadmap.** Migrating to a native `<dialog>` element would replace the manual
> focus trap with platform behaviour. The manual implementation is correct and
> tested, but the native element is strictly better.

---

## 7. Focus

```css
:focus-visible {
  outline: 2px solid var(--cyan-bright);
  outline-offset: 2px;
}

.step-cell:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 1px;
  z-index: 2;
}
```

`:focus-visible` rather than `:focus`, so pointer users do not see outlines
after clicking while keyboard users always do.

### Focus preservation across re-render

This was the single most important fix. `renderAllTracks()` destroys and
rebuilds the grid, which destroys the focused element and drops focus to
`<body>` — making keyboard editing impossible, because every toggle would end
the user's session with the keyboard.

`renderAllTracks()` now captures the focused cell before teardown and restores
it afterwards:

```js
const focused = document.activeElement;
const focusTrack = focused?.dataset?.track;
const focusStep  = focused?.dataset?.step;
// … rebuild …
if (hadFocus) {
  container
    .querySelector(`.step-cell[data-track="${focusTrack}"][data-step="${focusStep}"]`)
    ?.focus({ preventScroll: true });
}
```

Because a toggled-off step would otherwise drop out of the tab order, the
restored cell is explicitly promoted to `tabindex="0"` on focus.

---

## 8. Known gaps

Recorded rather than hidden. Each has a rationale and, where one exists, a
planned remedy.

### G1 — Step state is conveyed by colour alone

**Issue.** Active and inactive cells differ by background colour. WCAG 1.4.1
asks that colour not be the *sole* visual means of conveying information.

**Mitigation.** Screen-reader users receive `aria-pressed` and an accessible
name containing "on" or "off". Sighted users get a very large luminance change
plus, for ratcheted steps, a textual `2x` subscript.

**Remedy.** Add a non-colour indicator to active cells — an inset bar or a
notched corner. Deferred because it changes the visual design of the grid, which
is the instrument's primary surface.

### G2 — The status ticker rotates decorative content

**Issue.** While playing, Bureau announcements are pushed into an
`aria-live="polite"` region every 7 seconds.

**Mitigation.** `aria-live="polite"` queues rather than interrupts, so nothing
is cut off.

**Remedy.** Split the region: a `role="log"` for ambient flavour and a
`role="status"` for actionable messages, so a screen reader user can ignore the
former. Tracked in [ROADMAP.md](ROADMAP.md).

### G3 — Text selection is disabled globally

**Issue.** `user-select: none` is applied to `*`, so interface copy cannot be
selected, copied or run through a translation tool.

**Rationale.** Prevents drag-selecting the sequencer grid by accident, which
would otherwise happen constantly.

**Remedy.** Scope it to interactive surfaces and leave prose selectable.

### G4 — Touch targets are below 44 × 44 px

**Issue.** Step cells are 24 × 38 px; lane buttons are smaller still.

**Rationale.** 16 steps across at a usable size is the point of the layout.

**Status.** Mobile is explicitly not a design target — see the
[README](../README.md#browser-support). Tablet at ≥1100 px is usable.

### G5 — No skip link

**Issue.** No "skip to main content" link.

**Rationale.** The page is a single view with one landmark structure; a
screen-reader user reaches the sequencer within a few stops.

**Remedy.** Add landmarks and a skip link if the page grows.

### G6 — The oscilloscope has no non-visual equivalent

**Issue.** The vector scope is a purely visual monitoring tool with no audio or
text alternative.

**Rationale.** Its content *is* the audio, which is simultaneously audible. A
sighted user gets a waveform; every user gets the sound.

**Status.** Not a conformance failure — the information is available through
another sense — but a peak/RMS meter with an accessible text value would be a
genuine addition.

### G7 — Audio output has no transcript

**Issue.** The instrument produces sound; there is no captioning or transcript.

**Status.** Not applicable under WCAG: this is live, user-generated output
rather than prerecorded media. Noted for completeness.

### G8 — Focus trap is manual

**Issue.** The focus trap is JavaScript rather than platform behaviour.

**Mitigation.** Correctly implemented, covering <kbd>Tab</kbd>,
<kbd>Shift</kbd>+<kbd>Tab</kbd>, <kbd>Esc</kbd>, backdrop click, entry focus and
exit focus restore.

**Remedy.** Migrate to native `<dialog>`.

---

## 9. Testing

### Automated

`tools/validate.mjs` runs on every push and enforces:

- every `getElementById` target exists
- every `label[for]` resolves
- every `var(--x)` is declared
- the script parses

It does **not** attempt to evaluate ARIA correctness — that needs a real DOM and
a real engine. axe-core in a headless browser is the planned addition; see
[TESTING.md](TESTING.md).

### Manual

Verified by hand in Chrome, Firefox and Safari:

| Check | Method |
|---|---|
| Full keyboard operation | Unplug the mouse; build a pattern from scratch |
| Screen reader | VoiceOver (macOS/Safari), NVDA (Windows/Firefox) |
| Focus visibility | Tab through the entire interface |
| Focus preservation | Toggle a step 20 times; confirm focus never leaves it |
| Reduced motion | Enable the OS setting; confirm animations stop and layout is unchanged |
| High contrast | Enable `prefers-contrast: more`; confirm borders and cells |
| Modal | Open, trap, <kbd>Esc</kbd>, backdrop click, focus restore |
| 200 % zoom | Browser zoom to 200 %; confirm no content is lost |

The full matrix, with pass criteria, is in [TESTING.md](TESTING.md).

---

## 10. Reporting

Accessibility defects are treated as functional bugs, not enhancements.

Open an issue using the bug report template and add the `accessibility` label.
Please include: browser and version, assistive technology and version, OS
accessibility settings in effect, and the steps to reproduce.

If a workaround exists, it will be documented here while a fix is developed.

---

*See also: [TESTING.md](TESTING.md) · [DESIGN.md](DESIGN.md) ·
[ROADMAP.md](ROADMAP.md)*
