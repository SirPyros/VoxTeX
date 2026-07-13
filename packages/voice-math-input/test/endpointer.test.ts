import { describe, expect, it } from 'vitest';
import { Endpointer, type EndpointDecision } from '../src/endpointer';

const CONFIG = {
  maxMs: 10000,
  silenceMs: 900,
  minSpeechMs: 150,
  noSpeechTimeoutMs: 3500,
  calibrationMs: 240,
};

const FRAME = 50;
const QUIET = 0.002; // room noise
const VOICE = 0.06; // speaking level

/** Drive the endpointer with (level, durationMs) segments; return the first decision. */
function run(ep: Endpointer, segments: Array<[number, number]>): EndpointDecision {
  for (const [level, duration] of segments) {
    for (let t = 0; t < duration; t += FRAME) {
      const decision = ep.update(level, FRAME);
      if (decision !== null) return decision;
    }
  }
  return null;
}

describe('Endpointer', () => {
  it('stops after trailing silence once speech was heard', () => {
    const ep = new Endpointer(CONFIG);
    const decision = run(ep, [
      [QUIET, 300], // calibration + lead-in
      [VOICE, 1200], // utterance
      [QUIET, 2000], // trailing silence
    ]);
    expect(decision).toBe('speech-ended');
    expect(ep.speechDetected).toBe(true);
  });

  it('reports no-speech when nothing is said', () => {
    const ep = new Endpointer(CONFIG);
    const decision = run(ep, [[QUIET, 5000]]);
    expect(decision).toBe('no-speech');
    expect(ep.speechDetected).toBe(false);
  });

  it('ignores blips shorter than minSpeechMs', () => {
    const ep = new Endpointer(CONFIG);
    const decision = run(ep, [
      [QUIET, 300],
      [VOICE, 50], // a click, not speech
      [QUIET, 5000],
    ]);
    expect(decision).toBe('no-speech');
  });

  it('does not cut off mid-utterance pauses shorter than silenceMs', () => {
    const ep = new Endpointer(CONFIG);
    const decision = run(ep, [
      [QUIET, 300],
      [VOICE, 500],
      [QUIET, 500], // breath pause < 900 ms
      [VOICE, 500],
      [QUIET, 2000],
    ]);
    expect(decision).toBe('speech-ended');
  });

  it('hits the hard timeout during continuous speech', () => {
    const ep = new Endpointer(CONFIG);
    const decision = run(ep, [[VOICE, 11000]]);
    expect(decision).toBe('timeout');
    expect(ep.speechDetected).toBe(true);
  });

  it('detects speech that starts during calibration', () => {
    const ep = new Endpointer(CONFIG);
    const decision = run(ep, [
      [VOICE, 800], // speaking from the very first frame
      [QUIET, 2000],
    ]);
    expect(decision).toBe('speech-ended');
    expect(ep.speechDetected).toBe(true);
  });

  it('reports the measured noise floor after calibration', () => {
    const ep = new Endpointer(CONFIG);
    run(ep, [
      [QUIET, 300],
      [VOICE, 500],
      [QUIET, 2000],
    ]);
    expect(ep.measuredNoiseFloor).toBeCloseTo(QUIET, 6);
  });

  it('a persisted noise floor raises the threshold in a noisy setup', () => {
    // A loud-fan profile (0.02): moderate hum at 0.03 must not count as
    // speech once the seed is blended in.
    const seeded = new Endpointer({ ...CONFIG, initialNoiseFloor: 0.02 });
    const decision = run(seeded, [
      [0.03, 200],
      [0.02, 5000],
    ]);
    expect(decision).toBe('no-speech');
    expect(seeded.speechDetected).toBe(false);

    // Real speech still gets through on the same seed.
    const seeded2 = new Endpointer({ ...CONFIG, initialNoiseFloor: 0.02 });
    const decision2 = run(seeded2, [
      [0.02, 200],
      [0.09, 800],
      [0.02, 2000],
    ]);
    expect(decision2).toBe('speech-ended');
  });

  it('blends a stale seed with the live measurement', () => {
    // Seed says noisy room (0.02) but the room is actually quiet (0.002):
    // blended floor ~0.011 -> threshold ~0.033, so moderate speech at 0.05
    // is detected even though the stale seed alone would demand 0.06.
    const ep = new Endpointer({ ...CONFIG, initialNoiseFloor: 0.02 });
    const decision = run(ep, [
      [QUIET, 240], // calibration window
      [0.05, 800],
      [QUIET, 2000],
    ]);
    expect(decision).toBe('speech-ended');
  });

  it('adapts the threshold to a noisy room', () => {
    const HUM = 0.02; // steady fan noise above the default threshold
    const ep = new Endpointer(CONFIG);
    // The hum alone must not count as speech...
    const decision = run(ep, [[HUM, 5000]]);
    expect(decision).toBe('no-speech');
    expect(ep.speechDetected).toBe(false);

    // ...but voice on top of the same hum must.
    const ep2 = new Endpointer(CONFIG);
    const decision2 = run(ep2, [
      [HUM, 300],
      [0.09, 1000], // louder than hum * multiplier
      [HUM, 2000],
    ]);
    expect(decision2).toBe('speech-ended');
  });
});

