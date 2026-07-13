// Learned ASR corrections: when a rejected transcript is followed by a
// confirmed one, word-level diffing extracts substitution pairs ("feta" ->
// "theta"). A pair observed enough times becomes an active rule applied to
// future transcripts before parsing.
//
// Safety constraints (this must never corrupt valid math):
//   - the misheard side must NOT already be recognizable vocabulary, so a
//     rule can never rewrite something the grammar understands ("two" can
//     never learn to become "three");
//   - the corrected side MUST be recognizable vocabulary;
//   - blocks are short (<= 3 words each side) and the rule set is bounded.
import { isRecognizedPhrase, normalizeWords } from '@voxtex/spoken-math-parser';

export interface CorrectionRule {
  /** Normalized misheard phrase, e.g. "feta". */
  from: string;
  /** Normalized replacement phrase, e.g. "theta". */
  to: string;
  /** How many times this pair has been observed. */
  count: number;
}

export interface AppliedCorrection {
  from: string;
  to: string;
}

export interface CorrectionEngineOptions {
  /** Observations required before a candidate becomes an active rule. Default 2. */
  minObservations?: number;
  /** Upper bound on stored rules; lowest-count rules are evicted. Default 50. */
  maxRules?: number;
}

const MAX_BLOCK_WORDS = 3;

/** Contiguous replace blocks between two word sequences (LCS-based). */
export function diffReplacements(
  a: readonly string[],
  b: readonly string[],
): Array<{ from: string[]; to: string[] }> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const blocks: Array<{ from: string[]; to: string[] }> = [];
  let i = 0;
  let j = 0;
  const atMatch = () => i < m && j < n && a[i] === b[j];
  while (i < m || j < n) {
    if (atMatch()) {
      i++;
      j++;
      continue;
    }
    const fromStart = i;
    const toStart = j;
    // Consume the mismatched region (including trailing tails) as one block.
    while ((i < m || j < n) && !atMatch()) {
      if (i < m && (j >= n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) i++;
      else j++;
    }
    blocks.push({ from: a.slice(fromStart, i), to: b.slice(toStart, j) });
  }
  // Only true substitutions are learnable — pure insertions/deletions are
  // usually fillers or dropped words, not systematic mishearings.
  return blocks.filter((e) => e.from.length > 0 && e.to.length > 0);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class CorrectionEngine {
  private readonly minObservations: number;
  private readonly maxRules: number;
  private ruleList: CorrectionRule[];
  private candidateList: CorrectionRule[];

  constructor(
    rules: CorrectionRule[] = [],
    candidates: CorrectionRule[] = [],
    options: CorrectionEngineOptions = {},
  ) {
    this.ruleList = [...rules];
    this.candidateList = [...candidates];
    this.minObservations = options.minObservations ?? 2;
    this.maxRules = options.maxRules ?? 50;
  }

  get rules(): readonly CorrectionRule[] {
    return this.ruleList;
  }

  get candidates(): readonly CorrectionRule[] {
    return this.candidateList;
  }

  /**
   * Learn from a rejected transcript followed by a confirmed one.
   * Returns any rules newly promoted to active by this observation.
   */
  learn(rejectedTranscript: string, confirmedTranscript: string): CorrectionRule[] {
    const a = normalizeWords(rejectedTranscript.toLowerCase());
    const b = normalizeWords(confirmedTranscript.toLowerCase());
    if (a.join(' ') === b.join(' ')) return [];

    const promoted: CorrectionRule[] = [];
    for (const block of diffReplacements(a, b)) {
      if (block.from.length > MAX_BLOCK_WORDS || block.to.length > MAX_BLOCK_WORDS) continue;
      const from = block.from.join(' ');
      const to = block.to.join(' ');
      if (from === to) continue;
      if (isRecognizedPhrase(from)) continue; // never rewrite valid math
      if (!isRecognizedPhrase(to)) continue; // only map INTO the vocabulary
      const rule = this.observe(from, to);
      if (rule) promoted.push(rule);
    }
    return promoted;
  }

  /** Record one observation; returns the rule if this promoted it to active. */
  private observe(from: string, to: string): CorrectionRule | null {
    const active = this.ruleList.find((r) => r.from === from);
    if (active) {
      if (active.to === to) {
        active.count += 1;
      } else {
        // The user now corrects the same mishearing differently — restart.
        this.ruleList = this.ruleList.filter((r) => r !== active);
        this.candidateList.push({ from, to, count: 1 });
      }
      return null;
    }

    const candidate = this.candidateList.find((c) => c.from === from);
    if (!candidate) {
      this.candidateList.push({ from, to, count: 1 });
      if (this.minObservations <= 1) return this.promote(from);
      return null;
    }
    if (candidate.to !== to) {
      candidate.to = to;
      candidate.count = 1;
      return null;
    }
    candidate.count += 1;
    if (candidate.count >= this.minObservations) return this.promote(from);
    return null;
  }

  private promote(from: string): CorrectionRule | null {
    const idx = this.candidateList.findIndex((c) => c.from === from);
    if (idx < 0) return null;
    const [rule] = this.candidateList.splice(idx, 1);
    this.ruleList.push(rule!);
    if (this.ruleList.length > this.maxRules) {
      this.ruleList.sort((x, y) => y.count - x.count);
      this.ruleList.length = this.maxRules;
    }
    return rule!;
  }

  /** Apply active rules to a transcript (whole-word, longest rule first). */
  apply(transcript: string): { text: string; applied: AppliedCorrection[] } {
    let text = transcript;
    const applied: AppliedCorrection[] = [];
    const ordered = [...this.ruleList].sort((x, y) => y.from.length - x.from.length);
    for (const rule of ordered) {
      const pattern = new RegExp(`\\b${escapeRegExp(rule.from)}\\b`, 'gi');
      if (pattern.test(text)) {
        text = text.replace(pattern, rule.to);
        applied.push({ from: rule.from, to: rule.to });
      }
    }
    return { text, applied };
  }

  addRule(from: string, to: string): void {
    const f = normalizeWords(from.toLowerCase()).join(' ');
    const t = normalizeWords(to.toLowerCase()).join(' ');
    if (!f || !t || f === t) return;
    this.ruleList = this.ruleList.filter((r) => r.from !== f);
    this.candidateList = this.candidateList.filter((c) => c.from !== f);
    this.ruleList.push({ from: f, to: t, count: this.minObservations });
  }

  removeRule(from: string): void {
    const f = normalizeWords(from.toLowerCase()).join(' ');
    this.ruleList = this.ruleList.filter((r) => r.from !== f);
    this.candidateList = this.candidateList.filter((c) => c.from !== f);
  }

  clear(): void {
    this.ruleList = [];
    this.candidateList = [];
  }

  snapshot(): { rules: CorrectionRule[]; candidates: CorrectionRule[] } {
    return {
      rules: this.ruleList.map((r) => ({ ...r })),
      candidates: this.candidateList.map((c) => ({ ...c })),
    };
  }
}
