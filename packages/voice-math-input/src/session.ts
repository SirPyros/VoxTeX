import { toSpeech, tryParseSpokenMath } from '@voxtex/spoken-math-parser';
import type { FromWorker, ToWorker } from './messages';
import { Personalization } from './personalization';
import { startRecording, type RecordingController, type RecordingOptions } from './recorder';
import { speak as ttsSpeak, stopSpeaking as ttsStop } from './speech';
import {
  VoiceMathError,
  type ConfirmationOutcome,
  type DictationResult,
  type LoadResult,
  type ModelProgress,
  type SessionEvents,
  type SessionStatus,
  type VoiceMathInputOptions,
  type YesNoResult,
} from './types';

const DEFAULT_MODEL = 'onnx-community/whisper-tiny.en';
const DEFAULT_FALLBACK_MODEL = 'Xenova/whisper-tiny.en';

const DEFAULT_DICTATION = {
  maxMs: 30000,
  silenceMs: 1500,
  minSpeechMs: 250,
  noSpeechTimeoutMs: 8000,
};

const DEFAULT_CONFIRMATION = {
  maxMs: 8000,
  silenceMs: 900,
  minSpeechMs: 150,
  noSpeechTimeoutMs: 3500,
};

export function interpretYesNo(text: string): 'yes' | 'no' | 'unclear' {
  const t = text.toLowerCase();
  if (/\b(yes|yeah|yep|yup|confirm|submit|correct|right|sure)\b/.test(t)) return 'yes';
  if (/\b(no|nope|nah|try again|retry|wrong|start over|redo|cancel)\b/.test(t)) return 'no';
  return 'unclear';
}

interface PendingTranscription {
  resolve: (t: { text: string; ms: number }) => void;
  reject: (e: Error) => void;
}

type Listener<E extends keyof SessionEvents> = (payload: SessionEvents[E]) => void;

export class VoiceMathInputSession {
  private readonly options: VoiceMathInputOptions;
  private worker: Worker | null = null;
  private loadPromise: Promise<LoadResult> | null = null;
  private loadedBackend: 'webgpu' | 'wasm' | null = null;
  private readonly pending = new Map<number, PendingTranscription>();
  private nextId = 0;
  private statusValue: SessionStatus = 'idle';
  private recorder: RecordingController | null = null;
  private cancelledRecording = false;
  private disposed = false;
  private readonly personal: Personalization | null;
  private readonly listeners: { [E in keyof SessionEvents]: Set<Listener<E>> } = {
    status: new Set(),
    progress: new Set(),
  };

  constructor(options: VoiceMathInputOptions = {}) {
    this.options = options;
    this.personal =
      options.personalization === undefined || options.personalization === false
        ? null
        : new Personalization(options.personalization === true ? {} : options.personalization);
  }

  get status(): SessionStatus {
    return this.statusValue;
  }

  /**
   * The local personalization profile (learned corrections + audio profile),
   * or null when the `personalization` option is off. Feed it learning
   * signals with confirmResult()/rejectResult().
   */
  get personalization(): Personalization | null {
    return this.personal;
  }

  get backend(): 'webgpu' | 'wasm' | null {
    return this.loadedBackend;
  }

  on<E extends keyof SessionEvents>(event: E, listener: Listener<E>): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  private emit<E extends keyof SessionEvents>(event: E, payload: SessionEvents[E]) {
    for (const l of this.listeners[event]) l(payload);
  }

  private setStatus(s: SessionStatus) {
    if (this.statusValue !== s && this.statusValue !== 'disposed') {
      this.statusValue = s;
      this.emit('status', s);
    }
  }

  private assertUsable() {
    if (this.disposed) throw new VoiceMathError('disposed', 'This session has been disposed.');
  }

