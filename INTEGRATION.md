# Integrating VoxTeX voice input

`@voxtex/voice-math-input` turns speech into LaTeX, entirely in the user's
browser:

```
microphone → Whisper ASR (Web Worker, WebGPU → WASM fallback)
           → deterministic spoken-math grammar
           → LaTeX string (+ AST, transcript, read-back speech text)
```

Your app receives a `DictationResult` and does whatever it wants with
`result.latex` — insert it into an equation editor, grade it, render it with
KaTeX/MathJax. No servers are involved in inference; the only network traffic
is downloading static assets (model weights), and every one of those downloads
can be pointed at your own CDN.

The package is headless (no UI, no framework dependency) with an optional
`<voice-math-input>` Web Component for drop-in use.

- Package source: [`packages/voice-math-input`](packages/voice-math-input)
- Grammar/vocabulary reference: [`packages/spoken-math-parser/README.md`](packages/spoken-math-parser/README.md)
- Working consumer example: [`apps/web`](apps/web) (the demo app uses the built package)

Verified against: webpack 5.108 (zero-config), Vite 8, Chrome (WebGPU + WASM
fallback).

---

## 1. Bundled apps (webpack 5, Vite, Rollup)

### Install

From your registry once published, or directly from a tarball/git while private:

```bash
npm install @voxtex/voice-math-input
# or: npm install ./text2math-voice-math-input-0.1.0.tgz   (npm pack output)
```

No loaders or plugins are needed. The SDK's ASR worker is referenced with the
standard `new Worker(new URL('./asr-worker.js', import.meta.url))` pattern,
which webpack 5, Vite, and Rollup all detect and emit automatically. This is
verified working with a **default webpack config** — no `worker-loader`, no
`asset/resource` rules.

### Minimal integration

```js
import { createVoiceMathInput, VoiceMathError } from '@voxtex/voice-math-input';

const session = createVoiceMathInput();

// 1. Load the model (once — subsequent loads resolve instantly).
//    ~40 MB on first use, then served from the browser cache.
await session.load((p) => {
  progressBar.textContent = `Downloading ${p.file} — ${Math.round(p.progress)}%`;
});

// 2. One hands-free dictation: records, auto-stops when the speaker pauses,
//    transcribes, parses. This is usually all you need.
micButton.onclick = async () => {
  try {
    const result = await session.dictateOnce();
    equationField.value = result.latex;          // "\frac{1}{x}+2"
    console.log(result.transcript);              // "one over x plus two"
    console.log(result.speech);                  // unambiguous read-back text
  } catch (err) {
    if (err instanceof VoiceMathError) {
      // err.code: 'no-speech' | 'parse-error' | 'mic-unavailable' | ...
      // For 'parse-error', err.transcript holds what the ASR heard.
      showStatus(err.message);
    }
  }
};
```

### Typed input with the same grammar

```js
const result = await session.parseText('two times the quantity x plus three');
// result.latex === '2\\times \\left(x+3\\right)'
```

`parseSpokenMath` / `tryParseSpokenMath` are also re-exported for pure,
synchronous parsing with no session at all.

### Full hands-free loop (dictate → spoken read-back → voice yes/no)

```js
const outcome = await session.dictateWithConfirmation();
if (outcome.confirmed) submitAnswer(outcome.result.latex);
// outcome.reply is 'unclear' or 'silence' when the loop gave up —
// fall back to on-screen Confirm/Retry buttons in that case.
```

Or build your own loop from the primitives: `dictateOnce()`, `speak(text)`,
`listenYesNo()`, `stop()`, `cancel()`. The demo app
([`apps/web/src/App.tsx`](apps/web/src/App.tsx)) does exactly that.

### React

No wrapper is required — create the session once and drive your state from
its events:

```tsx
const sessionRef = useRef<VoiceMathInputSession | null>(null);
function getSession() {
  if (!sessionRef.current) {
    sessionRef.current = createVoiceMathInput();
    sessionRef.current.on('status', setSessionStatus); // drives your UI
  }
  return sessionRef.current;
}
useEffect(() => () => sessionRef.current?.dispose(), []);
```

### webpack note: the WASM fallback binary

The worker itself is bundled automatically. The onnxruntime `.wasm` binary
(used **only** when WebGPU is unavailable) ships in the package as
`dist/assets/*.wasm`, and webpack does not follow references from inside an
emitted worker asset. Pick one:

- Set `assets.wasmBaseUrl` to a URL you host (recommended — see §3), or
- copy `node_modules/@voxtex/voice-math-input/dist/assets/` into your build
  output (e.g. CopyWebpackPlugin).

WebGPU browsers (Chrome/Edge on any recent hardware) never fetch it. Vite
consumers are unaffected in dev; apply the same choice for production builds.

