# Patterns & Presets

**Form 909-WARP** — the pattern data model, the preset schema, and how to
author new material.

---

## Contents

1. [The pattern matrix](#1-the-pattern-matrix)
2. [Polyrhythm](#2-polyrhythm)
3. [Per-step parameters](#3-per-step-parameters)
4. [Preset schema](#4-preset-schema)
5. [The nine case files](#5-the-nine-case-files)
6. [Authoring a preset](#6-authoring-a-preset)
7. [The Euclidean generator](#7-the-euclidean-generator)
8. [Mutate and generative seed](#8-mutate-and-generative-seed)
9. [Serialisation](#9-serialisation)

---

## 1. The pattern matrix

The pattern is a two-dimensional array: six tracks, each with 32 step slots.

```
                       step ─────────────────────────────────────────▶
                    0   1   2   3   4   5   6   7   8   9  10  11 …
        ┌─────────┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
        │ KICK    │ ▓ │   │   │ ▒ │   │   │   │ ▓ │   │   │ ▒ │   │
        │ SNARE   │   │   │   │   │ ▓ │   │   │   │   │ ▒ │   │   │
  track │ HAT     │ ▒ │   │ ▓ │   │ ▒ │   │ ▓ │   │ ▒ │   │ ▓ │   │
        │ CONK    │   │ ▓ │   │   │   │   │ ▒ │   │   │   │   │ ▒ │   len 12
        │ GLITCH  │   │   │ ▒ │   │   │ ▓ │   │   │ ▒ │   │   │   │   len 14
        │ SUB     │ ▓ │   │   │   │   │   │ ▓ │   │   │   │ ▓ │   │
        └─────────┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
                                                          ▲
                                          steps ≥ currentLength are
                                          allocated but never read
```

**All 32 slots always exist.** `currentLength` gates which are read. This is
what makes length changes non-destructive — shortening a lane hides steps, and
extending it brings them back with their parameters intact.

Each cell holds five values:

| Field | Type | Range |
|---|---|---|
| `active` | `boolean` | — |
| `vel` | `number` | 0 – 127 |
| `ratchet` | `number` | 1 – 4 |
| `prob` | `number` | 0 – 100 |
| `pitchOffset` | `number` | −24 – +24 |

---

## 2. Polyrhythm

Each lane indexes the global step counter modulo its own length:

```js
const trackStepIndex = globalStep % track.currentLength;
```

That single modulo is the entire polyrhythm mechanism. With lengths 13, 13, 16,
7, 9 and 13, the composite cycle is:

```
lcm(13, 16, 7, 9) = 13 104 steps
```

At 168 BPM a sixteenth note is 89.3 ms, so the matrix takes a little over
**19 minutes** to realign. In practice it never repeats within a session.

### Choosing lengths

| Length | Feels like | Useful for |
|---|---|---|
| 16 | One bar of 16ths | Anchoring material |
| 14 | 7/8 divided into 16ths | Drill, awkward momentum |
| 13 | 13/16 | Uneven cycles that never settle |
| 12 | 3/4 in 16ths, or triplets against 16 | Rolling, three-against-four |
| 11 | 11/16 | Sparse, lurching |
| 9 | 9/16 | Very short cycles; rapid apparent repetition |
| 7 | 7/8 or 7/16 | Extreme drill; cycles fast |
| 1 | Constant retrigger | Drones, walls of noise |

Lengths that share a factor with 16 (i.e. 4, 8, 12) realign within a bar or
two and read as syncopation. Lengths coprime to 16 (7, 9, 11, 13) drift and
read as genuine polyrhythm. Both are useful; the presets are weighted towards
the coprime ones because drift is the instrument's premise.

### Practical recipe

Set the kick and snare to 16, then move the percussion and glitch lanes to 7
and 13. The result is a stable spine with two layers that migrate across it.

---

## 3. Per-step parameters

### Velocity (`vel`, 0–127)

Scales the voice's amplitude envelope and, for the kick and perc, its FM
modulation depth. Timbre does not change — a soft hit is the same instrument.

Ratchet repeats decay the velocity they receive:

```
repeat r receives vel × (1 − r × 0.12), floored at 20
```

So a 4× burst at velocity 100 fires `100 / 88 / 76 / 64`. This is what makes a
ratchet read as a drill fill rather than four identical clicks.

### Ratchet (`ratchet`, 1–4)

Divides the step into that many equally spaced sub-triggers:

```
subStepTime = stepDuration / ratchets
```

At 168 BPM a step is 89.3 ms, so:

| Ratchet | Spacing | Rate |
|---|---|---|
| 1× | 89.3 ms | 11.2 Hz |
| 2× | 44.6 ms | 22.4 Hz |
| 3× | 29.8 ms | 33.6 Hz |
| 4× | 22.3 ms | 44.8 Hz |

At 210 BPM a 4× ratchet fires at 56 Hz, which is at the edge of where
individual hits stop being perceived as separate events and start being heard
as a buzz. That is the intended effect for drill material.

### Probability (`prob`, 0–100)

Evaluated against the global gate:

```js
if (Math.random() * 100 > step.prob * fx.globalProb) skip;
```

The two **multiply**. A step at 60 % under an 80 % global gate fires 48 % of
the time. This makes `globalProb` a master density control rather than an
override.

Values below ~40 % produce sparse, unpredictable appearances. Values around
85–95 % produce an occasional drop-out, which is often more interesting than
100 % because it prevents the ear from fully habituating.

### Pitch lock (`pitchOffset`, −24…+24)

```js
pitchShift = Math.pow(2, pitchOffset / 12)
```

Every pitched element in a voice scales. Fixed elements — the hat's 6.8 kHz
highpass, the glitch's randomised bandpass — do not, so extreme locks change
character rather than just transposing.

| Offset | Effect on the kick (54 Hz base) |
|---|---|
| −24 | 13.5 Hz — sub-bass thump, felt more than heard |
| −12 | 27 Hz — deep sub |
| 0 | 54 Hz — designed fundamental |
| +12 | 108 Hz — tight |
| +24 | 216 Hz — tom-like |

Melodic intervals worth reaching for: `+3` and `+7` on the sub lane give a
minor/perfect fifth movement; `+12` and `+19` (octave and octave-fifth) are
effective on the metallic perc voice.

---

## 4. Preset schema

A preset is a plain object in `PRESETS`.

```js
key: {
  bpm:      number,              // 40–360
  lengths:  number[6],           // currentLength per lane, 1–32
  crush:    number,              // 0–1
  drive:    number,              // 0–1
  swing:    number,              // 0–0.5
  data:     StepSpec[][6]        // per lane, array of active steps
}
```

### `StepSpec`

A sparse entry describing one active step:

```js
{ i: 6, r: 2, p: 7, v: 110, pr: 80 }
```

| Key | Field | Default | Description |
|---|---|---|---|
| `i` | index | — | **Required.** Step position, 0-based |
| `r` | `ratchet` | `1` | 1–4 |
| `p` | `pitchOffset` | `0` | −24 – +24 semitones |
| `v` | `vel` | `100` | 0 – 127 |
| `pr` | `prob` | `100` | 0 – 100 % |

Only active steps are listed; everything else is cleared on load. Keep entries
in ascending `i` order for readability, though the loader does not require it.

### Example

```js
raster: {
  bpm: 128,
  lengths: [16, 16, 16, 16, 16, 16],
  crush: 0.05,
  drive: 0.15,
  swing: 0.0,
  data: [
    [{i:0, r:1},       {i:10, r:1}],        // BD   — two hits, one bar apart
    [{i:8, r:1}],                            // SN   — a single backbeat
    [{i:4, r:1},       {i:12, r:1}],         // CH
    [{i:6, r:1, p:12}],                      // PERC — one pitched clang
    [{i:2, r:1},       {i:14, r:2}],         // GLITCH
    [{i:0, r:1, p:-12},{i:7, r:1, p:-5}]     // SUB  — low, and lower
  ]
}
```

### Loading

```js
loadPreset('raster');
```

1. Writes `bpm`, `fx.crush`, `fx.drive`, `fx.swing` to state.
2. Syncs the corresponding widgets.
3. Rebuilds the crush and drive curves if the audio graph exists.
4. Sets each lane's `currentLength` from `lengths` (fallback: 16).
5. Resets all 32 steps of every lane to defaults.
6. Applies each `StepSpec` whose `i` is within bounds.
7. Re-renders.

> **Only three `fx` fields are preset-controlled.** Cutoff, delay time, delay
> feedback, global probability, drill density and swing-after-load persist
> across preset changes. Those are the performer's bus settings; the three that
> are written are considered part of the pattern's identity.

---

## 5. The nine case files

| # | Key | BPM | Character | What to listen for |
|---|---|---|---|---|
| 01 | `confield` | 168 | Micro-bursts | Default load. 12- and 14-step lanes drifting against a 16-step spine |
| 02 | `drukqs` | 192 | Ratchets | Dense 4× hat work; prepared-piano drill |
| 03 | `square` | 178 | Fast bass polyrhythm | Busy sub line at 11- and 13-step lengths |
| 04 | `subliminal` | 142 | Uneven cycle | 13/13/16/7/9/13 — the most polyrhythmic preset |
| 05 | `gonk` | 156 | Euclidean | Modular FM clangs at wide pitch locks up to +19 |
| 06 | `vnares` | 210 | Extreme drill | 7/8 at 210 BPM; the fastest, densest preset |
| 07 | `raster` | 128 | Sparse sub clicks | Minimal; demonstrates restraint |
| 08 | `boiler` | 165 | Industrial crush | Highest drive (0.65) and swing (0.22) |
| 09 | `empty` | 160 | Blank slate | All steps cleared; a starting point |

### Suggested experiments

- Load `subliminal`, then set global probability to 60 %. The sparse matrix
  makes the polyrhythm audible.
- Load `vnares`, then push bit crush to 0.8. At 210 BPM the quantisation
  aliasing becomes part of the rhythm.
- Load `raster`, then press **MUTATE** repeatedly. Minimal patterns mutate into
  something interesting faster than dense ones do.
- Load `confield`, set the glitch lane to length 7, press **GEN**. A 7-step
  Euclidean figure against a 16-step spine.

---

## 6. Authoring a preset

### Process

1. **Start from `empty`.** Load it, then build.
2. **Set lengths first.** Length changes are non-destructive but they do change
   how everything else reads.
3. **Lay the spine.** Kick and snare at 16 steps.
4. **Add the drift.** Percussion and glitch at coprime lengths (7, 11, 13).
5. **Add parameter locks.** Leave most steps at defaults; three or four
   well-placed pitch locks or probability values do more than twenty.
6. **Tune the bus.** Crush and drive are part of the pattern's identity; set
   them deliberately.
7. **Transcribe to the schema** and add it to `PRESETS` and to the
   `#presetSelect` dropdown.

### Review checklist

- [ ] `lengths` has exactly six entries
- [ ] `data` has exactly six arrays
- [ ] Every `i` is less than that lane's length
- [ ] Every `r` is 1–4
- [ ] Every `p` is −24 to +24
- [ ] Every `v` is 0–127
- [ ] Every `pr` is 0–100
- [ ] A `<option>` was added to `#presetSelect`
- [ ] The badge count in the module title was updated
- [ ] `npm run check` passes

### Adding the option

```html
<option value="mycase">Case 10: My Case Name (174 BPM · Character)</option>
```

The option text is not parsed — it is display only. Keep the
`Case NN: Name (BPM · Character)` convention so the dropdown stays scannable.

---

## 7. The Euclidean generator

`generateEuclidean(tIdx)` overwrites a lane with a Euclidean distribution using
the Bjorklund algorithm, as popularised by Godfried Toussaint's
*The Euclidean Algorithm Generates Traditional Musical Rhythms*.

### Algorithm

```js
const totalSteps = track.currentLength;
const pulses = Math.max(1, Math.floor(totalSteps * (Math.random() * 0.5 + 0.25)));

let pattern = new Array(totalSteps).fill(false);
let bucket = 0;
for (let i = 0; i < totalSteps; i++) {
  bucket += pulses;
  if (bucket >= totalSteps) {
    bucket -= totalSteps;
    pattern[i] = true;
  }
}
```

This is the accumulator formulation of Bjorklund: accumulate `pulses` per step
and emit a hit each time the bucket reaches `totalSteps`. It distributes `k`
pulses as evenly as possible across `n` slots — which is what makes
`E(3, 8) = [x . . x . . x .]` rather than any lumped alternative.

Density is randomised between 25 % and 75 % each invocation. Each active hit
then has a 25 % chance of being promoted to a 2× ratchet.

### Why Euclidean

Euclidean rhythms are the shared skeleton of an enormous number of traditional
musics — Toussaint's paper demonstrates this across sub-Saharan African,
Brazilian, Middle Eastern and European traditions. Generating them
algorithmically gives rhythmically "correct" distributions instantly, which is
useful both as a compositional starting point and as a way to break out of the
patterns a hand tends to draw.

### Examples at common lengths

| Length | Pulses | Pattern |
|---|---|---|
| 16 | 4 | `x . . . x . . . x . . . x . . .` |
| 16 | 5 | `x . . x . x . . x . . x . x . .` |
| 12 | 5 | `x . x . x . x . x . . .` |
| 7 | 3 | `x . x . x . .` |
| 13 | 5 | `x . . x . x . . x . x . .` |

**Destructive.** Pressing **GEN** replaces the lane; there is no undo.

---

## 8. Mutate and generative seed

### Mutate

`mutateRhythms()` applies stochastic deviation across the whole matrix:

| Event | Probability |
|---|---|
| A step's active state flips | 22 % |
| An active step is assigned a random ratchet from `[1, 2, 3, 4]` | 35 % |
| An active step gets a pitch lock from `[-12, -7, -5, 0, 3, 7, 12, 19]` | 25 % |
| An active step's probability is randomised to 55–99 % | 30 % |

Because flips are bidirectional, mutate preserves overall density while
rearranging it. Repeated application performs a random walk: after a few
presses the result is unrelated to the origin.

**The 22 % flip rate is deliberately low.** Each press should produce a
recognisable variation, not a new pattern. Use **GENERATIVE SEED** when you
want the latter.

### Generative seed

`randomizeAllBtn` handler:

```js
s.active = Math.random() < 0.28;
s.ratchet = Math.random() < 0.2 ? (Math.random() > 0.5 ? 2 : 4) : 1;
s.pitchOffset = Math.random() < 0.25 ? [-12, -5, 0, 7, 12][Math.floor(Math.random() * 5)] : 0;
```

Creates an entirely new pattern: 28 % density, 20 % of steps ratcheted, 25 %
pitch-locked. Probability is reset to 100 %.

### Purge

`clearAllBtn` deactivates every step and resets every ratchet to 1. Velocity,
probability and pitch locks are left in place, so re-activating a step restores
its character.

---

## 9. Serialisation

> **Status: not implemented.** There is no save/load in the current release.
> This section documents the intended shape and is the specification for the
> highest-priority roadmap item.

The natural serialisation is the `PRESETS` schema extended to cover all `fx`
fields, because `loadPreset()` already consumes most of it:

```json
{
  "format": "form909warp.pattern",
  "version": 1,
  "bpm": 168,
  "lengths": [16, 16, 16, 12, 14, 16],
  "fx": {
    "crush": 0.28, "drive": 0.35, "humanize": 4,
    "cutoff": 16500, "delayTime": 0.18, "delayFeedback": 0.32,
    "globalProb": 1.0, "globalRatchet": 0.2, "swing": 0.16
  },
  "data": [
    [{ "i": 0, "r": 1, "p": 0 }, { "i": 3, "r": 2, "p": 0 }]
  ]
}
```

Extending it to cover the six `fx` fields currently outside preset scope, plus
solo/mute state, is all that is needed for a complete round-trip. A
URL-fragment encoding of the same structure would additionally make patterns
shareable by link.

Tracked in [ROADMAP.md](ROADMAP.md).

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) ·
[EXPORT.md](EXPORT.md) · [WORKFLOWS.md](WORKFLOWS.md)*
