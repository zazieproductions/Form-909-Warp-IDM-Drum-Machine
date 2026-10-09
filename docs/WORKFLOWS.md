# Workflows

**Form 909-WARP** — how the instrument is actually played

This document is the practical counterpart to
[ARCHITECTURE.md](ARCHITECTURE.md). It describes what a session looks like end
to end, the complete input reference, and a set of recipes for getting specific
results.

---

## Contents

1. [A first session](#1-a-first-session)
2. [Input reference](#2-input-reference)
3. [Building a pattern](#3-building-a-pattern)
4. [Recipes](#4-recipes)
5. [Bouncing a file](#5-bouncing-a-file)
6. [Mental model](#6-mental-model)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. A first session

```
1.  Open the file.  Case 01: Confield Lattice is loaded at 168 BPM.
    Nothing is playing and no audio context exists yet.

2.  Press Space.    The AudioContext is created on this first gesture
                    (browsers require it), the scheduler starts, and the
                    grid cursor begins moving.

3.  Listen for one full cycle. With lane lengths of 16, 16, 16, 12, 14 and 16,
    the matrix takes several bars to realign. Nothing repeats quickly.

4.  Drag SWING % to 0, then to 40. Hear the grid straighten, then lurch.

5.  Click GLOBAL PROB and drag to 60. Steps begin dropping out at random.

6.  Click any step in the HAT lane. It toggles off. Shift-click it: it
    returns as a 2× ratchet.

7.  Click that step, then drag PITCH P-LOCK in the inspector. The cell shows
    the semitone offset.

8.  Press MUTATE. Then press it again. Then again.

9.  Press EXPORT 24-BIT WAV → RENDER WAV. A .wav file downloads.
```

That is the whole instrument.

---

## 2. Input reference

### Pointer

| Action | Context | Result |
|---|---|---|
| Click | Step cell | Toggle the step |
| <kbd>Shift</kbd>+Click | Step cell | Cycle ratchet 1→2→3→4→1 (forces the step on) |
| Right-click | Step cell | Select for the inspector, without toggling |
| Click | MUTE / SOLO | Toggle per lane |
| Type a value | LEN | Set lane length, 1–32 |
| Click | GEN | Generate a Euclidean rhythm for that lane |
| Drag | Any slider | Continuous parameter change |
| Click the backdrop | Export modal | Dismiss |

### Keyboard

| Key | Context | Result |
|---|---|---|
| <kbd>Space</kbd> | Outside form controls and cells | Start / stop |
| <kbd>Tab</kbd> | Global | Move focus; active step cells are in the order |
| <kbd>Enter</kbd> | Focused step cell | Toggle |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Focused step cell | Cycle ratchet |
| <kbd>←</kbd> / <kbd>→</kbd> | Focused step cell | Move within the lane |
| <kbd>Tab</kbd> | Export modal | Cycle inside the dialog |
| <kbd>Esc</kbd> | Export modal | Close |

### Reading a cell

```
┌────────┐
│   3    │   ← step number (1-based)
│  2x    │   ← ratchet, or the pitch lock if there is no ratchet
│ ▔▔▔▔   │   ← probability bar (full = 100 %)
└────────┘
```

Cell background encodes the ratchet:

| Colour | Meaning |
|---|---|
| Dark slate | Inactive |
| Cyan | Active, 1× |
| Blue | Active, 2× |
| Violet | Active, 3× |
| Magenta | Active, 4× |

The current step is outlined in pale yellow.

---

## 3. Building a pattern

### Recommended order

**1. Choose lengths before notes.** Length is the structural decision; notes
fill the structure. Load `empty` and set the six lengths first.

**2. Lay the spine.** Kick and snare at 16. This is what the ear tracks.

**3. Add the drift.** Percussion and glitch at coprime lengths — 7, 11, 13.
This is where the polyrhythm lives.

**4. Fill sparsely.** At 168 BPM sixteen steps pass in under 1.5 seconds. Six
active steps per lane is dense; three is usually more interesting.

**5. Add parameter locks last.** Three well-placed pitch locks or probability
values do more than twenty scattered ones.

**6. Set the bus.** Crush and drive are part of the pattern's identity, not
afterthoughts.

### Useful shapes

| Lane | Length | Pattern | Effect |
|---|---|---|---|
| Kick | 16 | Steps 1, 7, 11 | Displaced four-on-the-floor |
| Snare | 16 | Steps 5, 13 | Backbeat, one step late |
| Hat | 16 | Every odd step | Straight 8ths |
| Perc | 7 | Steps 1, 4 | Migrating against the spine |
| Glitch | 13 | Steps 1, 5, 9 | Slowly drifting |
| Sub | 16 | Steps 1, 7 with pitch locks 0 / +7 | Root-fifth movement |

### Ratchet placement

A ratchet on a *downbeat* reads as a fill. A ratchet on the *last* sub-division
of a bar reads as a pickup into the next bar. A ratchet on an *off-beat* in a
sparse lane is where the drill vocabulary lives — try step 7 of a 16-step hat
lane at 4×.

At 210 BPM a 4× ratchet fires at 56 Hz, which blurs into a buzz. That is the
intended effect at that tempo and it does not work the same way at 128.

---

## 4. Recipes

### Tight, clinical drill

```
Preset      → empty
BPM         → 190
Lengths     → 16, 16, 16, 7, 16, 16
Kick        → steps 1, 9
Snare       → steps 5, 13
Hat         → every step, most at 2× or 4×
Glitch      → steps 3, 11, 15 at 4×
Swing       → 0
Bit crush   → 0.35
Drive       → 0.45
Delay       → short (0.08 s), low feedback (0.15)
Jitter      → 2 ms
```

### Slow, drifting ambience

```
Preset      → raster
BPM         → 110
Lengths     → 13, 13, 16, 9, 11, 13
Kick        → steps 1, 8
Sub         → steps 1, 6 with pitch locks −12 and −5
Perc        → steps 1, 5 with pitch locks +12 and +19
Bit crush   → 0.05
Cutoff      → 4 kHz
Delay       → 0.5 s, feedback 0.6
```

### Broken, glitch-heavy

```
Preset      → confield
BPM         → 178
Global prob → 70 %
Drill dens. → 60 %
Swing       → 30 %
Bit crush   → 0.7
Drive       → 0.6
Jitter      → 18 ms
```

Then press **MUTATE** until it sounds wrong in an interesting way.

### Euclidean study

```
Preset      → empty
Lengths     → 16, 16, 16, 5, 7, 11
```

Press **GEN** on each lane. Five-step and seven-step Euclidean figures are
among the most rhythmically legible; against a 16-step spine they produce the
"correct-sounding but unplaceable" quality the algorithm is known for.

### Building a 16-bar arrangement

The instrument has no song mode. The practical approach is to bounce successive
variations:

1. Build a pattern; export 4 patterns.
2. Press **GENERATIVE SEED** or **MUTATE**; adjust lengths; export 4 more.
3. Repeat.
4. Arrange the bounces in a DAW.

The seed reported per render lets you go back and re-render any section later.

---

## 5. Bouncing a file

```
1.  Press EXPORT 24-BIT WAV.
2.  Choose a length: 2 / 4 / 8 / 16 patterns.
3.  Press RENDER WAV.
4.  The bar advances through ten real checkpoints as the offline context
    renders faster than real time.
5.  On completion the dialog shows the bit depth and the seed used, and the
    file downloads.
```

### Which length

| Length | Use |
|---|---|
| 2 patterns | A loop to audition or drop into a sampler |
| 4 patterns | Default; enough to hear the polyrhythm drift |
| 8 patterns | A section |
| 16 patterns | Long enough to capture a 13/16 cycle's full evolution |

### Before bouncing

- Confirm the delay tail has room. With feedback at 0.85 the tail can outlast
  the fixed 1.5 s of padding; lower the feedback if the cut is audible.
- Note the seed if you may need to reproduce the render.
- Check that the bounce matches what you are hearing. If it does not, that is a
  bug — see [TESTING.md](TESTING.md#5-audio-verification).

### After bouncing

The file is 24-bit, 48 kHz, stereo (dual-mono), uncompressed PCM. It imports
into any DAW without conversion.

---

## 6. Mental model

Three ideas make everything else obvious.

### The grid is a distribution, not a script

With probability, drill injection and jitter engaged, the pattern you drew is
not a fixed sequence — it is a *distribution* of sequences. Expecting the same
thing twice is the wrong expectation; the instrument is designed to surprise
you within boundaries you set.

The one exception is the bounce, which is seeded and reproducible on purpose.

### Lane lengths are the primary creative control

Changing a lane from 16 to 13 does not make it "syncopated" — it makes it
migrate. The relationship between lengths is where the interesting rhythm
emerges, and it is a higher-level decision than which steps to fill.

### Parameter locks turn a grid into a score

A step is not a bit. With velocity, ratchet, probability and pitch per step,
sixteen positions per lane carry far more than sixteen bits of information. This
is the tracker discipline applied to a grid, and it is what makes a short
pattern worth listening to for nineteen minutes.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No sound at all | The `AudioContext` has not been created, or output is muted | Click anywhere in the page, or press <kbd>Space</kbd>. Check system output. |
| Audio starts late after pressing play | Normal — the first step is scheduled 50 ms out | None needed |
| The cursor moves but nothing sounds | All lanes muted, or a lane is soloed while empty, or every step is inactive | Check MUTE / SOLO; load a preset |
| A lane is silent | It is muted, or another lane is soloed | Check the MUTE / SOLO buttons |
| The pattern sounds static | All lanes are the same length, or probability is 100 % | Change a lane length; lower global probability |
| Everything sounds crushed | Bit crush is high | Lower it; note that presets set their own value |
| The bounce sounds different from playback | A parity bug | See [TESTING.md](TESTING.md#5-audio-verification); please file an issue |
| Export does nothing | `OfflineAudioContext` unavailable | Check the console; the dialog shows the error |
| The delay builds into a wall of noise | Feedback is very high | Reduce feedback; the limiter prevents runaway but cannot prevent density |
| Sound is distorted | Drive and/or crush are high with dense material | Lower drive; remember the limiter is doing deliberate work |
| Keyboard focus jumps away after a toggle | A focus-preservation bug | It should not; please file an issue |
| The interface animates when I would rather it did not | — | Enable "reduce motion" at the OS level |

---

*See also: [PATTERNS.md](PATTERNS.md) · [EXPORT.md](EXPORT.md) ·
[API.md](API.md) · [ACCESSIBILITY.md](ACCESSIBILITY.md)*
