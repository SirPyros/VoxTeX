// Per-user personalization, stored locally: learned ASR corrections plus an
// acoustic profile (microphone noise floor) that seeds the VAD so recordings
// start pre-calibrated. Opt-in via the `personalization` session option.
import {
  CorrectionEngine,
  type AppliedCorrection,
  type CorrectionRule,
} from './corrections';

export interface AudioProfile {
  /** Exponential moving average of measured RMS noise floors. */
  noiseFloor: number;
  /** Number of recordings folded into the average. */
  samples: number;
}

export interface PersonalizationProfile {
  version: 1;
  rules: CorrectionRule[];
  candidates: CorrectionRule[];
  audio: AudioProfile | null;
}

/** Pluggable persistence. The default is localStorage; supply your own to use
 * IndexedDB, an origin-private file, or a per-student keyed backend. */
export interface PersonalizationStore {
  load(): PersonalizationProfile | null | Promise<PersonalizationProfile | null>;
  save(profile: PersonalizationProfile): void | Promise<void>;
  clear(): void | Promise<void>;
}

export interface PersonalizationOptions {
  /** localStorage key for the default store. Default "voxtex-voice-profile". */
  storageKey?: string;
  /** Custom persistence; overrides storageKey. */
  store?: PersonalizationStore;
  /** Observations before a correction becomes active. Default 2. */
  minObservations?: number;
  /** Bound on stored correction rules. Default 50. */
  maxRules?: number;
}

const DEFAULT_STORAGE_KEY = 'voxtex-voice-profile';
const NOISE_FLOOR_EMA_WEIGHT = 0.3;

export function emptyProfile(): PersonalizationProfile {
  return { version: 1, rules: [], candidates: [], audio: null };
}

export class LocalStoragePersonalizationStore implements PersonalizationStore {
  constructor(private readonly key: string = DEFAULT_STORAGE_KEY) {}

  load(): PersonalizationProfile | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersonalizationProfile;
      return parsed && parsed.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  save(profile: PersonalizationProfile): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(profile));
    } catch {
      // Storage full or blocked — personalization degrades to in-memory.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

/** In-memory store: tests, SSR, or "don't persist" scenarios. */
export class MemoryPersonalizationStore implements PersonalizationStore {
  private profile: PersonalizationProfile | null = null;

  load(): PersonalizationProfile | null {
    return this.profile;
  }

  save(profile: PersonalizationProfile): void {
    this.profile = profile;
  }

  clear(): void {
    this.profile = null;
  }
}

function defaultStore(storageKey?: string): PersonalizationStore {
  if (typeof localStorage !== 'undefined') {
    return new LocalStoragePersonalizationStore(storageKey);
  }
  return new MemoryPersonalizationStore();
}

/**
 * Owns the profile lifecycle. Consumers reach it via `session.personalization`.
 */
export class Personalization {
  /** Resolves once the profile has been loaded from the store. */
  readonly ready: Promise<void>;

  private readonly store: PersonalizationStore;
  private readonly options: PersonalizationOptions;
  private engine: CorrectionEngine;
  private audioProfile: AudioProfile | null = null;
  private lastRejectedTranscript: string | null = null;

  constructor(options: PersonalizationOptions = {}) {
    this.options = options;
    this.store = options.store ?? defaultStore(options.storageKey);
    this.engine = this.buildEngine(emptyProfile());
    this.ready = Promise.resolve(this.store.load()).then((profile) => {
      if (profile) {
        this.engine = this.buildEngine(profile);
        this.audioProfile = profile.audio;
      }
    });
  }

  private buildEngine(profile: PersonalizationProfile): CorrectionEngine {
    return new CorrectionEngine(profile.rules, profile.candidates, {
      minObservations: this.options.minObservations,
      maxRules: this.options.maxRules,
    });
  }

  /** Active correction rules (for inspection UIs). */
  rules(): CorrectionRule[] {
    return this.engine.snapshot().rules;
  }

  /** The persisted acoustic profile, if any recordings have been folded in. */
  audio(): AudioProfile | null {
    return this.audioProfile ? { ...this.audioProfile } : null;
  }

  /** Apply learned corrections to a raw ASR transcript. */
  applyCorrections(transcript: string): { text: string; applied: AppliedCorrection[] } {
    return this.engine.apply(transcript);
  }

  /**
   * The user (or the confirm loop) rejected this transcript. The next
   * confirmed transcript will be diffed against it to learn corrections.
   * Pass the RAW transcript (before corrections were applied).
   */
  noteRejected(rawTranscript: string): void {
    if (rawTranscript.trim()) this.lastRejectedTranscript = rawTranscript;
  }

  /** The user confirmed this transcript; learn from the last rejection. */
  noteConfirmed(rawTranscript: string): CorrectionRule[] {
    const rejected = this.lastRejectedTranscript;
    this.lastRejectedTranscript = null;
    if (!rejected || !rawTranscript.trim()) return [];
    const promoted = this.engine.learn(rejected, rawTranscript);
    this.persist();
    return promoted;
  }

  /** Fold one recording's measured noise floor into the acoustic profile. */
  updateAudio(noiseFloor: number): void {
    if (!Number.isFinite(noiseFloor) || noiseFloor < 0) return;
    if (!this.audioProfile) {
      this.audioProfile = { noiseFloor, samples: 1 };
    } else {
      this.audioProfile = {
        noiseFloor:
          this.audioProfile.noiseFloor * (1 - NOISE_FLOOR_EMA_WEIGHT) +
          noiseFloor * NOISE_FLOOR_EMA_WEIGHT,
        samples: this.audioProfile.samples + 1,
      };
    }
    this.persist();
  }

  addRule(from: string, to: string): void {
    this.engine.addRule(from, to);
    this.persist();
  }

  removeRule(from: string): void {
    this.engine.removeRule(from);
    this.persist();
  }

  /** Wipe the stored profile ("clear my voice profile"). */
  clear(): void {
    this.engine.clear();
    this.audioProfile = null;
    this.lastRejectedTranscript = null;
    void this.store.clear();
  }

  /** JSON snapshot — lets users carry their profile across devices. */
  exportProfile(): string {
    return JSON.stringify(this.toProfile(), null, 2);
  }

  importProfile(json: string): void {
    const parsed = JSON.parse(json) as PersonalizationProfile;
    if (!parsed || parsed.version !== 1) {
      throw new Error('Unsupported profile format.');
    }
    this.engine = this.buildEngine(parsed);
    this.audioProfile = parsed.audio;
    this.persist();
  }

  private toProfile(): PersonalizationProfile {
    const { rules, candidates } = this.engine.snapshot();
    return { version: 1, rules, candidates, audio: this.audioProfile };
  }

  private persist(): void {
    void this.store.save(this.toProfile());
  }
}
