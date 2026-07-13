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

