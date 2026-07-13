/**
 * Energy-based utterance end-pointing (a tiny VAD).
 *
 * Pure state machine — no audio APIs — so it is unit-testable. The recorder
 * feeds it one RMS level per analysis frame; it answers whether the recording
 * should stop and why.
 *
 * Lifecycle:
 *   calibrating          measure the noise floor for the first few frames
 *   waiting-for-speech   nothing voiced yet; give up after noSpeechTimeoutMs
 *   in-speech            voiced audio heard (at least minSpeechMs cumulative)
 *   trailing-silence     stop once silence lasts silenceMs after speech
 */

export interface EndpointerConfig {
  /** Hard cap on total duration (ms). */
  maxMs: number;
  /** Trailing silence that ends the utterance once speech was heard (ms). */
  silenceMs: number;
  /** Cumulative voiced time required before speech counts as "heard" (ms). */
  minSpeechMs: number;
  /** Give up if speech hasn't started within this time (ms). */
  noSpeechTimeoutMs: number;
  /** Time spent measuring the noise floor at the start (ms). Default 240. */
  calibrationMs?: number;
  /**
   * Persisted noise floor from previous recordings (personalization).
   * When provided, calibration is shortened and blended with this seed.
   */
  initialNoiseFloor?: number;
}

export type EndpointDecision = 'speech-ended' | 'no-speech' | 'timeout' | null;

/** RMS above this always counts as speech, even mid-calibration. */
const HOT_LEVEL = 0.04;
/** Threshold bounds: never below (mic noise), never above (quiet speakers). */
const MIN_THRESHOLD = 0.01;
const MAX_THRESHOLD = 0.08;
const NOISE_MULTIPLIER = 3;

export class Endpointer {
  private readonly config: EndpointerConfig & { calibrationMs: number };
  private readonly initialNoiseFloor: number | null;
  private elapsedMs = 0;
  private voicedMs = 0;
  private trailingSilenceMs = 0;
  private calibrationSum = 0;
  private calibrationFrames = 0;
  private calibrated = false;
  private threshold = MIN_THRESHOLD;
  private speechHeard = false;
  private measuredFloor: number | null = null;

  constructor(config: EndpointerConfig) {
    this.initialNoiseFloor = config.initialNoiseFloor ?? null;
    // A persisted noise floor lets us shorten the cold-start calibration.
    const calibrationMs =
      config.calibrationMs ?? (this.initialNoiseFloor !== null ? 120 : 240);
    this.config = { ...config, calibrationMs };
    if (this.initialNoiseFloor !== null) {
      this.threshold = clampThreshold(this.initialNoiseFloor * NOISE_MULTIPLIER);
    }
  }

  get speechDetected(): boolean {
    return this.speechHeard;
  }

  /** The noise floor measured during this recording's calibration window
   * (not blended with the seed) — feed it back into the persisted profile. */
  get measuredNoiseFloor(): number | null {
    return this.measuredFloor;
  }

  /** Feed one analysis frame. Returns a stop reason, or null to continue. */
  update(rms: number, frameMs: number): EndpointDecision {
    this.elapsedMs += frameMs;

    if (this.elapsedMs >= this.config.maxMs) return 'timeout';

    if (!this.calibrated) {
      if (rms >= HOT_LEVEL) {
        // Speaker started immediately — close calibration with what we have.
        this.finishCalibration();
      } else {
        this.calibrationSum += rms;
        this.calibrationFrames += 1;
        if (this.elapsedMs >= this.config.calibrationMs) this.finishCalibration();
        return null;
      }
    }

    const voiced = rms >= this.threshold;
    if (voiced) {
      this.voicedMs += frameMs;
      this.trailingSilenceMs = 0;
      if (this.voicedMs >= this.config.minSpeechMs) this.speechHeard = true;
    } else {
      this.trailingSilenceMs += frameMs;
      if (this.speechHeard && this.trailingSilenceMs >= this.config.silenceMs) {
        return 'speech-ended';
      }
      if (!this.speechHeard && this.elapsedMs >= this.config.noSpeechTimeoutMs) {
        return 'no-speech';
      }
    }
    return null;
  }

  private finishCalibration(): void {
    const measured =
      this.calibrationFrames > 0 ? this.calibrationSum / this.calibrationFrames : null;
    this.measuredFloor = measured;
    // Blend a persisted seed with the live measurement: robust to both a
    // stale profile (different room) and a polluted calibration window.
    const floor =
      this.initialNoiseFloor !== null && measured !== null
        ? (measured + this.initialNoiseFloor) / 2
        : (measured ?? this.initialNoiseFloor ?? 0);
    this.threshold = clampThreshold(floor * NOISE_MULTIPLIER);
    this.calibrated = true;
  }
}

function clampThreshold(value: number): number {
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value));
}
