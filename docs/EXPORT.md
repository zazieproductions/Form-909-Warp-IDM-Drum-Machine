# Offline Export

**Form 909-WARP** — how a bounce is rendered, and why it is reproducible.

---

## Contents

1. [Overview](#1-overview)
2. [The render pipeline](#2-the-render-pipeline)
3. [Parity with live playback](#3-parity-with-live-playback)
4. [Determinism and seeding](#4-determinism-and-seeding)
5. [Progress reporting](#5-progress-reporting)
6. [WAV byte layout](#6-wav-byte-layout)
7. [Why 24-bit](#7-why-24-bit)
8. [File naming](#8-file-naming)
9. [Failure modes](#9-failure-modes)
10. [Limitations](#10-limitations)

---

## 1. Overview

Export renders the current pattern through an `OfflineAudioContext` — faster
than real time, on a separate graph, with no dependency on the audio hardware
or on how long the render takes.

```js
const result = await bureau.exportWav(4, setProgress, { bitDepth: 24 });
// → { blob, seed, duration, sampleRate, bitDepth }
```

| Property | Value |
|---|---|
| Render engine | `OfflineAudioContext(2, frames, 48000)` |
| Channels | 2 (the graph is mono-summed; both channels carry the same signal) |
| Sample rate | 48 000 Hz |
| Bit depth | 24-bit (16-bit selectable) |
| Format | RIFF/WAVE, uncompressed PCM |
| Lengths | 2, 4, 8 or 16 patterns |
| Tail | 1.5 s appended so delay feedback rings out |

### Live session recording

**RECORD LIVE** is separate from the offline bounce. It captures the actual
real-time performance—including edits, mutation, probability, synthesis and
master effects—from the post-effects `AnalyserNode` into a
`MediaStreamAudioDestinationNode`. No microphone permission is requested and
no external input is captured. If the sequencer is idle, recording starts it;
press **STOP + SAVE** to flush and download the take. A take started over an
already-running transport leaves playback running when capture stops.

The `MediaRecorder` codec/container depends on browser support: WebM/Opus is
common, while some browsers offer Ogg/Opus or MP4/AAC. The downloaded extension
matches the selected container (`.webm`, `.ogg` or `.m4a`). These are
real-time, typically compressed audio files—not WAV. Use **EXPORT 24-BIT WAV**
when you need a deterministic, uncompressed offline render.

---

## 2. The render pipeline

```
┌─ 1. Compute duration ────────────────────────────────────────────────┐
│    duration = (60 / bpm) × (numBars × 4) + 1.5                       │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌─ 2. Build the offline graph ─────────────────────────────────────────┐
│    offBus → offCrush → offFilter → offDrive → offLimiter             │
│                          └──→ offDelay ⇄ offDelayFb                  │
│                                    └──→ offDelayWet → offDrive       │
│    offLimiter → offMaster(0.88) → destination                        │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌─ 3. Copy every parameter from this.fx ───────────────────────────────┐
│    crush · drive · cutoff(Q 1.8) · delayTime · delayFeedback         │
│    limiter (−3.5 dB, knee 6, ratio 12, attack 3 ms, release 80 ms)   │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌─ 4. Schedule every step with a seeded PRNG ──────────────────────────┐
│    swing → probability gate → ratchet expansion → jitter → voices    │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌─ 5. Render with 10 suspend() checkpoints ────────────────────────────┐
│    each parks the context; we advance the bar and resume()           │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌─ 6. Encode ──────────────────────────────────────────────────────────┐
│    bufferToWaveBlob(renderedBuffer, 24) → Blob                       │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌─ 7. Trigger download ────────────────────────────────────────────────┐
│    object URL → <a download> → click → revoke                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Parity with live playback

The single most important property of the export path is that it sounds like
what you heard. Every stochastic and processing step in the live path is
replicated.

| Live behaviour | Exported | Where |
|---|---|---|
| Swing on odd steps | ✅ | `swingOffset` computed identically |
| Ratchet expansion | ✅ | `subDur = stepDur / ratchets` |
| Ratchet velocity decay | ✅ | `max(20, vel × (1 − r × 0.12))` |
| Probability gate | ✅ | `rand() * 100 > prob × globalProb` |
| Drill injection | ✅ | Promotes 1× steps at `globalRatchet × 0.4` |
| Humanise jitter | ✅ | `(rand() − 0.5) × humanize/1000` |
| Jitter clamp | ✅ | `max(stepTime, …)` |
| Mute / solo | ✅ | `anySolo = tracks.some(t => t.solo)` |
| Bit crush | ✅ | `offCrush`, `oversample: 'none'` |
| Filter | ✅ | `lowpass`, cutoff, Q 1.8 |
| Drive | ✅ | `oversample: '4x'` |
| Delay time / feedback / wet | ✅ | 0.28 wet gain |
| Limiter | ✅ | Full parameter set, including attack and release |
| Master trim | ✅ | `offMaster` at 0.88 |

> **History.** In v1.0 the offline path omitted humanise jitter, the
> probability gate, drill injection, the crush stage, the master trim and the
> limiter's attack/release settings. A bounce was audibly a different
> performance — cleaner, denser and roughly 1.1 dB hotter than what the user
> had been monitoring. All were restored in v1.1. See the
> [changelog](../CHANGELOG.md).

### The two that differ, deliberately

**Randomness source.** Live uses `Math.random()`; export uses
`mulberry32(seed)`. Same distribution, different stream. See §4.

**The analyser.** The live graph ends at an `AnalyserNode` for the vector
scope. The offline graph does not need one and does not create one. This has no
effect on the audio: `AnalyserNode` is a pass-through.

---

## 4. Determinism and seeding

### Why

Live playback should never be identical twice — that is the point of
probability, drill injection and a randomised glitch voice. A bounce has the
opposite requirement: it is a deliverable, and re-rendering it must produce
identical bytes. Otherwise a change in the output file cannot be attributed to
a change in the input.

### How

```js
static mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`mulberry32` is a 32-bit PRNG with a 2³² period and good distribution on
standard test batteries. It is seeded per render and the seed is disclosed:

- shown in the export dialog after a successful render
- available on the resolved result object as `result.seed`
- reproducible by passing `{ seed }` in the options

```js
const a = await bureau.exportWav(2, null, { seed: 42 });
const b = await bureau.exportWav(2, null, { seed: 42 });
// a.blob and b.blob are byte-identical
```

If no seed is supplied, one is derived from `Date.now()` combined with
`Math.random()` and then reported, so any render can be reproduced afterwards.

### What is still non-deterministic

Nothing in the audio. Two caveats worth knowing:

- **The filename timestamp** differs per render.
- **Floating-point reproducibility across engines** is not guaranteed to the
  last bit if the underlying Web Audio implementation changes. Byte-identity is
  guaranteed within one browser version, not across them.

---

## 5. Progress reporting

`OfflineAudioContext` exposes no progress event. Rather than animate a
plausible-looking fake curve, the render schedules ten `suspend()` checkpoints
and reports only what has actually happened.

```js
const CHECKPOINTS = 10;
for (let i = 1; i < CHECKPOINTS; i++) {
  offline.suspend((duration * i) / CHECKPOINTS);
}
```

A pump loop then watches the context:

```js
if (offline.state === 'running')  wasRunning = true;
else if (wasRunning && offline.state === 'suspended') {
  reached++;
  onProgress(5 + (reached / CHECKPOINTS) * 90);
  offline.resume();
}
```

| Detail | Reason |
|---|---|
| `wasRunning` guard | An `OfflineAudioContext` starts in the `suspended` state, so without it the pump would resume before rendering began |
| 120-second deadline | Guarantees the UI cannot hang on a stalled render |
| Degraded fallback | Where `suspend`/`resume` is unsupported, the bar reports 5 % → 50 % → 100 % rather than pretending |
| `onProgress(5)` at start | Confirms the render has begun |

---

## 6. WAV byte layout

A canonical 44-byte RIFF/WAVE header followed by interleaved little-endian PCM.

```
Offset  Size  Field              Value
──────────────────────────────────────────────────────────────────
0x00    4     ChunkID            "RIFF"            0x52494646 LE
0x04    4     ChunkSize          fileLength − 8
0x08    4     Format             "WAVE"            0x57415645 LE
0x0C    4     Subchunk1ID        "fmt "            0x666D7420 LE
0x10    4     Subchunk1Size      16
0x14    2     AudioFormat        1  (WAVE_FORMAT_PCM)
0x16    2     NumChannels        2
0x18    4     SampleRate         48000
0x1C    4     ByteRate           sampleRate × blockAlign
0x20    2     BlockAlign         numChannels × (bitDepth / 8)
0x22    2     BitsPerSample      16 or 24
0x24    4     Subchunk2ID        "data"            0x64617461 LE
0x28    4     Subchunk2Size      numSamples × blockAlign
0x2C    …     Data               interleaved PCM, little-endian
```

### Sample encoding

**24-bit** (default) — three bytes per sample, sign-extended through a 32-bit
intermediate:

```js
const s = Math.max(-1, Math.min(1, channelData[i]));
const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
out.setUint8(pos,     v         & 0xff);
out.setUint8(pos + 1, (v >> 8)  & 0xff);
out.setUint8(pos + 2, (v >> 16) & 0xff);
```

**16-bit** — two bytes per sample:

```js
const s = Math.max(-1, Math.min(1, channelData[i]));
out.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
```

Both clamp before scaling. Clamping matters: the limiter reduces but does not
mathematically guarantee that no sample exceeds unity, and an out-of-range
value would wrap into a loud click.

### File size

```
bytes = 44 + ceil(sampleRate × duration) × channels × (bitDepth / 8)
```

At 48 kHz, 24-bit, 2 channels: **288 KB per second**.

| Length | 4 patterns @ 168 BPM | Size (24-bit) |
|---|---|---|
| 2 patterns | 5.7 s + 1.5 s tail | ≈ 2.1 MB |
| 4 patterns | 5.7 s × 2 + tail | ≈ 3.6 MB |
| 8 patterns | ≈ 12.9 s | ≈ 6.8 MB |
| 16 patterns | ≈ 24.4 s | ≈ 13.2 MB |

---

## 7. Why 24-bit

The render graph is IEEE float32 from end to end. Truncating to 16-bit at the
last step discards roughly 48 dB of resolution, and this material is exactly
the case where that matters: quiet micro-grain detail — the glitch voice at low
velocity, delay tails, the tail of a crush quantiser — sits underneath a loud,
limited master. Ditherless truncation at 16-bit pushes that detail below the
noise floor.

24-bit is also what a mastering engineer expects to receive, and the cost is
three bytes per sample instead of two.

**16-bit remains available** via `{ bitDepth: 16 }` for anyone delivering to a
format that requires it.

### A note on the v1.0 label

Versions before 1.1 advertised "24-bit" in the UI while writing 16-bit PCM.
This was a genuine discrepancy, not a rounding error: the header declared
`BitsPerSample = 16` while the button said 24. Rather than relabel the button
downwards, the encoder was brought up to the advertised specification — the
feature was worth having.

---

## 8. File naming

```
BUREAU_UNREASONABLE_{bpm}BPM_{bitDepth}BIT_{timestamp}.wav
```

Example:

```
BUREAU_UNREASONABLE_168BPM_24BIT_2025-11-14T09-32-07.wav
```

The timestamp is `new Date().toISOString()` with `:` and `.` replaced by `-`
and truncated to 19 characters, which keeps the filename portable across
filesystems that object to colons.

The seed is not in the filename but is shown in the export dialog and available
programmatically. Recording it is worthwhile if a render needs to be
reproduced.

---

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| `OfflineAudioContext` unavailable | `exportWav` throws; the dialog shows the error message |
| `MediaRecorder` unavailable | Live-record button reports that browser capture is unsupported; offline WAV export remains available |
| Live recorder errors | The active state is cleared and the failure is announced in the ticker |
| Render throws mid-way | Caught; button re-enabled, progress reset, message shown |
| `suspend`/`resume` unsupported | Progress degrades to two stages; the render still completes |
| Render stalls | 120-second deadline releases the UI; the promise still resolves or rejects on its own |
| A voice schedules past the buffer end | Web Audio truncates; the 1.5 s tail covers the longest voice (400 ms) plus delay ring-out |

All errors are surfaced in `#exportStatusText` and logged to the console with
the original error object.

---

## 10. Limitations

Known and accepted:

- **Stereo is dual-mono.** The graph is summed to one path; there is no
  panning. Two channels are written so the file drops into a DAW session
  without conversion, but they are identical.
- **No dither.** Truncation at 24-bit inaudibly affects material this dense; at
  16-bit a flat TPDF dither would be a small improvement and is a roadmap item.
- **No metadata chunks.** No Broadcast Wave (`bext`) chunk, so no embedded
  origin or timing information.
- **No normalisation or true peak measurement.** Output level is whatever the
  limiter produces. Peak headroom is set by the 0.88 master trim, not measured.
- **Length is pattern-aligned only.** There is no free-form "render N seconds";
  lengths are 2, 4, 8 or 16 patterns.
- **The tail is fixed at 1.5 s.** With delay feedback at 0.85 and delay time at
  0.65 s, ring-out can outlast the tail and be cut. Lower the feedback if the
  cut is audible.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) ·
[PATTERNS.md](PATTERNS.md) · [PERFORMANCE.md](PERFORMANCE.md)*
