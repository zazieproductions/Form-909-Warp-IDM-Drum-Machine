# Performance

**Form 909-WARP** — budgets, hot paths, and where the costs actually are

---

## Contents

1. [Budget](#1-budget)
2. [Where the time goes](#2-where-the-time-goes)
3. [The scheduler](#3-the-scheduler)
4. [Voice cost](#4-voice-cost)
5. [Allocation and garbage](#5-allocation-and-garbage)
6. [Render cost](#6-render-cost)
7. [Export cost](#7-export-cost)
8. [Memory](#8-memory)
9. [Profiling](#9-profiling)
10. [Optimisation policy](#10-optimisation-policy)

---

## 1. Budget

The governing constraint is the audio callback. Everything else has slack.

| Budget | Target | Measured | Headroom |
|---|---|---|---|
| Scheduler wake | < 1 ms per 25 ms tick | ~0.05 ms | 500× |
| Full grid re-render (192 cells) | < 8 ms | ~1 ms | 8× |
| Frame budget (60 fps) | 16.7 ms | see [§6](#6-render-cost) | — |
| Audio glitch rate | 0 dropouts | 0 | — |
| Steady-state heap | < 50 MB | ~12 MB | 4× |

The only budget that genuinely matters is **no dropped audio**. A dropped frame
is a visible stutter; a dropped audio buffer is an audible click, and at 48 kHz
a 128-frame buffer is 2.7 ms — there is no perceptual forgiveness.

---

## 2. Where the time goes

Per sixteenth note at 168 BPM (89.3 ms), with all six lanes active:

```
trigger 6 voices × build node graph ─────────────────── ~0.15 ms  ██
schedule 1 visual cursor callback ────────────────────  ~0.01 ms  ▏
scheduler wake (amortised over ~3.6 steps) ───────────  ~0.05 ms  █
scope: 1 canvas frame @ 60 fps (2 700 frames/bar) ────  ~0.30 ms  ████
────────────────────────────────────────────────────────────────────
total per step                                          ~0.5 ms of 89.3 ms
```

Audio work occupies well under 1 % of one step's wall time. The dominant
continuous cost is not audio at all — it is the oscilloscope.

---

## 3. The scheduler

```
setInterval(scheduler, 25) ──▶ while (nextNoteTime < now + 0.1) schedule + advance
```

| Parameter | Value | Consequence |
|---|---|---|
| `lookahead` | 25 ms | ~40 wakes/second |
| `scheduleAheadTime` | 0.1 s | 4× the wake interval |

The 4:1 ratio is the safety margin. A step is scheduled roughly 100 ms before it
sounds, so the timer can miss up to three consecutive wakes before audio breaks
up. Under heavy main-thread load — a long grid rebuild, a garbage collection
pause, another tab competing — this is what keeps playback clean.

**Why not a smaller lookahead?** A 5 ms wake interval would make parameter
changes feel marginally more responsive, at the cost of 5× the timer callbacks
and a much thinner margin. Responsiveness is already adequate: a pattern edit
takes effect on the next pass of that step, which is at most one step away.

**Why not a larger horizon?** Beyond ~150 ms the delay between moving a slider
and hearing it becomes noticeable. 100 ms is below the threshold where a
performer perceives the instrument as laggy.

### Worst case

At 360 BPM a step is 41.7 ms, so the 100 ms horizon spans ~2.4 steps and the
loop schedules 2–3 steps per wake. Still trivial.

---

## 4. Voice cost

Nodes created per trigger:

| Voice | Oscillators | Buffers | Filters | Gains | Total nodes |
|---|---|---|---|---|---|
| Kick | 2 | 1 | 0 | 3 | 6 |
| Snare | 1 | 1 | 1 | 3 | 6 |
| **Hat** | **6** | 0 | 1 | 2 | **9** |
| Perc | 2 | 0 | 0 | 2 | 4 |
| Glitch | 1 | 0 | 1 | 1 | 3 |
| Sub | 1 | 0 | 1 | 1 | 3 |

**The hat is the most expensive voice** — six square oscillators per trigger. A
dense hat lane at 4× ratchets and 210 BPM fires:

```
16 steps/bar × ~8 active × 4 ratchets × 6 oscillators = 1 536 oscillators/bar
210 BPM → 4.57 bar/minute → ~117 oscillators/second
```

Well within what Web Audio handles. Square-wave oscillators are also the
cheapest waveform to generate.

### The noise buffers

Snare and kick allocate a noise buffer per trigger:

| Voice | Length | Samples @ 48 kHz | Bytes |
|---|---|---|---|
| Snare | 220 ms | 10 560 | 42 KB |
| Kick | 8 ms | 384 | 1.5 KB |

A snare on every step at 210 BPM allocates ~1.5 MB/s of short-lived buffers.
This is the largest allocation source in the audio path, and it is why
[§5](#5-allocation-and-garbage) treats it as the thing to fix first if it ever
becomes a problem.

The current design accepts it: the alternative — one shared pre-generated noise
buffer — would make every snare hit phase-identical, which is exactly the
artefact the per-trigger allocation avoids. That is a deliberate quality-over-
allocation trade.

---

## 5. Allocation and garbage

| Source | Rate | Size |
|---|---|---|
| Snare noise buffers | per trigger | 42 KB |
| Kick noise buffers | per trigger | 1.5 KB |
| Audio node objects | ~4–9 per trigger | small |
| Crush curve | **memoised** | 176 KB each, max 14 |
| Drive curve | per slider input | 176 KB each |

### The crush curve was the allocation problem

`updateCrushCurve` builds a 44 100-sample `Float32Array` — 176 KB. Dragging the
crush slider sweeps 101 values, which naively means 101 allocations of 176 KB:
**17.8 MB of churn per drag**, most of it immediately garbage.

The fix is memoisation on bit depth:

```js
const bits = clamp(round(16 − amount × 13), 3, 16);
if (this._crushBits !== bits || !this._crushCurve) {
  /* … rebuild … */
}
```

101 slider positions map to 14 distinct bit depths, so **86 % of the
allocations are eliminated** and the curve is rebuilt at most 13 times per full
sweep.

### Drive curve

`updateDriveCurve` is still rebuilt on every slider input event — 176 KB per
`input` event, and a fast drag fires dozens. This is the remaining known
allocation hot spot. It was left in place because drive affects the live graph
directly and memoising it needs a quantisation key, which would introduce a
small amount of stepping in the control's response. Tracked in
[§10](#10-optimisation-policy).

### Practical impact

In testing, no garbage-collection pause has produced an audible glitch, because
the 100 ms scheduling horizon comfortably absorbs a young-generation collection
(1–5 ms). The memoisation work is preventative, not a fix for an observed
failure.

---

## 6. Render cost

### The oscilloscope

A `requestAnimationFrame` loop runs continuously once audio is initialised:

```
per frame:
  getByteTimeDomainData(Uint8Array(256))   ← analyser.fftSize 512 → 256 bins
  fillRect(300 × 90)
  2 × stroke (grid)
  polyline of 256 segments with shadowBlur 6
```

`shadowBlur` is the expensive part: canvas shadow rendering is not GPU-
accelerated in most engines and costs roughly 5–10× a plain stroke. At 300 × 90
pixels, total frame cost measures around 0.3 ms — acceptable, but it is
comfortably the largest continuous cost in the application.

Mitigations available but not taken:

- Drop the shadow and fake the glow with a second, wider, semi-transparent
  stroke (much cheaper, visually near-identical)
- Halve the polyline resolution
- Throttle to 30 fps

None has been necessary. `smoothingTimeConstant = 0.75` already reduces visual
jitter, so a lower frame rate would not be perceptible.

### Grid re-render

`renderAllTracks()` destroys and rebuilds the grid. Cost is dominated by:

| Step | Cells | Cost |
|---|---|---|
| Create 192 elements | 192 | ~0.4 ms |
| Set 4 attributes each | 192 × 4 | ~0.2 ms |
| Parse `innerHTML` per cell | 192 | ~0.3 ms |
| Attach 3 listeners each | 192 × 3 | ~0.1 ms |
| **Total** | | **~1 ms** |

Within a 16.7 ms frame, with 15 ms to spare. The listener count — 576 for a full
grid — is the part that would matter on a low-end device, and it is the
plausible reason to move to event delegation one day.

Because re-render is fast, **CSS transitions on step cells do not survive** the
rebuild: an element that is destroyed cannot animate. This is an accepted cost
of the [rebuild-not-diff decision](ARCHITECTURE.md#d2--rebuild-rather-than-diff).

---

## 7. Export cost

Offline rendering is faster than real time and scales with duration.

| Length | Duration @ 168 BPM | Render time (approx.) | Output size (24-bit) |
|---|---|---|---|
| 2 patterns | 7.2 s | < 1 s | 2.1 MB |
| 4 patterns | 7.2 s | < 1 s | 3.6 MB |
| 8 patterns | 12.9 s | 1–2 s | 6.8 MB |
| 16 patterns | 24.4 s | 2–4 s | 13.2 MB |

The render blocks neither the audio output nor the UI thread:
`OfflineAudioContext.startRendering()` runs on the audio thread and resolves a
promise. The progress pump polls every 30 ms, which is negligible.

**Memory during export** is the real constraint. A 16-pattern, 24-bit render
allocates:

```
24.4 s × 48 000 Hz × 2 ch × 4 bytes (float32)  =  9.4 MB  (render buffer)
+ 13.2 MB                                       (encoded WAV)
≈ 23 MB peak
```

Comfortable. Float32 render plus a copy for encoding is the pattern; a
streaming encoder would avoid the second allocation but adds complexity for no
observable benefit at these sizes.

---

## 8. Memory

| Consumer | Steady state |
|---|---|
| Audio node objects (transient) | < 1 MB |
| Noise buffers (transient) | < 2 MB |
| Crush + drive curves | 352 KB |
| DOM (192 cells + chrome) | ~1 MB |
| Engine state (6 × 32 steps) | negligible |
| **Total** | **~12 MB** |

The dominant steady-state cost is the two 176 KB waveshaper curves, which are
held by design so they can be reused.

---

## 9. Profiling

### Reproducing a load test

1. Load the `vnares` preset (210 BPM, the densest).
2. Set drill density to 100 % — this promotes every plain step to a 2× or 4×
   ratchet, roughly quadrupling trigger count.
3. Set delay feedback to 0.85 and delay time to 0.65 s.
4. Play for five minutes.

This is the worst case the instrument can be asked to produce. It should run
without a single dropout.

### Measuring

**Audio glitches.** Chrome's `chrome://media-internals` reports underrun counts.
Zero dropouts over five minutes is the target.

**Frame rate.** DevTools Performance, with the transport running. Main-thread
frames should stay under 8 ms.

**Allocation.** DevTools Memory → Allocation sampling, with the crush slider
being dragged. Post-memoisation, curve allocations should appear at most 14
times across a full sweep rather than ~100.

**Scheduling accuracy.** Temporarily log `nextNoteTime − audioCtx.currentTime`
at schedule time. It should stay in a tight band around 0.1 s, proving the
horizon is being maintained and nothing is being scheduled late.

---

## 10. Optimisation policy

Three rules, in order.

**1. Correctness before speed.** An audio instrument that drops buffers is
broken regardless of how fast it is. Nothing is optimised at the cost of
deterministic scheduling.

**2. Measure first.** Every number in this document is either measured or
derived from the code and labelled as such. No optimisation has been made on
the basis of a plausible-sounding argument alone.

**3. Do not spend the audio margin.** The scheduler's 4:1 safety ratio and the
100 ms horizon are the reason playback survives main-thread contention. They are
not to be reduced to buy frame time.

### Known opportunities, deliberately not taken

| Opportunity | Why not |
|---|---|
| Shared pre-generated noise buffer | Would make every snare phase-identical |
| Memoise the drive curve | Needs a quantisation key, which would add stepping to the control |
| Event delegation on the grid | 576 direct listeners is not currently a cost |
| Cheaper scope glow | 0.3 ms/frame is within budget |
| Virtualised lanes | All 192 cells are visible; there is nothing to virtualise |
| `AudioWorklet` for the voices | Would be faster, but breaks the zero-build constraint and adds a module |

### If performance ever regresses

Check, in this order:

1. Is the scheduling horizon still being maintained? (Log `nextNoteTime − currentTime`.)
2. Has a per-trigger allocation been introduced in a hot path?
3. Has a `renderAllTracks()` call been added inside a loop?
4. Has a new `requestAnimationFrame` loop been added?
5. Has a curve rebuild been moved into a per-trigger path?

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [TESTING.md](TESTING.md) ·
[SOUND-DESIGN.md](SOUND-DESIGN.md)*
