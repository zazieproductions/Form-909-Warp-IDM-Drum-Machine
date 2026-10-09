# Design

**Form 909-WARP** — visual language, interaction model, and why it looks like this

---

## Contents

1. [The conceit](#1-the-conceit)
2. [Visual language](#2-visual-language)
3. [Layout](#3-layout)
4. [The sequencer grid](#4-the-sequencer-grid)
5. [Interaction design](#5-interaction-design)
6. [Motion](#6-motion)
7. [Design tokens](#7-design-tokens)
8. [What the design refuses to do](#8-what-the-design-refuses-to-do)

---

## 1. The conceit

Form 909-WARP is presented as **The Bureau of Unreasonable Rhythms** — a
fictional standards agency that measures, audits and files rhythm. Every label
is written in the register of institutional paperwork: *Case 01: Confield
Lattice*, *Curated Dissonance Archive*, *Master Anomaly Engine*, *Collapse
Matrix*, *Directive 44: all sync violations must be documented in triplicate*.

This is not decoration. It does three things.

**It gives the parameters a hierarchy.** "Bit crush" is a knob. "Master Anomaly
Engine — DIRT/CRUSH" is a piece of equipment you are operating. The framing
makes nine abstract DSP parameters feel like a machine with parts, which is how
a musician relates to hardware.

**It makes the extremity legible.** The honest description of this instrument
is "a machine for producing unreasonable rhythm". An austere bureaucratic
register, played straight, is funnier and more memorable than an enthusiastic
one, and it gives the user permission to make something strange — they are
filing a report, not committing to a banger.

**It sets a tone that survives the interface.** IDs, ticker messages, error
strings and the export filename all carry the voice. Nothing breaks character
into developer-speak, including the failure states.

The single deliberate exception is the documentation, which is written plainly.
A joke that has to be explained in a bug report has stopped being funny.

---

## 2. Visual language

### Instrument, not application

The reference is late-20th-century laboratory equipment: rack-mounted modules,
silkscreened panel labels, amber and cyan CRT readouts, scanlines. Not a
skeuomorphic replica of a specific device — an archetype of the category.

| Device convention | Implementation |
|---|---|
| Rack modules | Every panel is a bordered `module-box` with a titled header |
| Silkscreen labels | Uppercase, letter-spaced, 9–10 px, dim — `--text-dim` |
| CRT readout | Dark screen, cyan trace with phosphor glow, scanline overlay |
| Status lamps | The SYNC LED pulses amber on the quarter note |
| Panel screws and rails | Implied by the border and shadow treatment, not drawn |

### Colour

The palette is a cold, dark instrument chassis with high-chroma accents.

| Role | Token | Value | Notes |
|---|---|---|---|
| Chassis | `--bg-dark` | `#0a0c0e` | Near-black, faintly blue |
| Panel | `--panel-bg` | `#12161b` | Every module surface |
| Panel border | `--panel-border` | `#232c35` | Deliberately low contrast |
| Screen | `--screen-bg` | `#06090c` | CRT interior |
| Primary accent | `--cyan` | `#38bdf8` | Live signal, active elements |
| Secondary accent | `--amber` | `#f59e0b` | Warnings, the SYNC lamp |
| Success | `--rad-green` | `#10b981` | Probability, export |
| Danger | `--rad-red` | `#ef4444` | Destructive, glitch lane |
| Anomaly | `--glitch-pink` | `#f43f5e` | Master Anomaly Engine |

Accent colours are reserved. Cyan means "live signal or active state"; amber
means "attention"; the rest mark specific functions. Nothing is coloured for
decoration alone.

### Type

Three faces, each with one job:

| Face | Role | Why |
|---|---|---|
| **Share Tech Mono** | Interface, labels, values | Technical register; tabular figures so numbers do not jitter as they change |
| **VT323** | CRT readouts | A genuine terminal bitmap face, used only on screen surfaces |
| **Space Grotesk** | Headings | The one humanist voice; used sparingly |

Monospace is the default for the interface because nearly everything on screen
is a number, and proportional figures shift as values change.

All three load from Google Fonts. If they are unavailable the instrument still
works — only the typography changes. This is the application's only network
dependency.

---

## 3. Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER                                                              │
│  FORM 909-WARP   THE BUREAU OF UNREASONABLE RHYTHMS                 │
│  HIGH-PRECISION METRIC LABORATORY // BRAINDANCE & GLITCH DIVISION    │
│                          ●SYNC  [▶ EXECUTE] BPM[168] [MUTATE] [EXP] │
├──────────────────┬──────────────────────────────────────────────────┤
│ TELEMETRY RACK   │ SEQUENCER RACK                                   │
│ (aside)          │ (main)                                           │
│                  │                                                  │
│ Vector scope     │ ┌──────────────────────────────────────────────┐ │
│ ───────────────  │ │ SYNCHRONOUS SUB-DIVIDED LANES                │ │
│ Archive          │ │                        [PURGE] [GEN SEED]    │ │
│ ───────────────  │ ├──────────────────────────────────────────────┤ │
│ Anomaly engine   │ │ KICK   ▓░░▒░░░▓░▒░░░▓  MUTE SOLO  LEN[16] GEN│ │
│ ───────────────  │ │ SNARE  ░░░▓░▒░░░▓░░░░  MUTE SOLO  LEN[16] GEN│ │
│ Collapse matrix  │ │ HAT    ▒░▒░▓░▒░▓░▒░▒▓  MUTE SOLO  LEN[16] GEN│ │
│                  │ │ CONK   ░▒░░▓░░▒░░▓░░░  MUTE SOLO  LEN[12] GEN│ │
│                  │ │ GLTCH  ░░▓░░░▒░░░▓▒░░  MUTE SOLO  LEN[14] GEN│ │
│                  │ │ SUB    ▓░░░▒░░░▓░░░▒░  MUTE SOLO  LEN[16] GEN│ │
│                  │ ├──────────────────────────────────────────────┤ │
│                  │ │ SELECTED CELL TELEMETRY                      │ │
│                  │ │ VELOCITY  RATCHET  PROBABILITY  PITCH P-LOCK │ │
│                  │ └──────────────────────────────────────────────┘ │
└──────────────────┴──────────────────────────────────────────────────┘
```

A two-column CSS grid: telemetry on the left, the sequencer on the right. The
sequencer takes the larger share, because it is the instrument and the rack is
the readout.

### Priorities

1. **The grid is always fully visible.** Six lanes, up to 32 cells, no
   scrolling. This is the one thing that must never be compromised.
2. **The grid and the inspector are adjacent.** Editing a step means looking
   between the two; they are stacked, not separated.
3. **Transport is always reachable.** It is in the header, which does not
   scroll.

### Responsive

| Breakpoint | Change | Rationale |
|---|---|---|
| ≤ 1100 px | Two columns collapse to one | The grid needs full width more than the rack needs to be beside it |
| ≤ 800 px | Footer grid collapses | — |

The telemetry rack moves below the sequencer. This is the right trade: on a
narrow screen you want to play, and you can scroll to the effects.

---

## 4. The sequencer grid

### Cell anatomy

```
┌─────────┐   24 × 38 px
│    3    │   step number, 1-based, dim
│   2x    │   ratchet — or the pitch lock if unratcheted
│ ▁▁▁▁▁▁  │   probability bar
└─────────┘
```

Four data points in 24 × 38 pixels, without icons:

| Data | Encoding |
|---|---|
| **Position** | The number, and the cell's place in the row |
| **Active** | Background colour — dark slate to saturated |
| **Ratchet** | Background hue, plus a textual `nx` |
| **Pitch lock** | A `+7` / `−5` subscript |
| **Probability** | A filled micro-bar |
| **Playhead** | A pale yellow outline |

### Why text instead of icons

`2x` and `+7` are unambiguous at 9 px and need no legend. An icon set for
ratchet counts and semitone offsets would be smaller, less legible, and would
require the user to learn it. Text is also what a screen reader reads — the
same glyphs that serve sighted users serve the accessible name.

### Colour as state

| Ratchet | Background | Border |
|---|---|---|
| Inactive | `#141b22` | `#25303c` |
| 1× | `#0284c7` | `#38bdf8` |
| 2× | `#2563eb` | `#60a5fa` |
| 3× | `#7c3aed` | `#a78bfa` |
| 4× | `#d946ef` | `#f0abfc` |

Hue advances blue → violet → magenta with intensity. The progression is
perceptually ordered: more ratchets look hotter.

> **Known limitation.** Active-vs-inactive is conveyed by colour alone. See
> [ACCESSIBILITY.md §G1](ACCESSIBILITY.md#g1--step-state-is-conveyed-by-colour-alone).

---

## 5. Interaction design

### Directness

Every control is one action away. No modes, no menus, no modifier keys required
for the basics, no double-clicks, no long-presses. The grid is the interface and
clicking a cell does the obvious thing.

### Immediate feedback

| Action | Feedback |
|---|---|
| Toggle a step | Cell changes colour; inspector binds to it |
| Change a slider | Value read-out updates instantly; audio follows on the next step |
| Load a preset | Grid, BPM and bus all update; ticker confirms |
| Press MUTATE | Whole grid changes; ticker reports |
| Lane length change | Lane re-renders; ticker reports the new length |
| Export completes | Progress bar, seed disclosure, file download |

### <kbd>Shift</kbd> as the only modifier

Exactly one modifier is used, and it means "more of this": click toggles,
<kbd>Shift</kbd>+click ratchets. One modifier is learnable. A palette of
<kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>Shift</kbd> combinations on a grid would be
a manual.

Right-click selects without toggling — the one non-obvious gesture, and it is
also available by simply clicking a cell and reading the inspector.

### No undo

There is no undo stack. This is a deliberate omission, and the reasoning is
that pattern editing here is closer to knob-twiddling than to text editing:
changes are cheap, reversible by hand, and the shortest path to a good pattern
is usually to press **MUTATE** again rather than to step backwards.

The mitigations are that **MUTATE** is non-destructive to overall density,
presets are a one-click reset, and **PURGE ALL** leaves parameter locks intact
so a cleared step can be restored by re-activating it.

> **Roadmap.** Undo for grid edits is a frequently requested item. It is
> tractable — the state is a small serialisable object — and it is tracked in
> [ROADMAP.md](ROADMAP.md).

---

## 6. Motion

Motion is used for state feedback, never for delight.

| Element | Motion | Purpose |
|---|---|---|
| SYNC LED | Amber pulse on the quarter note | Confirms the clock is running |
| Playhead | Yellow outline advancing per step | Shows position |
| Active transport button | Running state | Confirms playback |
| Record indicator | Slow blink | Ambient "armed" signal |
| Danger states | Slow red pulse | Signals destructive action |
| Scanlines | Static overlay | CRT texture |
| Oscilloscope | Continuous trace | Live readout |

Everything decorative is disabled under `prefers-reduced-motion`. The
oscilloscope is not, because it is a readout of the audio rather than an
animation — see [ACCESSIBILITY.md §4](ACCESSIBILITY.md#4-motion).

---

## 7. Design tokens

All colour, type and spacing decisions resolve through CSS custom properties
declared once in `:root`.

```css
:root {
  /* Surfaces */
  --bg-dark: #0a0c0e;
  --panel-bg: #12161b;
  --panel-border: #232c35;
  --screen-bg: #06090c;
  --crt-glow: rgba(56, 189, 248, 0.15);

  /* Accents */
  --amber: #f59e0b;
  --amber-glow: rgba(245, 158, 11, 0.35);
  --cyan: #38bdf8;
  --cyan-bright: #7dd3fc;
  --rad-green: #10b981;
  --rad-red: #ef4444;
  --glitch-pink: #f43f5e;

  /* Type */
  --text-dim: #74839a;   /* 4.72:1 on panel — WCAG AA at 9–10 px */
  --text-mid: #94a3b8;
  --text-bright: #f8fafc;
  --mono: 'Share Tech Mono', monospace;
  --display: 'VT323', monospace;
  --sans: 'Space Grotesk', sans-serif;
}
```

`tools/validate.mjs` fails CI if a `var(--x)` reference has no declaration in
`:root`, which prevents a typo'd token from silently rendering as no colour.

---

## 8. What the design refuses to do

Recorded because these are the requests a project like this reliably receives,
and the answers should not have to be re-derived each time.

**No dark/light theme toggle.** The subject matter is a luminous instrument
panel in a dark room. A light theme would break the metaphor and the contrast
model together.

**No rounded, soft or "friendly" variant.** The austerity is the point. The
instrument is funny *because* it is severe.

**No 3D knobs or skeuomorphic controls.** Sliders are used throughout. They
take one gesture, they are natively accessible and natively keyboard-operable,
and they show their value numerically — which a rotary control does not.

**No animation on the grid beyond the playhead.** 192 cells animating would be
noise. State changes are instant.

**No mobile-first layout.** Sixteen to thirty-two steps across requires width.
Mobile is not a design target; see the
[README](../README.md#browser-support).

**No tooltips explaining the Bureau jokes.** They either land or they do not.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) ·
[ACCESSIBILITY.md](ACCESSIBILITY.md) · [MAINTAINABILITY.md](MAINTAINABILITY.md)*
