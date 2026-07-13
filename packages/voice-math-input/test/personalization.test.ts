import { describe, expect, it } from 'vitest';
import { MemoryPersonalizationStore, Personalization } from '../src/personalization';

async function makePersonalization(store = new MemoryPersonalizationStore()) {
  const p = new Personalization({ store });
  await p.ready;
  return { p, store };
}

describe('Personalization', () => {
  it('learns from a rejection followed by a confirmation, and persists', async () => {
    const { p, store } = await makePersonalization();

    p.noteRejected('feta squared');
    expect(p.noteConfirmed('theta squared')).toEqual([]); // observation 1
    p.noteRejected('sine of feta');
    const promoted = p.noteConfirmed('sine of theta'); // observation 2 -> rule
    expect(promoted).toEqual([{ from: 'feta', to: 'theta', count: 2 }]);

    expect(p.applyCorrections('feta cubed')).toEqual({
      text: 'theta cubed',
      applied: [{ from: 'feta', to: 'theta' }],
    });

    // A new instance over the same store sees the learned rule.
    const p2 = new Personalization({ store });
    await p2.ready;
    expect(p2.rules()).toEqual([{ from: 'feta', to: 'theta', count: 2 }]);
  });

  it('a confirmation without a prior rejection learns nothing', async () => {
    const { p } = await makePersonalization();
    expect(p.noteConfirmed('theta squared')).toEqual([]);
    expect(p.rules()).toHaveLength(0);
  });

  it('each rejection is consumed by at most one confirmation', async () => {
    const { p } = await makePersonalization();
    p.noteRejected('feta squared');
    p.noteConfirmed('theta squared');
    // Confirming again must not double-count the same rejection.
    p.noteConfirmed('theta squared');
    expect(p.rules()).toHaveLength(0); // still only 1 observation
  });

  it('maintains an EMA audio profile and persists it', async () => {
    const { p, store } = await makePersonalization();
    expect(p.audio()).toBeNull();
    p.updateAudio(0.01);
    expect(p.audio()).toEqual({ noiseFloor: 0.01, samples: 1 });
    p.updateAudio(0.02);
    const audio = p.audio()!;
    expect(audio.samples).toBe(2);
    expect(audio.noiseFloor).toBeCloseTo(0.01 * 0.7 + 0.02 * 0.3, 6);

    const p2 = new Personalization({ store });
    await p2.ready;
    expect(p2.audio()?.samples).toBe(2);
  });

  it('ignores invalid noise floors', async () => {
    const { p } = await makePersonalization();
    p.updateAudio(NaN);
    p.updateAudio(-1);
    expect(p.audio()).toBeNull();
  });

  it('clear() wipes rules, audio, and the store', async () => {
    const { p, store } = await makePersonalization();
    p.addRule('feta', 'theta');
    p.updateAudio(0.01);
    p.clear();
    expect(p.rules()).toHaveLength(0);
    expect(p.audio()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('export/import round-trips a profile', async () => {
    const { p } = await makePersonalization();
    p.addRule('feta', 'theta');
    p.updateAudio(0.012);
    const json = p.exportProfile();

    const { p: p2 } = await makePersonalization();
    p2.importProfile(json);
    expect(p2.rules()).toEqual([{ from: 'feta', to: 'theta', count: 2 }]);
    expect(p2.audio()?.noiseFloor).toBeCloseTo(0.012, 6);
    expect(() => p2.importProfile('{"version":99}')).toThrow();
  });
});
