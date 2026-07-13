import type { MathNode, Token } from '@voxtex/spoken-math-parser';

export type DeviceMode = 'auto' | 'webgpu' | 'wasm';

/** Point every remote asset at your own CDN instead of the Hugging Face Hub. */
export interface AssetOptions {
  /**
   * Base URL for self-hosted model files. When set, nothing is fetched from
   * huggingface.co; files are fetched from
   * `${modelBaseUrl}/<model-id>/<file>` (mirror the repo's file tree).
   */
  modelBaseUrl?: string;
  /**
   * Base URL for the onnxruntime .wasm binaries (used only on the WASM
   * fallback path). Defaults to the copies bundled next to the worker.
   */
  wasmBaseUrl?: string;
}

export interface RecordingTuning {
  /** Hard cap on recording duration (ms). */
  maxMs?: number;
  /** Trailing silence that ends the utterance (ms). */
  silenceMs?: number;
  /** Cumulative voiced time before speech counts as heard (ms). */
  minSpeechMs?: number;
  /** Give up when nothing is said within this window (ms). */
  noSpeechTimeoutMs?: number;
}

/** Turns a LaTeX string into read-back speech text. May be async. */
export interface ReadbackProvider {
  speechFor(latex: string, fallback: string): string | Promise<string>;
}

export interface VoiceMathInputOptions {
  /** ASR model id. Default: onnx-community/whisper-tiny.en */
  model?: string;
  /** Tried when the primary model fails to load. Default: Xenova/whisper-tiny.en */
  fallbackModel?: string;
  /** 'auto' tries WebGPU first, then WASM. Default: 'auto' */
  device?: DeviceMode;
  assets?: AssetOptions;
  /** Override where the ASR worker script is loaded from (e.g. your CDN). */
  workerUrl?: string | URL;
  /** Full control over worker creation (CSP edge cases, test doubles). */
  createWorker?: () => Worker;
  /** End-pointing for math dictation. */
  dictation?: RecordingTuning;
  /** End-pointing for short yes/no confirmation replies. */
  confirmation?: RecordingTuning;
  /**
   * Read-back text source: 'builtin' (deterministic English from the parser
   * AST, zero extra assets — the default), a custom ReadbackProvider (e.g.
   * createSreReadback from "@voxtex/voice-math-input/readback-sre"), or
   * false to skip read-back generation.
   */
  readback?: 'builtin' | false | ReadbackProvider;
}

export type SessionStatus =
  | 'idle' // model not loaded
  | 'loading'
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'confirm-listening'
  | 'speaking'
  | 'error'
  | 'disposed';

export interface ModelProgress {
  file: string;
  /** 0-100 for the current file. */
  progress: number;
}

export interface LoadResult {
  backend: 'webgpu' | 'wasm';
}

export interface DictationResult {
  /** The star of the show: LaTeX for the spoken expression. */
  latex: string;
  /** Raw ASR transcript. */
  transcript: string;
  /** Read-back text (from the configured readback provider). */
  speech: string;
  /** Parse tree — useful for debug panels and custom renderers. */
  ast: MathNode;
  /** Token stream, for debug display. */
  tokens: Token[];
  /** Worker-side inference time (ms). */
  transcribeMs: number;
}

export type YesNo = 'yes' | 'no' | 'unclear' | 'silence';

export interface YesNoResult {
  reply: YesNo;
  transcript: string;
}

export interface ConfirmationOutcome {
  result: DictationResult;
  /** True when the speaker confirmed with "yes". */
  confirmed: boolean;
  /** The final reply that ended the loop. */
  reply: YesNo;
  /** Number of dictation attempts made. */
  attempts: number;
}

export type VoiceMathErrorCode =
  | 'mic-unavailable'
  | 'no-speech'
  | 'empty-transcript'
  | 'parse-error'
  | 'model-load-failed'
  | 'not-loaded'
  | 'busy'
  | 'cancelled'
  | 'transcription-failed'
  | 'disposed';

export class VoiceMathError extends Error {
  constructor(
    public readonly code: VoiceMathErrorCode,
    message: string,
    /** The ASR transcript, when one existed (e.g. for parse-error). */
    public readonly transcript?: string,
  ) {
    super(message);
    this.name = 'VoiceMathError';
  }
}

export interface SessionEvents {
  status: SessionStatus;
  progress: ModelProgress;
}
