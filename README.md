# VoxTeX

**Speech-to-math input for browser assessments — a client-side-only proof of concept.**

Targets accessibility for students with mobility impairments: dictate a math
expression, hear it read back, confirm hands-free, and get symbolic
correct/incorrect feedback. No backend, no inference APIs — ASR, parsing,
rendering, read-back, and answer checking all run locally in the browser.

## Pipeline

```
mic (MediaRecorder → 16 kHz mono PCM)
  → Whisper tiny.en (Transformers.js, Web Worker, WebGPU with WASM fallback)
  → spoken-math grammar parser (deterministic recursive descent → AST → LaTeX)
  → KaTeX render
  → speech-rule-engine (ClearSpeak) → speechSynthesis read-back
  → "yes / no" voice confirmation through the same ASR stream
  → @cortex-js/compute-engine symbolic equivalence check
```

`2 times the quantity x plus 3 end quantity` is judged **correct** against an
expected answer of `2x+6` — answers are compared symbolically, not textually.

## Repo layout

| Path | What |
|---|---|
| [`packages/spoken-math-parser`](packages/spoken-math-parser/README.md) | The centerpiece: phrase → LaTeX parser. Pure TypeScript, no DOM — reusable by future input lanes (ink, photo OCR). 165 Vitest cases. |
| [`packages/voice-math-input`](packages/voice-math-input) | **The embeddable SDK**: mic → Whisper worker → grammar → LaTeX as one headless package, plus a `<voice-math-input>` Web Component. See [INTEGRATION.md](INTEGRATION.md) for consuming it from webpack/Vite apps or via script tag, and for self-hosting all assets on a private CDN. |
| `apps/web` | Vite + React demo: one assessment-item page with mic button, live transcript, rendered math, spoken read-back, feedback, and a debug panel. Consumes the **built** SDK package, doubling as the reference integration. |

## Run it

```bash
npm install
npm test        # parser unit tests (75 cases)
npm run dev     # http://localhost:5173
npm run build   # production build
```

Requirements: a Chromium-based browser is the happy path (WebGPU). Any browser
with WASM works via the fallback. First click on **Enable voice input**
downloads the Whisper tiny.en weights (~40 MB) from the Hugging Face Hub —
that's a one-time static file download, cached by the browser; inference never
leaves the machine. Everything else (SRE mathmaps, KaTeX fonts) is served from
this origin.

## The ambiguity rule (the important design decision)

*"one over x plus two"* is ambiguous. VoxTeX resolves it deterministically:

- **`over` binds tightly** → `one over x plus two` = ⅟ₓ + 2
- Widen with **`the quantity … end quantity`** → `one over the quantity x plus two` = 1/(x+2)
- Or use **`all over`**, which splits everything said so far → `x plus one all over two` = (x+1)/2

The read-back loop makes the rule self-correcting: the student *hears* which
interpretation was chosen ("the fraction 1 over x, end fraction, plus 2") and
can say "no" to retry. Full precedence table and corollaries:
[packages/spoken-math-parser/README.md](packages/spoken-math-parser/README.md).

## Hands-free flow

1. Press the mic button (keyboard accessible; all status changes announced via
   `aria-live`). Speak: *"two x plus six"*. Recording **auto-stops ~1.5 s after
   you stop talking** (energy-based end-pointing with a calibrated noise floor;
   the button still works as a manual stop, hard cap 30 s).
2. The transcript is parsed and rendered with KaTeX; SRE reads it back and asks
   *"Say yes to submit, or no to try again."*
3. A confirmation window listens through the same Whisper worker, end-pointed
   the same way (stops ~0.9 s after you answer). *yes/confirm/submit* →
   symbolic check + spoken verdict; *no/try again* → dictation restarts
   automatically. Silence or an unclear reply triggers **one spoken re-prompt**,
   then falls back to on-screen Confirm / Try again buttons.

Typed input ("type the spoken phrase") exercises the identical pipeline without
the mic — useful for testing and as another access lane.

## Design notes & limitations (v1)

- **Why not the Web Speech API:** in Chrome it ships audio to Google servers —
  not client-side, and unusable for secure assessments. Whisper-in-worker keeps
  audio on device.
- Whisper sometimes emits symbols (`2x + 3`, `1/2`); the tokenizer accepts both
  words and symbols.
- Vocabulary now covers fraction words, trig, logs, integrals, summations,
  derivatives (including prime notation), ordinal powers ("x to the fourth"),
  and common Greek letters (see parser README). Notable gaps: limits, products,
  multi-letter identifiers.
- Compute Engine grades finite sums and symbolic derivatives (the sample items
  use both), but not definite integrals.
- Definite integrals parse and render, but the Compute Engine reports "unknown"
  when asked to equate them to a closed form, so integrals aren't used in the
  graded sample items.
- End-pointing is a simple RMS-energy VAD (calibrated noise floor) — good
  enough for quiet rooms; a spectral VAD would be the next step.
- `speechSynthesis` voices vary by OS; the math speech text itself is
  deterministic (SRE ClearSpeak, with the parser's own read-back as fallback).