  /** Download (or read from cache) and warm the ASR model. Idempotent. */
  load(onProgress?: (p: ModelProgress) => void): Promise<LoadResult> {
    this.assertUsable();
    if (onProgress) this.on('progress', onProgress);
    if (!this.loadPromise) {
      this.setStatus('loading');
      this.loadPromise = new Promise<LoadResult>((resolve, reject) => {
        let worker: Worker;
        try {
          worker = this.createWorker();
        } catch (err) {
          this.setStatus('error');
          reject(new VoiceMathError('model-load-failed', `Could not create the ASR worker: ${String(err)}`));
          return;
        }
        this.worker = worker;
        worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorkerMessage(e.data, resolve, reject);
        worker.onerror = (e) => {
          this.setStatus('error');
          reject(new VoiceMathError('model-load-failed', e.message || 'ASR worker crashed.'));
        };
        const msg: ToWorker = {
          type: 'load',
          model: this.options.model ?? DEFAULT_MODEL,
          fallbackModel: this.options.fallbackModel ?? DEFAULT_FALLBACK_MODEL,
          device: this.options.device ?? 'auto',
          ...(this.options.assets ? { assets: this.options.assets } : {}),
        };
        worker.postMessage(msg);
      });
    }
    return this.loadPromise;
  }

  private createWorker(): Worker {
    if (this.options.createWorker) return this.options.createWorker();
    if (this.options.workerUrl !== undefined) {
      return new Worker(this.options.workerUrl, { type: 'module' });
    }
    // Bundlers (webpack 5, Vite, Rollup) statically detect this pattern and
    // wire up the emitted self-contained worker file; browsers support it
    // natively when the package is loaded as an ES module.
    return new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' });
  }

