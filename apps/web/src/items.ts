export interface AssessmentItem {
  id: string;
  /** Question shown on screen and read aloud. */
  prompt: string;
  /** The reference answer; student answers are checked for symbolic equivalence. */
  expectedLatex: string;
  /** Example phrasing shown under the item. */
  hint: string;
}

export const ITEMS: AssessmentItem[] = [
  {
    id: 'distribute',
    prompt: 'Say an expression equivalent to 2(x + 3).',
    expectedLatex: '2x+6',
    hint: 'Try: “two x plus six” — or “two times the quantity x plus three end quantity”. Both are accepted: answers are checked symbolically.',
  },
  {
    id: 'circle-area',
    prompt: 'What is the area of a circle with radius r?',
    expectedLatex: '\\pi r^2',
    hint: 'Try: “pi r squared”.',
  },
  {
    id: 'add-fractions',
    prompt: 'Compute one half plus one quarter. Give a single fraction or a decimal.',
    expectedLatex: '\\frac{3}{4}',
    hint: 'Try: “three quarters”, “three over four”, or “zero point seven five”.',
  },
  {
    id: 'trig-identity',
    prompt: 'What does sine squared of x plus cosine squared of x simplify to?',
    expectedLatex: '1',
    hint: 'Try: “one”. (Saying the whole identity back also counts — checking is symbolic.)',
  },
  {
    id: 'log',
    prompt: 'Two to what power gives eight? Answer with a number or a logarithm.',
    expectedLatex: '3',
    hint: 'Try: “three” — or “log base two of eight”.',
  },
  {
    id: 'derivative',
    prompt: 'What is the derivative of x squared?',
    expectedLatex: '2x',
    hint: 'Try: “two x” — or “the derivative of x squared” (checked symbolically).',
  },
  {
    id: 'summation',
    prompt: 'Compute the sum from n equals one to four of n.',
    expectedLatex: '10',
    hint: 'Try: “ten” — or say the summation back verbatim.',
  },
];
