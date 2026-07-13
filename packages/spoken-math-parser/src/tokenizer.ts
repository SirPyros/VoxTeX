import { foldNumber, isNumberStart } from './numbers';

export type TokenKind =
  | 'NUMBER' | 'VAR' | 'PI'
  | 'PLUS' | 'MINUS' | 'NEG' | 'TIMES' | 'DIV'
  | 'OVER' | 'ALLOVER'
  | 'POW' | 'SQUARED' | 'CUBED'
  | 'SQRT' | 'CBRT' | 'ABS'
  | 'FUNC' | 'BASE' | 'OF'
  | 'FRACWORD' | 'POWORD'
  | 'INTEGRAL' | 'FROM' | 'TO' | 'DIFF' | 'WRT'
  | 'SUM' | 'DERIV' | 'PRIME' | 'INFINITY'
  | 'LPAREN' | 'RPAREN' | 'QTY' | 'QTYEND'
  | 'EQ' | 'LT' | 'GT' | 'LE' | 'GE'
  | 'PERCENT' | 'PM'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  /**
   * Literal payload:
   *  - NUMBER: decimal string ("3.5")
   *  - VAR: variable name ("x", or a Greek name like "theta")
   *  - FUNC: function name ("sin", "arctan", "log", "ln", ...)
   *  - FRACWORD: "<denominator>|<s or p>" e.g. "4|p" for "quarters"
   *  - POWORD: exponent from an ordinal ("4" for "to the fourth", "n" for nth)
   *  - DIFF: variable of integration ("x" for "dx")
   *  - DERIV: derivative order ("1", "2", "3")
   *  - PRIME: prime count ("1", "2" for "double prime", "3")
   */
  value?: string;
  /** Word index in the normalized input (for error messages). */
  pos: number;
  /** The raw word(s) this token came from. */
  raw: string;
}

