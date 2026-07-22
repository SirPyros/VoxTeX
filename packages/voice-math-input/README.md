# @voxtex/voice-math-input

Speech → LaTeX, entirely in the browser. On-device Whisper ASR (WebGPU with
WASM fallback, in a bundled Web Worker) feeding a deterministic spoken-math
grammar. No servers; every remote asset (model weights, wasm) can be
self-hosted on your own CDN.

```js
import { createVoiceMathInput } from '@voxtex/voice-math-input';

const session = createVoiceMathInput();
await session.load((p) => console.log(p.file, p.progress));

const { latex, transcript, speech } = await session.dictateOnce();
// latex: "\frac{-b\pm \sqrt{b^{2}-4ac}}{2a}"  — auto-stops when you pause
```

- **Headless core** — you own the UI; the session exposes promises + status
  events (`dictateOnce`, `dictateWithConfirmation`, `listenYesNo`, `speak`).
- **`<voice-math-input>` Web Component** via `@voxtex/voice-math-input/element`
  for script-tag/no-bundler integration — listen for the `mathinput` event.
- **Typed-input parity** — `session.parseText()` and the re-exported parser
  (`parseSpokenMath`) run the identical grammar.
- **Spoken read-back** for hands-free confirmation: built-in deterministic
  English, or ClearSpeak via the optional `/readback-sre` tier.
- **Opt-in local personalization** — learned per-user mishearing corrections
  (constrained so valid math can never be rewritten) and persisted mic
  calibration, stored in the browser with inspect/export/clear APIs.
- Works with a default **webpack 5** or Vite config — the self-contained ASR
  worker is emitted automatically via the standard `new URL` pattern.

Full integration guide (bundlers, CDN self-hosting, API reference, CSP,
grammar):
**[INTEGRATION.md](https://github.com/SirPyros/VoxTeX/blob/main/INTEGRATION.md)**
· Live demo: **https://sirpyros.github.io/VoxTeX/**

Browser requirements: secure context (HTTPS/localhost) for the microphone;
WebGPU used when available, WASM otherwise. First load downloads
whisper-tiny.en (~40 MB, browser-cached; self-hostable via
`assets.modelBaseUrl`).

