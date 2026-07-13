// Minimal typings for the subset of speech-rule-engine we use (optional peer).
declare module 'speech-rule-engine' {
  export function setupEngine(options: Record<string, unknown>): unknown;
  export function engineReady(): Promise<unknown>;
  export function toSpeech(mathml: string): string;
}
