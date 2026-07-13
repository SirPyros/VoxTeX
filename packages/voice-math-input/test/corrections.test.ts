import { describe, expect, it } from 'vitest';
import { CorrectionEngine, diffReplacements } from '../src/corrections';

describe('diffReplacements', () => {
  it('finds a single-word substitution', () => {
    expect(diffReplacements(['feta', 'squared'], ['theta', 'squared'])).toEqual([
      { from: ['feta'], to: ['theta'] },
    ]);
  });

  it('finds substitutions in context', () => {
    expect(
      diffReplacements(
        ['sine', 'of', 'feta', 'plus', 'two'],
        ['sine', 'of', 'theta', 'plus', 'two'],
      ),
    ).toEqual([{ from: ['feta'], to: ['theta'] }]);
  });

  it('handles multi-word replacements', () => {
    expect(
      diffReplacements(['won', 'over', 'x'], ['one', 'over', 'x']),
    ).toEqual([{ from: ['won'], to: ['one'] }]);
    expect(
      diffReplacements(['x', 'de', 'vided', 'by', 'two'], ['x', 'divided', 'by', 'two']),
    ).toEqual([{ from: ['de', 'vided'], to: ['divided'] }]);
  });

  it('ignores pure insertions and deletions', () => {
    expect(diffReplacements(['x', 'plus', 'two'], ['x', 'plus', 'plus', 'two'])).toEqual([]);
    expect(diffReplacements(['x', 'plus', 'plus', 'two'], ['x', 'plus', 'two'])).toEqual([]);
  });

  it('finds multiple independent substitutions', () => {
    expect(
      diffReplacements(['feta', 'plus', 'fy'], ['theta', 'plus', 'phi']),
    ).toEqual([
      { from: ['feta'], to: ['theta'] },
      { from: ['fy'], to: ['phi'] },
    ]);
  });
});

describe('CorrectionEngine', () => {
  it('promotes a pair to an active rule after two observations', () => {
    const engine = new CorrectionEngine();
    expect(engine.learn('feta squared', 'theta squared')).toEqual([]); // candidate
    expect(engine.rules).toHaveLength(0);
    const promoted = engine.learn('sine of feta', 'sine of theta');
    expect(promoted).toEqual([{ from: 'feta', to: 'theta', count: 2 }]);
    expect(engine.rules).toHaveLength(1);
  });

  it('applies active rules with word boundaries', () => {
    const engine = new CorrectionEngine([{ from: 'feta', to: 'theta', count: 2 }]);
    expect(engine.apply('feta squared plus feta').text).toBe('theta squared plus theta');
    // no substring bleed:
    expect(engine.apply('fetal position').text).toBe('fetal position');
    expect(engine.apply('two feta').applied).toEqual([{ from: 'feta', to: 'theta' }]);
  });

  it('never learns to rewrite recognizable math', () => {
    const engine = new CorrectionEngine([], [], { minObservations: 1 });
    // "two" -> "three" must not become a rule even if the user corrects it:
    expect(engine.learn('x plus two', 'x plus three')).toEqual([]);
    expect(engine.rules).toHaveLength(0);
  });

  it('only learns mappings INTO the vocabulary', () => {
    const engine = new CorrectionEngine([], [], { minObservations: 1 });
    expect(engine.learn('x plus blorp', 'x plus glorp')).toEqual([]);
    expect(engine.rules).toHaveLength(0);
  });

  it('restarts counting when the same mishearing is corrected differently', () => {
    const engine = new CorrectionEngine();
    engine.learn('blorp squared', 'theta squared');
    engine.learn('blorp squared', 'phi squared'); // changed mind
    expect(engine.rules).toHaveLength(0);
    engine.learn('blorp squared', 'phi squared');
    expect(engine.rules).toEqual([{ from: 'blorp', to: 'phi', count: 2 }]);
  });

  it('ignores long replacement blocks', () => {
    const engine = new CorrectionEngine([], [], { minObservations: 1 });
    engine.learn(
      'aaa bbb ccc ddd plus one',
      'x squared minus y plus one',
    );
    expect(engine.rules).toHaveLength(0);
  });

  it('caps the rule set at maxRules, keeping the strongest', () => {
    const engine = new CorrectionEngine([], [], { minObservations: 1, maxRules: 2 });
    engine.addRule('blorp', 'theta');
    engine.addRule('glorp', 'phi');
    engine.learn('zorp squared', 'alpha squared');
    expect(engine.rules).toHaveLength(2);
  });

  it('supports manual add/remove and snapshot round-trips', () => {
    const engine = new CorrectionEngine();
    engine.addRule('feta', 'theta');
    expect(engine.apply('feta').text).toBe('theta');
    const snap = engine.snapshot();
    const restored = new CorrectionEngine(snap.rules, snap.candidates);
    expect(restored.apply('feta').text).toBe('theta');
    restored.removeRule('feta');
    expect(restored.apply('feta').text).toBe('feta');
  });

  it('applies longer rules before shorter ones', () => {
    const engine = new CorrectionEngine([
      { from: 'de vided', to: 'divided', count: 2 },
      { from: 'de', to: 'd', count: 2 },
    ]);
    expect(engine.apply('x de vided by two').text).toBe('x divided by two');
  });
});
