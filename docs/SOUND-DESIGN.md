# Sound Design

**Form 909-WARP** — voice-by-voice DSP reference

Every sound in Form 909-WARP is synthesised at runtime from Web Audio
primitives. There are no samples: each trigger builds a short-lived node graph,
schedules its envelopes against the audio clock, and is garbage collected after
it stops. This document is the reference for what each voice actually does.

---

## Contents

1. [Synthesis philosophy](#1-synthesis-philosophy)
2. [Common contract](#2-common-contract)
3. [Voice 0 — Kick](#3-voice-0--kick)
4. [Voice 1 — Snare](#4-voice-1--snare)
5. [Voice 2 — Hat](#5-voice-2--hat)
6. [Voice 3 — Perc](#6-voice-3--perc)
7. [Voice 4 — Glitch](#7-voice-4--glitch)
8. [Voice 5 — Sub](#8-voice-5--sub)
9. [Master bus processing](#9-master-bus-processing)
10. [Envelope conventions](#10-envelope-conventions)
11. [Level staging and headroom](#11-level-staging-and-headroom)
12. [Modifying a voice](#12-modifying-a-voice)

---

## 1. Synthesis philosophy

Three rules govern every voice.

**Every voice is a transient.** The longest is 0.4 s; the shortest is 0.04 s.
Nothing sustains. This bounds polyphony cost and suits material built from
micro-events rather than pads.

**Every voice is built per trigger.** Web Audio nodes are one-shot objects;
`osc.stop()` schedules their release and the runtime reclaims them. Pooling
would add lifetime state for no measurable gain at these trigger rates.

**Every voice is context-agnostic.** The signature is
`(ctx, dest, time, vel, pitchShift)`. Live playback passes the `AudioContext`;
the bounce passes an `OfflineAudioContext`. A generator cannot tell the
difference and must not try to.

---

## 2. Common contract

```js
synthVoice(ctx, dest, time, vel, pitchShift)
```

| Parameter | Range | Meaning |
|---|---|---|
| `time` | seconds, absolute | Start time on the destination context's clock |
| `vel` | 0.0 – 1.0 | `step.vel / 127` |
| `pitchShift` | 0.25 – 4.0 | `Math.pow(2, step.pitchOffset / 12)`, i.e. ±24 semitones |

**Pitch locking multiplies the voice's base frequency.** All pitched elements
scale; fixed elements (the hat's highpass at 6.8 kHz, the glitch's randomised
bandpass) do not. That is what makes an extreme pitch lock sound like a
different instrument rather than a resampling.

**Velocity scales amplitude and, where relevant, modulator depth.** It never
changes timbre — a quiet hit is the same instrument, not a filtered one. The
exception is the glitch voice, whose timbre is randomised on every trigger by
design.

---

## 3. Voice 0 — Kick

`KICK / TRANSIENT FM` · `FM SUB-PUNCH` · `synthKick()`

A three-part construction: a pitch-swept sine body, an FM click transient, and
an exponentially decayed noise beater.

```
                        ┌──────────────┐
   oscMod (triangle) ──▶│  modGain     │──▶ osc.frequency   [FM]
   320·ps → 30 Hz       │ 350·vel→0.01 │
                        └──────────────┘
                                             ┌──────────┐
   osc (sine) ──────────────────────────────▶│  gain    │──▶ dest
   54·ps ×5.2 → ×1.5 → ×0.75                │ 1.1·vel  │
                                             │  →0.0001 │
   click (noise buffer, 8 ms) ──▶ clickGain ─┤  0.6·vel │
   (rand·2−1)·e^(−i/80)            →0 @8ms   └──────────┘
```

| Parameter | Value |
|---|---|
| Base frequency | `54 × pitchShift` Hz |
| Body pitch envelope | `×5.2` → `×1.5` over 35 ms → `×0.75` over 320 ms (exponential) |
| FM modulator | Triangle, `320 × pitchShift` → 30 Hz over 40 ms |
| FM index envelope | `350 × vel` → 0.01 over 45 ms |
| Noise transient | 8 ms buffer, `(random×2−1) × e^(−i/80)`, gain `0.6 × vel` → 0 |
| Amplitude envelope | `1.1 × vel` → 0.0001 over 380 ms |
| Total duration | 400 ms |

**Design notes.** The `×5.2` start is what gives the kick its beater: the body
begins near 280 Hz and collapses into the sub region within 35 ms, so the ear
hears an attack and then a fundamental. The FM click decays in 45 ms, well
before the body settles, so it reads as impact rather than as part of the tone.

**Pitch lock behaviour.** Everything scales, including the FM modulator. At
−24 semitones the kick becomes a 13.5 Hz sub thump; at +24 it becomes a tight
110 Hz tom.

---

## 4. Voice 1 — Snare

`SNARE / METALLIC WIRE` · `DUAL RES-NOISE` · `synthSnare()`

Two layers through a shared mix bus: a pitched triangle body and bandpassed
white noise.

```
   osc (triangle) ──▶ oscGain ──┐
   185·ps ×1.9 → ×1.0 @70ms     │
                                ├──▶ mix (0.9) ──▶ dest
   noise (220 ms white) ──▶ BPF ──▶ noiseGain ──┘
                            3200·ps, Q 2.4
```

| Parameter | Value |
|---|---|
| Body frequency | `185 × pitchShift` Hz, triangle |
| Body pitch envelope | `×1.9` → `×1.0` over 70 ms |
| Body amplitude | `0.6 × vel` → 0.001 over 160 ms |
| Noise source | 220 ms of white noise, `(random × 2 − 1)` |
| Noise filter | Bandpass, `3200 × pitchShift` Hz, Q 2.4 |
| Noise amplitude | `0.9 × vel` → 0.001 over 220 ms |
| Mix gain | 0.9 |
| Total duration | 230 ms |

**Design notes.** Q 2.4 is deliberately moderate. A high-Q bandpass on noise
rings like a tom; 2.4 gives a broad, wiry band centred on the presence region
that survives heavy bit-crush and delay. The body's 1.9× pitch drop is short
enough (70 ms) to read as snap rather than as a pitched note.

**Why white noise is generated fresh each time.** A 220 ms buffer at 48 kHz is
10 560 samples. Generating it costs roughly 0.1 ms and avoids both a
pre-rendered asset (which would break the no-samples rule) and a looping source
(which would make repeated hits phase-identical).

---

## 5. Voice 2 — Hat

`HAT / REZ MICROSPLICE` · `METALLIC 6-OP` · `synthHat()`

Six square oscillators at inharmonic ratios, summed and highpassed.

```
   ┌─ osc ×2 ─────┐
   ├─ osc ×3.01 ──┤
   ├─ osc ×4.15 ──┼──▶ hatMix ──▶ HPF (6800 Hz) ──▶ env ──▶ dest
   ├─ osc ×5.4 ───┤                                 0.4·vel
   ├─ osc ×6.8 ───┤                                 →0.0001 @65 ms
   └─ osc ×8.2 ───┘
```

| Parameter | Value |
|---|---|
| Fundamental | `420 × pitchShift` Hz |
| Ratios | `[2, 3.01, 4.15, 5.4, 6.8, 8.2]` — six square oscillators |
| Highpass | 6 800 Hz, fixed (not pitch-shifted) |
| Amplitude envelope | `0.4 × vel` → 0.0001 over 65 ms |
| Total duration | 70 ms |

**Design notes.** The ratios are inharmonic and non-integer on purpose. Six
*harmonic* squares would sum to a brighter square; six inharmonic ones produce
a dense, clangorous partial stack — the metallic character of a real 808 hat,
which is a bank of detuned square waves rather than filtered noise.

The highpass is deliberately **not** pitch-shifted. It is a fixed timbral gate,
so a pitch-locked hat loses body but keeps its top-end character instead of
disappearing.

**CPU note.** This is the most expensive voice: six oscillators per trigger. At
4× ratchets and 210 BPM a dense hat lane can fire roughly 50 oscillators per
second. Measured cost is well within budget; see
[PERFORMANCE.md](PERFORMANCE.md).

---

## 6. Voice 3 — Perc

`CONK / MODULAR CLANG` · `RING MOD FM` · `synthPerc()`

Two-operator FM with a sawtooth modulator at a non-integer ratio and a
downward carrier sweep.

```
   modulator (sawtooth) ──▶ modGain ──▶ carrier.frequency
   cFreq × 2.87            700·vel → 1       │
                              @110 ms        │
                                             ▼
   carrier (sine) ──────────────────────▶ amp ──▶ dest
   cFreq → cFreq × 0.45 @120 ms           0.7·vel
                                          →0.0001 @140 ms
```

| Parameter | Value |
|---|---|
| Carrier | Sine, `440 × pitchShift` Hz → `×0.45` over 120 ms |
| Modulator | Sawtooth, `cFreq × 2.87` |
| FM index envelope | `700 × vel` → 1 over 110 ms |
| Amplitude envelope | `0.7 × vel` → 0.0001 over 140 ms |
| Total duration | 150 ms |

**Design notes.** The modulator ratio of 2.87 is the entire character of this
voice. An integer ratio produces harmonic, bell-like FM; 2.87 produces a dense
inharmonic sideband cluster that reads as struck metal. The high initial index
(700) collapses to 1 within 110 ms, so the sound is bright and clangorous at
the attack and settles to a nearly clean sine as it decays.

The carrier's simultaneous downward sweep — to 45 % of its starting frequency —
adds the "conk": a pitch drop that makes it sit in a drum pattern rather than
in a melodic one.

---

## 7. Voice 4 — Glitch

`GLITCH / BIT SHREDDER` · `NOISE BURST GRAIN` · `synthGlitch()`

The only non-deterministic voice: waveform, start frequency and filter
frequency are randomised on every trigger.

```
   osc (saw | triangle, random) ──▶ BPF ──▶ gain ──▶ dest
   (random·4000 + 800)·ps → 120 Hz   random·5000+1200
        @35 ms                        Q 8
                                     0.85·vel → 0.0001 @38 ms
```

| Parameter | Value |
|---|---|
| Waveform | `sawtooth` or `triangle`, 50/50 per trigger |
| Start frequency | `(random × 4000 + 800) × pitchShift` Hz |
| Pitch envelope | → 120 Hz over 35 ms (exponential) |
| Filter | Bandpass, `random × 5000 + 1200` Hz, Q 8 |
| Amplitude envelope | `0.85 × vel` → 0.0001 over 38 ms |
| Total duration | 40 ms |

**Design notes.** At 40 ms this is the shortest voice, and its purpose is
texture: a spray of non-repeating micro-grains. Randomising three parameters
per trigger means no two hits are identical, which is what makes a dense glitch
lane sound like granular material rather than like a machine gun.

Q 8 on a bandpass produces a resonant, almost pitched shriek out of
noise-like content; combined with the 35 ms pitch collapse it produces the
classic "bit shred" zip.

**Reproducibility.** During a bounce the randomness is drawn from the seeded
stream rather than `Math.random()`, so a glitch lane *is* reproducible for a
given seed — but its content is a function of the seed, not only of the pattern.

---

## 8. Voice 5 — Sub

`ACID SUB / HARMONIC SINK` · `SQUARE SQUELCH` · `synthSub()`

A sawtooth through an enveloped resonant lowpass — the 303-derived acid voice.

```
   osc (sawtooth) ──▶ LPF ──▶ gain ──▶ dest
   55·ps            base×8 → base×1.5   0.8·vel
                    @220 ms, Q 5.5      →0.001 @280 ms
```

| Parameter | Value |
|---|---|
| Oscillator | Sawtooth, `55 × pitchShift` Hz |
| Filter | Lowpass, `base × 8` → `base × 1.5` over 220 ms |
| Filter Q | 5.5 |
| Amplitude envelope | `0.8 × vel` → 0.001 over 280 ms |
| Total duration | 300 ms |

**Design notes.** The resonant filter sweep is the whole effect. Q 5.5 puts a
pronounced peak at the cutoff, and sweeping the cutoff from 8× the fundamental
down to 1.5× sweeps that peak down through the harmonic series — the squelch.
Amplitude decays more slowly than the filter (280 ms vs 220 ms), so the tail
darkens as it fades rather than cutting off.

At 55 Hz this is a genuinely sub-bass voice. Pitch locks of −12 or −24 push it
to 27.5 Hz or 13.75 Hz, below the audible fundamental but still felt, and still
generating audible harmonics through the master drive stage.

---

## 9. Master bus processing

All six voices sum into `busIn` and pass through the chain described in
[ARCHITECTURE.md §8](ARCHITECTURE.md#8-the-master-bus). Two stages are worth
expanding on here.

### Bit crush — amplitude quantisation

```js
bits   = clamp(round(16 − amount × 13), 3, 16)
levels = 2^bits / 2
curve[i] = round(x × levels) / levels      // x ∈ [−1, 1]
```

This is a transfer-curve quantiser, not a sample-rate reducer. It snaps
amplitude to the nearest of `2^bits` levels, introducing quantisation
distortion correlated with the signal — the characteristic grit. Time
resolution is preserved.

The curve is memoised on bit depth. Dragging the slider sweeps 101 values but
produces only 14 distinct curves, so roughly 86 % of the 176 KB allocations are
avoided.

| `fx.crush` | Effective bits | Character |
|---|---|---|
| 0.00 | 16 | Transparent |
| 0.15 | 14 | Faint grain on quiet material |
| 0.30 | 12 | Audible crunch |
| 0.50 | 9 | Lo-fi, clearly degraded |
| 1.00 | 3 | Extreme; mostly distortion |

`oversample` is `'none'`, deliberately: the aliasing is the effect.

### Drive — soft saturation

```js
k = amount × 40
curve[i] = ((3 + k) × x × 20 × deg) / (π + k × |x|)
```

The classic arctangent-style soft clipper. As `k` rises the transfer function
bends earlier, so more of the signal's range is compressed and more harmonic
content is generated. `oversample` is `'4x'` so those harmonics do not alias
back into the audible band — the opposite choice from the crush stage, for the
opposite reason.

### Limiter

A `DynamicsCompressor` configured as a brickwall:

| Parameter | Value |
|---|---|
| Threshold | −3.5 dB |
| Knee | 6 dB |
| Ratio | 12:1 |
| Attack | 3 ms |
| Release | 80 ms |

The 3 ms attack is fast enough to catch kick transients rather than letting them
through, which flattens the master slightly in exchange for predictable
headroom. With the delay feedback loop in front of it, this is what stops a
0.85 feedback setting from building into runaway gain.

---

## 10. Envelope conventions

Three rules apply throughout, for both musical and technical reasons.

**Exponential ramps, never to zero.** `exponentialRampToValueAtTime` requires a
strictly positive target, so every decay ends at 0.001 or 0.0001 rather than 0.
Ending at a small positive value is inaudible and avoids an exception that
would silence the voice.

**Amplitude envelopes are exponential; short clicks use linear.** Exponential
decay matches how struck objects behave. The 8 ms kick transient uses
`linearRampToValueAtTime` because at that duration the difference is inaudible
and a linear ramp is marginally cheaper.

**Envelope times are absolute, never tempo-relative.** The consequence is
intentional: at 210 BPM voices overlap more and the material becomes denser and
more smeared; at 128 BPM it becomes sparse and separated. Tempo changes the
texture, which is a feature of this idiom.

---

## 11. Level staging and headroom

```
voice gain ≈ 0.7 – 1.1     (velocity-scaled, summed across 6 voices)
    │
    ├──▶ busIn                                   ← six voices can coincide
    │
    ├──▶ crush         no gain change (quantisation adds energy)
    ├──▶ filter        resonant Q 1.8 can boost near cutoff
    ├──▶ drive         adds harmonic energy
    ├──▶ delay wet     0.28, plus feedback up to 0.85
    │
    ├──▶ limiter       −3.5 dB, 12:1
    ├──▶ masterGain    0.88
    │
    └──▶ destination
```

The 0.88 master trim exists because a six-voice coincidence — a step where
every lane fires at velocity 127 — sums to well above unity before the limiter.
The trim plus the limiter keep the worst case near −1 dBFS, with the distortion
character coming from the drive stage rather than from digital clipping.

---

## 12. Modifying a voice

Voices are pure functions of their parameters, which makes them the safest
place to experiment. Before changing one:

1. **Understand what the presets depend on.** All 21 are authored against
   these timbres; a change to `synthKick` changes every preset's low end.
2. **Check the duration.** If a voice runs longer than one step at high BPM,
   successive triggers overlap. At 210 BPM a step is 71 ms, so the 400 ms kick
   already spans five or six steps — intentional, but worth knowing.
3. **Keep the signature.** `(ctx, dest, time, vel, pitchShift)`. Adding a
   parameter means changing both call sites and both contexts.
4. **Never read global state.** A generator that reads `bureau.fx` directly
   will desynchronise the bounce.
5. **Respect exponential ramp targets.** Non-positive targets throw.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the review path that applies to
sonic changes.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) ·
[PERFORMANCE.md](PERFORMANCE.md)*
