// @voxtex/voice-math-input — voice-to-LaTeX input SDK.
// Headless core: on-device Whisper ASR (Web Worker, WebGPU/WASM) + the
// deterministic spoken-math grammar. See INTEGRATION.md at the repo root.

export { createVoiceMathInput, interpretYesNo, VoiceMathInputSession } from './session';
export { VoiceMathError } from './types';
export type {
  AssetOptions,
  ConfirmationOutcome,
  DeviceMode,
  DictationResult,
  LoadResult,
  ModelProgress,
  ReadbackProvider,
  RecordingTuning,
  SessionStatus,
  VoiceMathErrorCode,
  VoiceMathInputOptions,
  YesNo,
  YesNoResult,
} from './types';

export { CorrectionEngine, diffReplacements } from './corrections';
export type { AppliedCorrection, CorrectionEngineOptions, CorrectionRule } from './corrections';
export {
  LocalStoragePersonalizationStore,
  MemoryPersonalizationStore,
  Personalization,
} from './personalization';
export type {
  AudioProfile,
  PersonalizationOptions,
  PersonalizationProfile,
  PersonalizationStore,
} from './personalization';

export { Endpointer } from './endpointer';
export type { EndpointDecision, EndpointerConfig } from './endpointer';
export { startRecording } from './recorder';
export type { RecordingController, RecordingOptions, RecordingResult, VadOptions } from './recorder';
export { speak, stopSpeaking } from './speech';

// The parser is bundled and re-exported so typed input gets the exact same
// grammar without a second dependency.
export {
  ParseError,
  parseSpokenMath,
  toLatex,
  toSpeech,
  tokenize,
  tryParseSpokenMath,
} from '@voxtex/spoken-math-parser';
export type { MathNode, ParseResult, Token, TokenKind } from '@voxtex/spoken-math-parser';
