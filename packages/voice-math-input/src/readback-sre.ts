// Optional read-back tier backed by speech-rule-engine (ClearSpeak et al.).
// Import from "@voxtex/voice-math-input/readback-sre".
//
// Requires the optional peer dependencies `katex` and `speech-rule-engine`,
// plus SRE's mathmaps JSON hosted somewhere you control (copy
// node_modules/speech-rule-engine/lib/mathmaps to your static assets or CDN).
import katex from 'katex';
// Static import: importing this subpath at all is the opt-in, so there is no
// need for a dynamic import (which would also inject bundler preload helpers
// that clash when consumers re-bundle the built files).
import * as sreImport from 'speech-rule-engine';
import type { ReadbackProvider } from './types';

interface SreModule {
  setupEngine: (opts: Record<string, unknown>) => unknown;
  engineReady: () => Promise<unknown>;
  toSpeech: (mathml: string) => string;
}

export interface SreReadbackOptions {
  /** URL of the hosted mathmaps directory, e.g. "https://cdn.example.com/sre/mathmaps". */
  mathmapsUrl: string;
  /** SRE rule set. Default: "clearspeak". */
  domain?: string;
  /** Default: "en". */
  locale?: string;
}

export function mathmlFromLatex(latex: string): string | null {
  try {
    // Spacing commands are purely visual; SRE reads them as "empty".
    const speechLatex = latex.replace(/\\[,;:!]/g, ' ');
    const html = katex.renderToString(speechLatex, { output: 'mathml', throwOnError: true });
    const match = html.match(/<math[\s\S]*<\/math>/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Create a ReadbackProvider that renders LaTeX to MathML (KaTeX) and speaks
 * it via speech-rule-engine. Falls back to the built-in read-back text when
 * SRE cannot initialize or handle an expression.
 */
export function createSreReadback(options: SreReadbackOptions): ReadbackProvider {
  let sre: SreModule | null = null;
  let initPromise: Promise<void> | null = null;

  const init = () => {
    if (!initPromise) {
      initPromise = (async () => {
        const mod = sreImport as unknown as SreModule | { default: SreModule };
        const api = 'setupEngine' in mod ? mod : mod.default;
        api.setupEngine({
          locale: options.locale ?? 'en',
          domain: options.domain ?? 'clearspeak',
          modality: 'speech',
          markup: 'none',
          json: options.mathmapsUrl,
        });
        await api.engineReady();
        // Smoke-test so a broken setup falls back now rather than at first use.
        if (typeof api.toSpeech('<math><mn>1</mn></math>') !== 'string') {
          throw new Error('SRE returned no speech');
        }
        sre = api;
      })();
    }
    return initPromise;
  };

  return {
    async speechFor(latex: string, fallback: string): Promise<string> {
      try {
        await init();
      } catch {
        return fallback;
      }
      if (!sre) return fallback;
      const mathml = mathmlFromLatex(latex);
      if (!mathml) return fallback;
      try {
        const text = sre.toSpeech(mathml).trim();
        return text || fallback;
      } catch {
        return fallback;
      }
    },
  };
}
