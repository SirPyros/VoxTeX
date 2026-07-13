/** Folding of spoken number words ("negative three point five", "twenty one",
 * "one hundred five") into decimal literal strings. */

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const DIGIT_RE = /^\d+(\.\d+)?$/;

export function isNumberStart(word: string): boolean {
  return (
    word in ONES || word in TEENS || word in TENS ||
    word === 'hundred' || word === 'thousand' || word === 'point' ||
    DIGIT_RE.test(word)
  );
}

export interface FoldResult {
  /** Decimal literal, e.g. "21", "3.14". */
  value: string;
  /** Index of the first word NOT consumed. */
  next: number;
}

/**
 * Fold a run of number words starting at `words[start]` into a decimal string.
 * Returns null if no number could be read.
 */
export function foldNumber(words: string[], start: number): FoldResult | null {
  let i = start;
  const first = words[i];
  if (first === undefined) return null;

  // A literal digit token ("3", "3.5") is taken verbatim.
  if (DIGIT_RE.test(first)) {
    return { value: first, next: i + 1 };
  }

  let total = 0;
  let current = 0;
  let consumedInt = false;

  while (i < words.length) {
    const w = words[i]!;
    if (w in ONES) {
      current += ONES[w]!;
    } else if (w in TEENS) {
      current += TEENS[w]!;
    } else if (w in TENS) {
      current += TENS[w]!;
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
    } else if (w === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else {
      break;
    }
    consumedInt = true;
    i++;
  }
  total += current;

  // Decimal part: "point" followed by single-digit words (or one digit token).
  let decimals = '';
  if (words[i] === 'point') {
    const j = i + 1;
    let k = j;
    while (k < words.length) {
      const w = words[k]!;
      if (w in ONES) {
        decimals += String(ONES[w]!);
        k++;
      } else if (/^\d+$/.test(w)) {
        decimals += w;
        k++;
      } else {
        break;
      }
    }
    if (decimals.length === 0) {
      // "point" with no digits after it — do not consume it here.
      if (!consumedInt) return null;
      return { value: String(total), next: i };
    }
    i = k;
  }

  if (!consumedInt && decimals.length === 0) return null;
  return { value: decimals ? `${total}.${decimals}` : String(total), next: i };
}