export class ParseError extends Error {
  constructor(
    message: string,
    /** Word index in the normalized input, or -1 if not applicable. */
    public readonly position: number = -1,
    /** The offending word/token text, if any. */
    public readonly found: string | null = null,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Multi-word keyword phrases, checked longest-first at each position. */
const PHRASE_TABLE: Array<[string[], TokenKind, string?]> = [
  [['is', 'greater', 'than', 'or', 'equal', 'to'], 'GE'],
  [['is', 'less', 'than', 'or', 'equal', 'to'], 'LE'],
  [['greater', 'than', 'or', 'equal', 'to'], 'GE'],
  [['less', 'than', 'or', 'equal', 'to'], 'LE'],
  [['raised', 'to', 'the', 'power', 'of'], 'POW'],
  [['to', 'the', 'power', 'of'], 'POW'],
  [['with', 'respect', 'to'], 'WRT'],
  [['absolute', 'value', 'of'], 'ABS'],
  [['square', 'root', 'of'], 'SQRT'],
  [['cube', 'root', 'of'], 'CBRT'],
  [['is', 'greater', 'than'], 'GT'],
  [['is', 'less', 'than'], 'LT'],
  [['is', 'equal', 'to'], 'EQ'],
  [['greater', 'than'], 'GT'],
  [['less', 'than'], 'LT'],
  [['equal', 'to'], 'EQ'],
  [['equals', 'to'], 'EQ'],
  [['plus', 'or', 'minus'], 'PM'],
  [['divided', 'by'], 'DIV'],
  [['multiplied', 'by'], 'TIMES'],
  [['all', 'over'], 'ALLOVER'],
  [['open', 'paren'], 'LPAREN'],
  [['open', 'parenthesis'], 'LPAREN'],
  [['open', 'parentheses'], 'LPAREN'],
  [['left', 'paren'], 'LPAREN'],
  [['left', 'parenthesis'], 'LPAREN'],
  [['close', 'paren'], 'RPAREN'],
  [['close', 'parenthesis'], 'RPAREN'],
  [['close', 'parentheses'], 'RPAREN'],
  [['right', 'paren'], 'RPAREN'],
  [['right', 'parenthesis'], 'RPAREN'],
  [['the', 'quantity'], 'QTY'],
  [['end', 'quantity'], 'QTYEND'],
  [['close', 'quantity'], 'QTYEND'],
  // trig inverses and log aliases
  [['arc', 'sine'], 'FUNC', 'arcsin'],
  [['arc', 'sin'], 'FUNC', 'arcsin'],
  [['inverse', 'sine'], 'FUNC', 'arcsin'],
  [['inverse', 'sin'], 'FUNC', 'arcsin'],
  [['arc', 'cosine'], 'FUNC', 'arccos'],
  [['arc', 'cos'], 'FUNC', 'arccos'],
  [['inverse', 'cosine'], 'FUNC', 'arccos'],
  [['inverse', 'cos'], 'FUNC', 'arccos'],
  [['arc', 'tangent'], 'FUNC', 'arctan'],
  [['arc', 'tan'], 'FUNC', 'arctan'],
  [['inverse', 'tangent'], 'FUNC', 'arctan'],
  [['inverse', 'tan'], 'FUNC', 'arctan'],
  [['natural', 'log'], 'FUNC', 'ln'],
  [['natural', 'logarithm'], 'FUNC', 'ln'],
  // "d theta" as two words (Whisper usually joins "dx" but not "d theta")
  [['d', 'theta'], 'DIFF', 'theta'],
  // derivatives
  [['first', 'derivative'], 'DERIV', '1'],
  [['second', 'derivative'], 'DERIV', '2'],
  [['third', 'derivative'], 'DERIV', '3'],
  [['double', 'prime'], 'PRIME', '2'],
  [['triple', 'prime'], 'PRIME', '3'],
];

// Ordinal powers: "x to the fourth (power)" -> x^4, "to the nth power" -> x^n.
// ("squared"/"cubed" remain the idiomatic forms for 2 and 3, but the ordinals
// work too.) Both the long and short forms are registered; longest-first
// matching keeps them from shadowing "to the power of".
const ORDINALS: Array<[string, string]> = [
  ['first', '1'], ['second', '2'], ['third', '3'], ['fourth', '4'], ['fifth', '5'],
  ['sixth', '6'], ['seventh', '7'], ['eighth', '8'], ['ninth', '9'], ['tenth', '10'],
  ['nth', 'n'],
];
for (const [word, value] of ORDINALS) {
  PHRASE_TABLE.push([['to', 'the', word, 'power'], 'POWORD', value]);
  PHRASE_TABLE.push([['to', 'the', word], 'POWORD', value]);
}
const PHRASES = PHRASE_TABLE.sort((a, b) => b[0].length - a[0].length);

interface WordEntry {
  kind: TokenKind;
  value?: string;
}

/** Single-word keywords and symbols (ASR sometimes emits "1 + 2" or "1/2"). */
const WORD_MAP: Record<string, WordEntry> = {
  over: { kind: 'OVER' },
  plus: { kind: 'PLUS' },
  minus: { kind: 'MINUS' },
  negative: { kind: 'NEG' },
  times: { kind: 'TIMES' },
  equals: { kind: 'EQ' },
  is: { kind: 'EQ' },
  squared: { kind: 'SQUARED' },
  cubed: { kind: 'CUBED' },
  pi: { kind: 'PI' },
  percent: { kind: 'PERCENT' },
  quantity: { kind: 'QTY' },
  of: { kind: 'OF' },
  base: { kind: 'BASE' },
  integral: { kind: 'INTEGRAL' },
  integrate: { kind: 'INTEGRAL' },
  from: { kind: 'FROM' },
  to: { kind: 'TO' },
  sum: { kind: 'SUM' },
  summation: { kind: 'SUM' },
  some: { kind: 'SUM' }, // common Whisper spelling of "sum"
  derivative: { kind: 'DERIV', value: '1' },
  prime: { kind: 'PRIME', value: '1' },
  infinity: { kind: 'INFINITY' },
  '∞': { kind: 'INFINITY' },
  // symbols
  '+': { kind: 'PLUS' },
  '-': { kind: 'MINUS' },
  '*': { kind: 'TIMES' },
  '×': { kind: 'TIMES' },
  '÷': { kind: 'DIV' },
  '/': { kind: 'OVER' },
  '^': { kind: 'POW' },
  '%': { kind: 'PERCENT' },
  '=': { kind: 'EQ' },
  '<': { kind: 'LT' },
  '>': { kind: 'GT' },
  '≤': { kind: 'LE' },
  '≥': { kind: 'GE' },
  '(': { kind: 'LPAREN' },
  ')': { kind: 'RPAREN' },
  'π': { kind: 'PI' },
  '±': { kind: 'PM' },
  '²': { kind: 'SQUARED' },
  '³': { kind: 'CUBED' },
  '√': { kind: 'SQRT' },
  // trig / log (plus common Whisper misspellings: "sign", "cosign")
  sine: { kind: 'FUNC', value: 'sin' },
  sin: { kind: 'FUNC', value: 'sin' },
  sign: { kind: 'FUNC', value: 'sin' },
  cosine: { kind: 'FUNC', value: 'cos' },
  cos: { kind: 'FUNC', value: 'cos' },
  cosign: { kind: 'FUNC', value: 'cos' },
  tangent: { kind: 'FUNC', value: 'tan' },
  tan: { kind: 'FUNC', value: 'tan' },
  secant: { kind: 'FUNC', value: 'sec' },
  sec: { kind: 'FUNC', value: 'sec' },
  cosecant: { kind: 'FUNC', value: 'csc' },
  csc: { kind: 'FUNC', value: 'csc' },
  cotangent: { kind: 'FUNC', value: 'cot' },
  cot: { kind: 'FUNC', value: 'cot' },
  arcsine: { kind: 'FUNC', value: 'arcsin' },
  arcsin: { kind: 'FUNC', value: 'arcsin' },
  arccosine: { kind: 'FUNC', value: 'arccos' },
  arccos: { kind: 'FUNC', value: 'arccos' },
  arctangent: { kind: 'FUNC', value: 'arctan' },
  arctan: { kind: 'FUNC', value: 'arctan' },
  log: { kind: 'FUNC', value: 'log' },
  logarithm: { kind: 'FUNC', value: 'log' },
  ln: { kind: 'FUNC', value: 'ln' },
  // Greek letters as variables
  theta: { kind: 'VAR', value: 'theta' },
  alpha: { kind: 'VAR', value: 'alpha' },
  beta: { kind: 'VAR', value: 'beta' },
  gamma: { kind: 'VAR', value: 'gamma' },
  phi: { kind: 'VAR', value: 'phi' },
  omega: { kind: 'VAR', value: 'omega' },
  // differentials (Whisper writes "dx" as one word)
  dx: { kind: 'DIFF', value: 'x' },
  dy: { kind: 'DIFF', value: 'y' },
  dz: { kind: 'DIFF', value: 'z' },
  dt: { kind: 'DIFF', value: 't' },
  du: { kind: 'DIFF', value: 'u' },
  dv: { kind: 'DIFF', value: 'v' },
  dr: { kind: 'DIFF', value: 'r' },
  dtheta: { kind: 'DIFF', value: 'theta' },
  // fraction words: value is "<denominator>|<singular or plural>"
  half: { kind: 'FRACWORD', value: '2|s' },
  halves: { kind: 'FRACWORD', value: '2|p' },
  third: { kind: 'FRACWORD', value: '3|s' },
  thirds: { kind: 'FRACWORD', value: '3|p' },
  quarter: { kind: 'FRACWORD', value: '4|s' },
  quarters: { kind: 'FRACWORD', value: '4|p' },
  fourth: { kind: 'FRACWORD', value: '4|s' },
  fourths: { kind: 'FRACWORD', value: '4|p' },
  fifth: { kind: 'FRACWORD', value: '5|s' },
  fifths: { kind: 'FRACWORD', value: '5|p' },
  sixth: { kind: 'FRACWORD', value: '6|s' },
  sixths: { kind: 'FRACWORD', value: '6|p' },
  seventh: { kind: 'FRACWORD', value: '7|s' },
  sevenths: { kind: 'FRACWORD', value: '7|p' },
  eighth: { kind: 'FRACWORD', value: '8|s' },
  eighths: { kind: 'FRACWORD', value: '8|p' },
  ninth: { kind: 'FRACWORD', value: '9|s' },
  ninths: { kind: 'FRACWORD', value: '9|p' },
  tenth: { kind: 'FRACWORD', value: '10|s' },
  tenths: { kind: 'FRACWORD', value: '10|p' },
};

/** Words silently skipped when nothing else matches at their position. */
const FILLERS = new Set(['the', 'an', 'and', 'um', 'uh', 'please', 'then', 'so', 'okay']);
// NOTE: "a" is a VARIABLE (needed for "four a c", "a plus b", the quadratic
// formula...) except directly before a singular fraction word ("a half") or a
// number scale word ("a hundred"), where it reads as an article. See tokenize().

/** Normalize raw text (from ASR or typing) into a flat word list. */
export function normalizeWords(input: string): string[] {
  let s = input.toLowerCase();
  s = s.replace(/[’']/g, ''); // apostrophes: "what's" -> "whats"
  s = s.replace(/−/g, '-'); // unicode minus -> hyphen-minus
  s = s.replace(/(?<=[a-z])-(?=[a-z])/g, ' '); // word hyphens: twenty-one
  s = s.replace(/([+\-*/^%=<>()×÷≤≥±²³√∞])/g, ' $1 '); // pad math symbols
  s = s.replace(/(\d)(?=[a-z])/g, '$1 '); // "2x" -> "2 x"
  s = s.replace(/([a-z])(?=\d)/g, '$1 '); // "x2" -> "x 2"
  s = s.replace(/[,!?;:]/g, ' ');
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' '); // periods that are not decimal points
  return s.split(/\s+/).filter((w) => w.length > 0);
}

const MORE_FILLERS = new Set(['what', 'whats', 'answer']);

/** Short English words that must NOT be treated as glued variable runs. */
const ASR_STOP_WORDS = new Set([
  'it', 'is', 'or', 'at', 'on', 'in', 'up', 'as', 'be', 'by', 'we', 'he',
  'me', 'do', 'go', 'no', 'my', 'if', 'am', 'us', 'was', 'are', 'you',
  'not', 'out', 'off', 'for', 'get', 'got', 'can', 'yes', 'now', 'new',
]);

export function tokenize(input: string): Token[] {
  const words = normalizeWords(input);
  const tokens: Token[] = [];
  let i = 0;

  outer: while (i < words.length) {
    // 1. Multi-word phrases, longest first.
    for (const [phrase, kind, value] of PHRASES) {
      if (i + phrase.length <= words.length) {
        let match = true;
        for (let k = 0; k < phrase.length; k++) {
          if (words[i + k] !== phrase[k]) { match = false; break; }
        }
        if (match) {
          tokens.push({ kind, ...(value !== undefined ? { value } : {}), pos: i, raw: phrase.join(' ') });
          i += phrase.length;
          continue outer;
        }
      }
    }

    const w = words[i]!;

    // 2. Numbers (word runs like "twenty one point five", or digit tokens).
    if (isNumberStart(w)) {
      const folded = foldNumber(words, i);
      if (folded) {
        tokens.push({ kind: 'NUMBER', value: folded.value, pos: i, raw: words.slice(i, folded.next).join(' ') });
        i = folded.next;
        continue;
      }
    }

    // 3. Single-word keywords, functions, Greek letters, fraction words, symbols.
    const entry = WORD_MAP[w];
    if (entry) {
      tokens.push({ kind: entry.kind, ...(entry.value !== undefined ? { value: entry.value } : {}), pos: i, raw: w });
      i++;
      continue;
    }

    // 4. "a": article before "half"/"third"/… or "hundred"/"thousand",
    //    otherwise the variable a ("four a c", "a plus b").
    if (w === 'a') {
      const next = words[i + 1];
      const nextEntry = next !== undefined ? WORD_MAP[next] : undefined;
      const isArticle =
        (nextEntry?.kind === 'FRACWORD' && nextEntry.value!.endsWith('|s')) ||
        next === 'hundred' || next === 'thousand';
      if (isArticle) {
        i++; // drop the article; the fraction/number word is handled next
        continue;
      }
      tokens.push({ kind: 'VAR', value: 'a', pos: i, raw: w });
      i++;
      continue;
    }

    // 5. Other single-letter variables.
    if (/^[b-z]$/.test(w)) {
      tokens.push({ kind: 'VAR', value: w, pos: i, raw: w });
      i++;
      continue;
    }

    // 6. Fillers.
    if (FILLERS.has(w) || MORE_FILLERS.has(w)) {
      i++;
      continue;
    }

    // 7. Glued variable runs from ASR: Whisper writes "four a c" as "4ac",
    //    which normalization splits into "4" + "ac". A short unknown letter
    //    run becomes single-letter variables (a·c) — except common English
    //    words, which are far more likely mis-dictations worth surfacing.
    if (/^[a-z]{2,3}$/.test(w) && !ASR_STOP_WORDS.has(w)) {
      for (const letter of w) {
        tokens.push({ kind: 'VAR', value: letter, pos: i, raw: w });
      }
      i++;
      continue;
    }

    throw new ParseError(
      `I didn't recognize the word "${w}". Try math words like "plus", "over", "squared", or spell a variable letter.`,
      i,
      w,
    );
  }

  tokens.push({ kind: 'EOF', pos: words.length, raw: '' });
  return tokens;
}

/**
 * True when the phrase tokenizes cleanly into at least one math token —
 * i.e. every word is in the spoken-math vocabulary. Used by consumers (e.g.
 * the personalization layer) to decide whether a phrase is safe to map INTO.
 */
export function isRecognizedPhrase(phrase: string): boolean {
  if (!phrase.trim()) return false;
  try {
    return tokenize(phrase).length > 1; // more than just EOF (pure fillers don't count)
  } catch {
    return false;
  }
}