  private onWorkerMessage(
    msg: FromWorker,
    resolveLoad: (r: LoadResult) => void,
    rejectLoad: (e: Error) => void,
  ) {
    switch (msg.type) {
      case 'progress':
        this.emit('progress', { file: msg.file, progress: msg.progress });
        break;
      case 'info':
        // Backend fallback notes etc. — informational only.
        break;
      case 'ready':
        this.loadedBackend = msg.backend;
        this.setStatus('ready');
        resolveLoad({ backend: msg.backend });
        break;
      case 'transcript': {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve({ text: msg.text, ms: msg.ms });
        break;
      }
      case 'error':
        if (msg.id !== null) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          p?.reject(new VoiceMathError('transcription-failed', msg.message));
        } else {
          this.setStatus('error');
          rejectLoad(new VoiceMathError('model-load-failed', msg.message));
        }
        break;
    }
  }

  private transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new VoiceMathError('not-loaded', 'Call load() before dictating.'));
        return;
      }
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      const msg: ToWorker = { type: 'transcribe', id, audio };
      this.worker.postMessage(msg, [audio.buffer as ArrayBuffer]);
    });
  }

  /** Stop the active recording early; the captured audio is still transcribed. */
  stop(): void {
    this.recorder?.stop();
  }

  /** Abandon the active recording; the pending dictation rejects with 'cancelled'. */
  cancel(): void {
    if (this.recorder) {
      this.cancelledRecording = true;
      this.recorder.stop();
    }
  }

  /** Parse typed text through the same pipeline as voice (corrections included). */
  async parseText(text: string): Promise<DictationResult> {
    this.assertUsable();
    let corrected = text;
    let applied: DictationResult['appliedCorrections'];
    if (this.personal) {
      await this.personal.ready;
      const c = this.personal.applyCorrections(text);
      corrected = c.text;
      if (c.applied.length > 0) applied = c.applied;
    }
    const attempt = tryParseSpokenMath(corrected);
    if (!attempt.ok) {
      this.personal?.noteRejected(text);
      throw new VoiceMathError('parse-error', attempt.error.message, corrected);
    }
    const r = attempt.result;
    const speech = await this.readbackFor(r.latex, r.speech);
    return {
      latex: r.latex,
      transcript: corrected,
      speech,
      ast: r.ast,
      tokens: r.tokens,
      transcribeMs: 0,
      ...(corrected !== text ? { rawTranscript: text } : {}),
      ...(applied !== undefined ? { appliedCorrections: applied } : {}),
    };
  }

  /** One hands-free dictation: record (VAD auto-stop) -> transcribe -> parse. */
  async dictateOnce(): Promise<DictationResult> {
    const transcript = await this.captureTranscript(
      { ...DEFAULT_DICTATION, ...this.options.dictation },
      'recording',
    );
    if (!transcript.text) {
      throw new VoiceMathError('empty-transcript', "The recording didn't contain any recognizable speech.");
    }

    // Personalization: apply learned corrections to the raw ASR text.
    const raw = transcript.text;
    let corrected = raw;
    let applied: DictationResult['appliedCorrections'];
    if (this.personal) {
      await this.personal.ready;
      const c = this.personal.applyCorrections(raw);
      corrected = c.text;
      if (c.applied.length > 0) applied = c.applied;
    }

    const attempt = tryParseSpokenMath(corrected);
    if (!attempt.ok) {
      // A failed parse is an implicit rejection: if the user retries and
      // confirms, the diff against this raw transcript teaches a correction.
      this.personal?.noteRejected(raw);
      throw new VoiceMathError('parse-error', attempt.error.message, corrected);
    }
    const r = attempt.result;
    const speech = await this.readbackFor(r.latex, r.speech);
    return {
      latex: r.latex,
      transcript: corrected,
      speech,
      ast: r.ast,
      tokens: r.tokens,
      transcribeMs: transcript.ms,
      ...(corrected !== raw ? { rawTranscript: raw } : {}),
      ...(applied !== undefined ? { appliedCorrections: applied } : {}),
    };
  }

  /**
   * Tell the session the user accepted this result (pressed Confirm, said
   * "yes", submitted the answer). With personalization on, this is the
   * positive learning signal: it is diffed against the last rejection.
   */
  confirmResult(result: DictationResult): void {
    this.personal?.noteConfirmed(result.rawTranscript ?? result.transcript);
  }

  /**
   * Tell the session the user rejected this result (said "no", pressed Try
   * again). The next confirmed transcript teaches corrections against it.
   */
  rejectResult(result: DictationResult): void {
    this.personal?.noteRejected(result.rawTranscript ?? result.transcript);
  }

  /** Listen for a short yes/no reply through the same ASR pipeline. */
  async listenYesNo(): Promise<YesNoResult> {
    try {
      const transcript = await this.captureTranscript(
        { ...DEFAULT_CONFIRMATION, ...this.options.confirmation },
        'confirm-listening',
      );
      if (!transcript.text) return { reply: 'silence', transcript: '' };
      return { reply: interpretYesNo(transcript.text), transcript: transcript.text };
    } catch (err) {
      if (err instanceof VoiceMathError && err.code === 'no-speech') {
        return { reply: 'silence', transcript: '' };
      }
      throw err;
    }
  }

  private async captureTranscript(
    tuning: Required<Omit<RecordingOptions, 'vad'>> & {
      silenceMs: number;
      minSpeechMs: number;
      noSpeechTimeoutMs: number;
    },
    recordingStatus: SessionStatus,
  ): Promise<{ text: string; ms: number }> {
    this.assertUsable();
    if (this.recorder) throw new VoiceMathError('busy', 'A recording is already in progress.');
    if (!this.loadPromise) throw new VoiceMathError('not-loaded', 'Call load() before dictating.');
    await this.loadPromise;

    ttsStop();
    this.setStatus(recordingStatus);
    this.cancelledRecording = false;

    // Seed the VAD with the persisted noise floor, when we have one.
    let initialNoiseFloor: number | undefined;
    if (this.personal) {
      await this.personal.ready;
      initialNoiseFloor = this.personal.audio()?.noiseFloor;
    }

    let recording;
    try {
      this.recorder = await startRecording({
        maxMs: tuning.maxMs,
        vad: {
          silenceMs: tuning.silenceMs,
          minSpeechMs: tuning.minSpeechMs,
          noSpeechTimeoutMs: tuning.noSpeechTimeoutMs,
          ...(initialNoiseFloor !== undefined ? { initialNoiseFloor } : {}),
        },
      });
      recording = await this.recorder.result;
    } catch (err) {
      this.setStatus('ready');
      throw new VoiceMathError('mic-unavailable', `Microphone problem: ${String(err)}`);
    } finally {
      this.recorder = null;
    }

    if (this.personal && recording.noiseFloor !== null) {
      this.personal.updateAudio(recording.noiseFloor);
    }

    if (this.cancelledRecording) {
      this.setStatus('ready');
      throw new VoiceMathError('cancelled', 'Dictation was cancelled.');
    }
    if (recording.endReason === 'no-speech' || recording.samples.length === 0) {
      this.setStatus('ready');
      throw new VoiceMathError('no-speech', "I didn't hear anything.");
    }

    this.setStatus('transcribing');
    try {
      return await this.transcribe(recording.samples);
    } finally {
      this.setStatus('ready');
    }
  }

  private async readbackFor(latex: string, fallback: string): Promise<string> {
    const rb = this.options.readback ?? 'builtin';
    if (rb === false || rb === 'builtin') return fallback;
    try {
      return await rb.speechFor(latex, fallback);
    } catch {
      return fallback;
    }
  }

  /** Speak text aloud (speechSynthesis); resolves when finished. */
  async speak(text: string): Promise<void> {
    this.assertUsable();
    const prev = this.statusValue;
    this.setStatus('speaking');
    try {
      await ttsSpeak(text);
    } finally {
      if (this.statusValue === 'speaking') this.setStatus(prev === 'speaking' ? 'ready' : prev);
    }
  }

  stopSpeaking(): void {
    ttsStop();
  }

  /**
   * Full hands-free loop: dictate -> spoken read-back -> voice yes/no.
   * "no" restarts dictation; silence or an unclear reply is re-prompted once,
   * then returned unconfirmed so the host can fall back to its own UI.
   */
  async dictateWithConfirmation(opts?: {
    maxAttempts?: number;
    confirmPrompt?: (r: DictationResult) => string;
  }): Promise<ConfirmationOutcome> {
    const maxAttempts = opts?.maxAttempts ?? 3;
    const promptFor =
      opts?.confirmPrompt ??
      ((r: DictationResult) => `I heard: ${r.speech}. Say yes to submit, or no to try again.`);

    let attempts = 0;
    for (;;) {
      attempts += 1;
      let result: DictationResult;
      try {
        result = await this.dictateOnce();
      } catch (err) {
        if (err instanceof VoiceMathError && err.code === 'parse-error' && attempts < maxAttempts) {
          await this.speak(`Sorry — ${err.message} Try again.`);
          continue;
        }
        throw err;
      }

      await this.speak(promptFor(result));
      let { reply } = await this.listenYesNo();
      if (reply === 'silence' || reply === 'unclear') {
        await this.speak('Please say yes to submit, or no to try again.');
        ({ reply } = await this.listenYesNo());
      }

      if (reply === 'yes') {
        this.confirmResult(result); // personalization learning signal
        return { result, confirmed: true, reply, attempts };
      }
      if (reply === 'no' && attempts < maxAttempts) {
        this.rejectResult(result);
        await this.speak('Okay, try again.');
        continue;
      }
      return { result, confirmed: false, reply, attempts };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    ttsStop();
    this.worker?.terminate();
    this.worker = null;
    this.loadPromise = null;
    for (const p of this.pending.values()) {
      p.reject(new VoiceMathError('disposed', 'Session disposed.'));
    }
    this.pending.clear();
    this.statusValue = 'disposed';
  }
}

/** Create a voice-math-input session. Call load() (or let dictateOnce await it). */
export function createVoiceMathInput(options: VoiceMathInputOptions = {}): VoiceMathInputSession {
  return new VoiceMathInputSession(options);
}

/** Deterministic English read-back for a parsed AST (re-exported convenience). */
export { toSpeech };