---

## 2. Web Component (script tag, no bundler)

Host the package's `dist/` folder on your CDN (keep the folder structure —
files reference each other relatively), then:

```html
<script type="module" src="https://cdn.example.com/voice-math-input/element.js"></script>

<voice-math-input
  label="Speak your answer"
  model-base-url="https://cdn.example.com/models"
  wasm-base-url="https://cdn.example.com/onnx/"
></voice-math-input>

<script>
  const vmi = document.querySelector('voice-math-input');
  vmi.addEventListener('mathinput', (e) => {
    submitAnswer(e.detail.latex);   // DictationResult in e.detail
  });
  vmi.addEventListener('matherror', (e) => console.warn(e.detail.code, e.detail.message));
</script>
```

First click loads the model (progress shown in the element's status text);
subsequent clicks dictate. Clicking while recording stops early.

| Attribute | Meaning |
|---|---|
| `label` | Button text (default "Speak math") |
| `model` | ASR model id (default `onnx-community/whisper-tiny.en`) |
| `device` | `auto` (default) \| `webgpu` \| `wasm` |
| `model-base-url` | Self-hosted model files (§3) |
| `wasm-base-url` | Self-hosted onnxruntime wasm (§3) |
| `readback` | `builtin` (default) \| `off` |
| `confirm` | When present, runs the voice yes/no loop; `e.detail.confirmed` is set |

Events (`bubbles`, `composed`): `mathinput`, `matherror`
(`{code, message, transcript?}`), `mathstatus` (`{status}`). Style via
`::part(button)` and `::part(status)`.

---

## 3. Self-hosting every asset on your CDN

What the SDK fetches at runtime, and how to redirect each piece:

| Asset | Default source | Fetched when | Redirect with |
|---|---|---|---|
| ASR worker (`asr-worker.js`) | bundled by your bundler / your `dist` hosting | model load | `workerUrl` option (rarely needed) |
| Whisper model files (~40 MB) | Hugging Face Hub, browser-cached after first load | first model load | `assets.modelBaseUrl` |
| onnxruntime `.wasm` (~24 MB) | package `dist/assets/` | WASM fallback only | `assets.wasmBaseUrl` |
| SRE mathmaps JSON | — (opt-in tier) | first read-back, SRE tier only | `mathmapsUrl` in `createSreReadback` |

### Model files

Mirror the model repository's file tree under a folder named after the model
id. transformers.js requests individual files; you don't need to know the
exact list — copy everything from the repo (it's small apart from the `.onnx`
files):

```
https://cdn.example.com/models/
  onnx-community/whisper-tiny.en/
    config.json
    generation_config.json
    preprocessor_config.json
    tokenizer.json
    tokenizer_config.json
    onnx/
      encoder_model.onnx          (WebGPU path, fp32)
      decoder_model_merged.onnx
      encoder_model_quantized.onnx    (WASM path, q8)
      decoder_model_merged_quantized.onnx
```

Download once with `git clone https://huggingface.co/onnx-community/whisper-tiny.en`
(or the Hub's file browser) and upload to your CDN. Then:

```js
const session = createVoiceMathInput({
  assets: {
    modelBaseUrl: 'https://cdn.example.com/models',
    wasmBaseUrl: 'https://cdn.example.com/onnx/',   // trailing slash
  },
});
```

With `modelBaseUrl` set, the SDK never contacts huggingface.co
(`allowRemoteModels` is disabled internally).

### onnxruntime wasm

Copy `node_modules/@voxtex/voice-math-input/dist/assets/*.wasm` to
`https://cdn.example.com/onnx/` and pass `wasmBaseUrl` as above.

### SRE mathmaps (only if you use the SRE read-back tier)

Copy `node_modules/speech-rule-engine/lib/mathmaps` to
`https://cdn.example.com/sre/mathmaps` and pass that URL to
`createSreReadback` (§5).

### CORS

Serve all of the above with `Access-Control-Allow-Origin` covering your app's
origin — they're fetched with plain `fetch()` from the page/worker.

---

## 4. API reference

### `createVoiceMathInput(options?) → VoiceMathInputSession`

| Option | Default | Meaning |
|---|---|---|
| `model` | `onnx-community/whisper-tiny.en` | ASR model id |
| `fallbackModel` | `Xenova/whisper-tiny.en` | Tried if the primary fails |
| `device` | `auto` | `auto` tries WebGPU, falls back to WASM |
| `assets.modelBaseUrl` | Hugging Face Hub | §3 |
| `assets.wasmBaseUrl` | bundled | §3 |
| `workerUrl` / `createWorker` | auto | Override worker loading (CSP, CDN) |
| `dictation` | `{maxMs: 30000, silenceMs: 1500, minSpeechMs: 250, noSpeechTimeoutMs: 8000}` | End-pointing for dictation |
| `confirmation` | `{maxMs: 8000, silenceMs: 900, minSpeechMs: 150, noSpeechTimeoutMs: 3500}` | End-pointing for yes/no replies |
| `readback` | `'builtin'` | `'builtin'` \| `false` \| a `ReadbackProvider` (§5) |

### Session

| Member | Behavior |
|---|---|
| `load(onProgress?)` | Downloads/warms the model. Idempotent. Resolves `{backend}` |
| `dictateOnce()` | Record (VAD auto-stop) → transcribe → parse. Resolves `DictationResult` |
| `parseText(text)` | Same grammar + read-back for typed input |
| `listenYesNo()` | Short listen; resolves `{reply: 'yes'\|'no'\|'unclear'\|'silence', transcript}` |
| `dictateWithConfirmation(opts?)` | Full voice loop; resolves `{result, confirmed, reply, attempts}` |
| `speak(text)` / `stopSpeaking()` | speechSynthesis TTS |
| `stop()` | End the current recording early (audio is still transcribed) |
| `cancel()` | Abandon the current recording (`'cancelled'` error) |
| `on('status' \| 'progress', cb)` | UI-state events; returns an unsubscribe function |
| `status`, `backend` | Current `SessionStatus`, `'webgpu' \| 'wasm' \| null` |
| `dispose()` | Terminate the worker, release everything |

`DictationResult`: `{ latex, transcript, speech, ast, tokens, transcribeMs }`.

`VoiceMathError.code`: `mic-unavailable`, `no-speech`, `empty-transcript`,
`parse-error` (with `.transcript`), `model-load-failed`, `not-loaded`, `busy`,
`cancelled`, `transcription-failed`, `disposed`.

Statuses: `idle → loading → ready → recording → transcribing → ready`, plus
`confirm-listening`, `speaking`, `error`, `disposed`.

---

## 5. Read-back tiers

Read-back is the text a student hears to confirm what was parsed.

1. **`'builtin'` (default)** — deterministic English generated from the parse
   tree (mirrors the input vocabulary: *"the fraction 1 over x, end fraction,
   plus 2"*). Zero extra dependencies or assets.
2. **SRE tier** — natural ClearSpeak via speech-rule-engine. Install the
   optional peers (`npm i katex speech-rule-engine`), host the mathmaps (§3):

   ```js
   import { createSreReadback } from '@voxtex/voice-math-input/readback-sre';

   const session = createVoiceMathInput({
     readback: createSreReadback({ mathmapsUrl: 'https://cdn.example.com/sre/mathmaps' }),
   });
   ```

   Falls back to the builtin text automatically if SRE fails to load.
3. **`false`** — `result.speech` still contains the builtin text; do your own TTS.

`session.speak(text)` pipes any of these to `speechSynthesis`.

---

## 6. Browser requirements, permissions, CSP

- **Secure context required**: `getUserMedia` works only on HTTPS or
  localhost.
- **User gesture**: call `dictateOnce()` from a click/keypress handler the
  first time, or the mic prompt (and speechSynthesis) may be blocked.
- **Iframes**: embedding page must grant `<iframe allow="microphone">`.
- **WebGPU**: used when available (Chrome/Edge); otherwise WASM. Transcription
  is ~1.5 s/utterance on WebGPU with tiny.en; noticeably slower on WASM.
- **Model caching**: transformers.js caches weights in browser storage — the
  40 MB download happens once per origin.
- **CSP**: allow `worker-src 'self'` (plus your CDN origin if using
  `workerUrl`), `connect-src` for your model/wasm hosts, and
  `'wasm-unsafe-eval'` in `script-src` for the WASM fallback path.
- SSR: import the SDK only in browser code — it touches `navigator`/`Worker`
  at call time, not import time, but there is nothing useful to do server-side.

---

## 7. What the grammar accepts

Numbers, fraction words, variables (a–z, Greek), `plus or minus`, fractions
(`over` / `all over`), powers (incl. ordinals: "x to the fourth"), roots, trig,
logs, integrals, summations, derivatives (incl. `f prime of x`), absolute
value, percent, relations, and grouping via `open paren` / `the quantity … end
quantity`. Full vocabulary, precedence rules, and the documented ambiguity
policy ("`over` binds tightly"):
[`packages/spoken-math-parser/README.md`](packages/spoken-math-parser/README.md).

Flagship example — the quadratic formula:

> *"x equals negative b plus or minus the square root of the quantity b squared
> minus four a c end quantity all over two a"*

→ `x=\frac{-b\pm \sqrt{b^{2}-4ac}}{2a}`

Unrecognized words raise `parse-error` with the offending word — nothing is
silently dropped, which is what you want in an assessment setting.
