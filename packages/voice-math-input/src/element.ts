// <voice-math-input> — a drop-in Web Component wrapping the SDK.
// Import "@voxtex/voice-math-input/element" (or load dist/element.js from
// a CDN via <script type="module">) and listen for the "mathinput" event.
//
// Attributes:
//   model            ASR model id
//   device           auto | webgpu | wasm
//   model-base-url   self-hosted model files (see AssetOptions)
//   wasm-base-url    self-hosted onnxruntime wasm binaries
//   readback         builtin (default) | off
//   confirm          when present, runs the voice yes/no confirmation loop
//   label            button label (default "Speak math")
//
// Events (bubble, composed):
//   mathinput   detail: DictationResult (+ {confirmed} when confirm is set)
//   matherror   detail: { code, message, transcript? }
//   mathstatus  detail: { status }
import { createVoiceMathInput, VoiceMathInputSession } from './session';
import { VoiceMathError, type SessionStatus } from './types';

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle: 'Voice input ready to enable',
  loading: 'Loading speech model…',
  ready: 'Ready',
  recording: 'Listening… (stops when you pause)',
  transcribing: 'Transcribing…',
  'confirm-listening': 'Listening for yes or no…',
  speaking: 'Reading back…',
  error: 'Voice input unavailable',
  disposed: '',
};

export class VoiceMathInputElement extends HTMLElement {
  static get observedAttributes() {
    return ['label'];
  }

  private session: VoiceMathInputSession | null = null;
  private button!: HTMLButtonElement;
  private statusEl!: HTMLSpanElement;
  private offStatus: (() => void) | null = null;
  private busy = false;

  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; gap: 0.6em; font: inherit; }
        button {
          font: inherit; cursor: pointer; padding: 0.5em 1em; border-radius: 999px;
          border: 2px solid currentColor; background: transparent; color: inherit;
          display: inline-flex; align-items: center; gap: 0.4em;
        }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        button.recording { color: #b3261e; }
        [role="status"] { font-size: 0.9em; opacity: 0.85; }
      </style>
      <button type="button" part="button">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5.3-3a.75.75 0 0 1 1.5.1A6.75 6.75 0 0 1 12.75 17.7v2.55h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5V17.7A6.75 6.75 0 0 1 5.2 11.1a.75.75 0 0 1 1.5-.1 5.25 5.25 0 0 0 10.6 0z"/></svg>
        <span id="label"></span>
      </button>
      <span part="status" role="status" aria-live="polite"></span>
    `;
    this.button = root.querySelector('button')!;
    this.statusEl = root.querySelector('[role="status"]')!;
    this.updateLabel();
    this.button.addEventListener('click', () => void this.onClick());
  }

  attributeChangedCallback() {
    if (this.button) this.updateLabel();
  }

  disconnectedCallback() {
    this.offStatus?.();
    this.session?.dispose();
    this.session = null;
  }

  private updateLabel() {
    const label = this.shadowRoot?.querySelector('#label');
    if (label) label.textContent = this.getAttribute('label') ?? 'Speak math';
  }

  private ensureSession(): VoiceMathInputSession {
    if (!this.session) {
      this.session = createVoiceMathInput({
        model: this.getAttribute('model') ?? undefined,
        device: (this.getAttribute('device') as 'auto' | 'webgpu' | 'wasm' | null) ?? undefined,
        readback: this.getAttribute('readback') === 'off' ? false : 'builtin',
        assets: {
          modelBaseUrl: this.getAttribute('model-base-url') ?? undefined,
          wasmBaseUrl: this.getAttribute('wasm-base-url') ?? undefined,
        },
      });
      this.offStatus = this.session.on('status', (status) => {
        this.statusEl.textContent = STATUS_TEXT[status];
        this.button.classList.toggle('recording', status === 'recording');
        this.dispatch('mathstatus', { status });
      });
    }
    return this.session;
  }

  private dispatch(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private async onClick() {
    const session = this.ensureSession();
    if (session.status === 'recording' || session.status === 'confirm-listening') {
      session.stop();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      this.statusEl.textContent = STATUS_TEXT.loading;
      await session.load((p) => {
        this.statusEl.textContent = `Downloading ${p.file} — ${Math.round(p.progress)}%`;
      });
      if (this.hasAttribute('confirm')) {
        const outcome = await session.dictateWithConfirmation();
        this.dispatch('mathinput', { ...outcome.result, confirmed: outcome.confirmed });
      } else {
        const result = await session.dictateOnce();
        this.dispatch('mathinput', result);
      }
    } catch (err) {
      const detail =
        err instanceof VoiceMathError
          ? { code: err.code, message: err.message, transcript: err.transcript }
          : { code: 'unknown', message: String(err) };
      this.statusEl.textContent = detail.message;
      this.dispatch('matherror', detail);
    } finally {
      this.busy = false;
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('voice-math-input')) {
  customElements.define('voice-math-input', VoiceMathInputElement);
}
