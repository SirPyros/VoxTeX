import { describe, expect, it } from 'vitest';
import { ParseError, parseSpokenMath, toSpeech } from '../src/index';

function latex(phrase: string): string {
  return parseSpokenMath(phrase).latex;
}

describe('numbers', () => {
  it.each<[string, string]>([
    ['three', '3'],
    ['negative three point five', '-3.5'],
    ['twenty one', '21'],
    ['twenty-one', '21'],
    ['one hundred five', '105'],
    ['three point one four', '3.14'],
    ['zero point five', '0.5'],
    ['two thousand twenty six', '2026'],
    ['3.5', '3.5'], // ASR often emits digits directly
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('variables, constants, basic operators', () => {
  it.each<[string, string]>([
    ['x', 'x'],
    ['pi', '\\pi'],
    ['x plus two', 'x+2'],
    ['y minus four', 'y-4'],
    ['two times x', '2\\times x'],
    ['six divided by two', '6\\div 2'],
    ['x multiplied by y', 'x\\times y'],
    ['minus x', '-x'],
    ['negative x', '-x'],
    ['two minus negative three', '2-\\left(-3\\right)'],
    ['fifty percent', '50\\%'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('fractions and the "over" ambiguity rule', () => {
  // THE documented rule: "over" binds tightly. "one over x plus two"
  // is (1/x) + 2. To get 1/(x+2), say "the quantity" or "all over".
  it('one over x plus two -> tight fraction plus two', () => {
    expect(latex('one over x plus two')).toBe('\\frac{1}{x}+2');
  });

  it('one over the quantity x plus two end quantity -> wide fraction', () => {
    expect(latex('one over the quantity x plus two end quantity')).toBe('\\frac{1}{x+2}');
  });

  it('x plus one all over two -> "all over" grabs the whole left side', () => {
    expect(latex('x plus one all over two')).toBe('\\frac{x+1}{2}');
  });

  it.each<[string, string]>([
    ['one over x', '\\frac{1}{x}'],
    ['x plus y all over x minus y', '\\frac{x+y}{x-y}'],
    // implicit multiplication binds tighter than "over":
    ['one over two x', '\\frac{1}{2x}'],
    // postfix binds tighter than "over":
    ['x over two squared', '\\frac{x}{2^{2}}'],
    // "over" binds tighter than explicit "times":
    ['two times x over three', '2\\times \\frac{x}{3}'],
    ['one over negative two', '\\frac{1}{-2}'],
    ['1/2', '\\frac{1}{2}'], // ASR slash form
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('powers and roots', () => {
  it.each<[string, string]>([
    ['x squared', 'x^{2}'],
    ['y cubed', 'y^{3}'],
    ['two to the power of x', '2^{x}'],
    ['x to the power of negative two', 'x^{-2}'],
    // exponents are tight-level, so "over" stays inside the exponent:
    ['x to the power of two over three', 'x^{\\frac{2}{3}}'],
    ['square root of x', '\\sqrt{x}'],
    // function arguments bind tightly (documented):
    ['square root of x plus two', '\\sqrt{x}+2'],
    ['square root of the quantity x plus two end quantity', '\\sqrt{x+2}'],
    ['cube root of eight', '\\sqrt[3]{8}'],
    ['square root of two x', '\\sqrt{2x}'],
    // "over" binds looser than a function's tight argument:
    ['square root of x over two', '\\frac{\\sqrt{x}}{2}'],
    ['negative x squared', '-x^{2}'],
    ['the quantity x plus one end quantity squared', '\\left(x+1\\right)^{2}'],
    ['the quantity negative x end quantity squared', '\\left(-x\\right)^{2}'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('absolute value, parens, grouping', () => {
  it.each<[string, string]>([
    ['absolute value of negative x', '\\left|-x\\right|'],
    ['the absolute value of x minus three', '\\left|x\\right|-3'],
    ['open paren x plus one close paren times three', '\\left(x+1\\right)\\times 3'],
    ['two times open paren x plus three close paren', '2\\times \\left(x+3\\right)'],
    ['two times the quantity x plus three end quantity', '2\\times \\left(x+3\\right)'],
    // implicit multiplication with grouping:
    ['two open paren x plus three close paren', '2\\left(x+3\\right)'],
    ['two pi r', '2\\pi r'],
    ['two x plus three', '2x+3'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });

  it('tolerates a missing "close paren" at the end of the utterance', () => {
    expect(latex('two times open paren x plus three')).toBe('2\\times \\left(x+3\\right)');
  });

  it('"the quantity" without "end quantity" extends to the end', () => {
    expect(latex('square root of the quantity x plus two')).toBe('\\sqrt{x+2}');
  });
});

describe('relations', () => {
  it.each<[string, string]>([
    ['x equals five', 'x=5'],
    ['x is equal to five', 'x=5'],
    ['x is five', 'x=5'],
    ['x is less than three', 'x<3'],
    ['x less than three', 'x<3'],
    ['y is greater than or equal to two', 'y\\ge 2'],
    ['y is less than or equal to negative one', 'y\\le -1'],
    ['x squared plus two x plus one equals zero', 'x^{2}+2x+1=0'],
    ['x plus one all over two equals three', '\\frac{x+1}{2}=3'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('ASR symbol robustness', () => {
  it.each<[string, string]>([
    ['1 + 2 = 3', '1+2=3'],
    ['2x + 3', '2x+3'],
    ['One over x, plus two.', '\\frac{1}{x}+2'],
    ['X squared minus 4', 'x^{2}-4'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('parse tree shape (ambiguity, structurally)', () => {
  it('"one over x plus two" is Plus(Frac(1,x), 2), not Frac(1, Plus(x,2))', () => {
    const { ast } = parseSpokenMath('one over x plus two');
    expect(ast.type).toBe('bin');
    if (ast.type === 'bin') {
      expect(ast.op).toBe('plus');
      expect(ast.left.type).toBe('frac');
      expect(ast.right).toEqual({ type: 'num', value: '2' });
    }
  });

  it('"x plus one all over two" is Frac(Plus(x,1), 2)', () => {
    const { ast } = parseSpokenMath('x plus one all over two');
    expect(ast.type).toBe('frac');
    if (ast.type === 'frac') {
      expect(ast.num.type).toBe('bin');
      expect(ast.den).toEqual({ type: 'num', value: '2' });
    }
  });
});

describe('speech read-back', () => {
  it('reads a tight fraction unambiguously', () => {
    const { ast } = parseSpokenMath('one over x plus two');
    expect(toSpeech(ast)).toBe('the fraction 1 over x, end fraction plus 2');
  });

  it('reads powers with squared/cubed shorthand', () => {
    const { speech } = parseSpokenMath('x squared plus y cubed');
    expect(speech).toBe('x squared plus y cubed');
  });
});

describe('fraction words', () => {
  it.each<[string, string]>([
    ['one half', '\\frac{1}{2}'],
    ['a half', '\\frac{1}{2}'],
    ['one third', '\\frac{1}{3}'],
    ['two thirds', '\\frac{2}{3}'],
    ['three quarters', '\\frac{3}{4}'],
    ['three fourths', '\\frac{3}{4}'],
    ['three halves', '\\frac{3}{2}'],
    ['seven tenths', '\\frac{7}{10}'],
    // mixed number: "and a" are fillers, singular denominator after 3 -> 3 + 1/2
    ['three and a half', '3+\\frac{1}{2}'],
    ['one half of x', '\\frac{1}{2}x'],
    ['two thirds x', '\\frac{2}{3}x'],
    ['one half squared', '\\left(\\frac{1}{2}\\right)^{2}'],
    ['x plus one half', 'x+\\frac{1}{2}'],
    ['one half plus one quarter', '\\frac{1}{2}+\\frac{1}{4}'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('trig and log', () => {
  it.each<[string, string]>([
    ['sine of x', '\\sin\\left(x\\right)'],
    ['sin of x', '\\sin\\left(x\\right)'],
    ['sign of x', '\\sin\\left(x\\right)'], // common Whisper spelling
    ['cosine of two x', '\\cos\\left(2x\\right)'],
    ['tangent of theta', '\\tan\\left(\\theta\\right)'],
    // function arguments bind tightly, same as square root:
    ['sine of x plus two', '\\sin\\left(x\\right)+2'],
    ['sine of the quantity x plus two end quantity', '\\sin\\left(x+2\\right)'],
    ['sine of x over two', '\\frac{\\sin\\left(x\\right)}{2}'],
    ['sine squared of x', '\\sin^{2}\\left(x\\right)'],
    ['cosine cubed of x', '\\cos^{3}\\left(x\\right)'],
    ['arc sine of x', '\\arcsin\\left(x\\right)'],
    ['inverse tangent of x', '\\arctan\\left(x\\right)'],
    ['secant of x', '\\sec\\left(x\\right)'],
    ['natural log of x', '\\ln\\left(x\\right)'],
    ['ln of x', '\\ln\\left(x\\right)'],
    ['log of x', '\\log\\left(x\\right)'],
    ['log base two of x', '\\log_{2}\\left(x\\right)'],
    ['two sine of x', '2\\sin\\left(x\\right)'], // implicit multiplication
    ['sine of two pi', '\\sin\\left(2\\pi\\right)'],
    [
      'sine squared of x plus cosine squared of x',
      '\\sin^{2}\\left(x\\right)+\\cos^{2}\\left(x\\right)',
    ],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('Greek letters', () => {
  it.each<[string, string]>([
    ['theta', '\\theta'],
    ['two theta', '2\\theta'],
    ['alpha plus beta', '\\alpha +\\beta'],
    ['sine of two theta', '\\sin\\left(2\\theta\\right)'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('integrals', () => {
  it.each<[string, string]>([
    ['integral of x squared dx', '\\int x^{2}\\,dx'],
    ['the integral from zero to one of x squared dx', '\\int_{0}^{1}x^{2}\\,dx'],
    ['integral from zero to pi of sine of x dx', '\\int_{0}^{\\pi}\\sin\\left(x\\right)\\,dx'],
    ['integral from negative one to one of x cubed dx', '\\int_{-1}^{1}x^{3}\\,dx'],
    ['integral of x squared with respect to x', '\\int x^{2}\\,dx'],
    ['integral of one over x dx', '\\int \\frac{1}{x}\\,dx'],
    // the dx delimits the body, so "plus five" lands outside the integral:
    ['integral of two x dx plus five', '\\int 2x\\,dx+5'],
    // without dx the body extends to the end (same rule as "the quantity"):
    ['integral of x squared plus one', '\\int x^{2}+1'],
    ['integral of sine of theta d theta', '\\int \\sin\\left(\\theta\\right)\\,d\\theta'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });

  it('requires "to" after a lower bound', () => {
    expect(() => parseSpokenMath('integral from zero of x dx')).toThrowError(ParseError);
  });
});

describe('speech read-back for new vocabulary', () => {
  it('reads function powers unambiguously', () => {
    const { speech } = parseSpokenMath('sine squared of x');
    expect(speech).toBe('the sine squared of x, end function');
  });

  it('reads integrals with bounds', () => {
    const { speech } = parseSpokenMath('integral from zero to one of x squared dx');
    expect(speech).toBe('the integral from 0 to 1 of x squared, d x, end integral');
  });

  it('reads log bases', () => {
    const { speech } = parseSpokenMath('log base two of x');
    expect(speech).toBe('log base 2 of x, end function');
  });
});

describe('ordinal powers', () => {
  it.each<[string, string]>([
    ['x to the fourth', 'x^{4}'],
    ['x to the fourth power', 'x^{4}'],
    ['x to the fifth power', 'x^{5}'],
    ['two to the tenth power', '2^{10}'],
    ['x to the nth power', 'x^{n}'],
    ['x to the second power', 'x^{2}'],
    ['x to the fourth plus one', 'x^{4}+1'],
    // regression guards: fraction words and "to the power of" still work
    ['three fourths', '\\frac{3}{4}'],
    ['x to the power of four', 'x^{4}'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('summations', () => {
  it.each<[string, string]>([
    ['sum from n equals one to ten of n squared', '\\sum_{n=1}^{10}n^{2}'],
    [
      'the summation from n equals zero to infinity of one over n',
      '\\sum_{n=0}^{\\infty}\\frac{1}{n}',
    ],
    ['sum of x', '\\sum x'],
    ['sum from one to ten of n', '\\sum_{1}^{10}n'],
    // wide body gets parens so the rendering is unambiguous:
    ['sum from n equals one to ten of n squared plus n', '\\sum_{n=1}^{10}\\left(n^{2}+n\\right)'],
    ['some from n equals one to ten of n', '\\sum_{n=1}^{10}n'], // Whisper spelling
    ['sum from k equals one to n of k', '\\sum_{k=1}^{n}k'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });

  it('requires "to" after a lower bound', () => {
    expect(() => parseSpokenMath('sum from n equals one of n')).toThrowError(ParseError);
  });
});

describe('derivatives', () => {
  it.each<[string, string]>([
    ['derivative of x squared', '\\frac{d}{dx}x^{2}'],
    ['the derivative of x squared plus three x with respect to x', '\\frac{d}{dx}\\left(x^{2}+3x\\right)'],
    ['second derivative of x cubed', '\\frac{d^{2}}{dx^{2}}x^{3}'],
    ['derivative of sine of theta with respect to theta', '\\frac{d}{d\\theta}\\sin\\left(\\theta\\right)'],
    ['f prime of x', "f'\\left(x\\right)"],
    ['y double prime', "y''"],
    ['f prime prime of x', "f''\\left(x\\right)"],
    ['f prime of x equals two x', "f'\\left(x\\right)=2x"],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('speech read-back for sums and derivatives', () => {
  it('reads summations with index and bounds', () => {
    const { speech } = parseSpokenMath('sum from n equals one to ten of n squared');
    expect(speech).toBe('the sum from n equals 1 to 10 of n squared, end sum');
  });

  it('reads derivatives', () => {
    const { speech } = parseSpokenMath('second derivative of x cubed with respect to x');
    expect(speech).toBe('the second derivative of x cubed, with respect to x, end derivative');
  });

  it('reads primes', () => {
    const { speech } = parseSpokenMath('f prime of x');
    expect(speech).toBe('f prime of x');
  });
});

describe('plus or minus, and "a" as a variable', () => {
  it.each<[string, string]>([
    ['x plus or minus two', 'x\\pm 2'],
    ['a plus b', 'a+b'],
    ['four a c', '4ac'],
    ['a squared plus b squared', 'a^{2}+b^{2}'],
    ['b squared minus four a c', 'b^{2}-4ac'],
    // "a" is still an article before fraction words and number scales:
    ['a half', '\\frac{1}{2}'],
    ['three and a half', '3+\\frac{1}{2}'],
    ['a hundred five', '105'],
  ])('%s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });
});

describe('the quadratic formula', () => {
  // Canonical phrasing. Note the two structural markers:
  //  - "the quantity ... end quantity" scopes the square root's argument, and
  //    "end quantity" must be said BEFORE "all over" (otherwise the fraction
  //    would be swallowed into the root's argument);
  //  - "all over" makes everything said so far the numerator.
  const PHRASE =
    'x equals negative b plus or minus the square root of the quantity ' +
    'b squared minus four a c end quantity all over two a';

  it('parses to the textbook LaTeX', () => {
    expect(latex(PHRASE)).toBe('x=\\frac{-b\\pm \\sqrt{b^{2}-4ac}}{2a}');
  });

  it('reads back unambiguously', () => {
    const { speech } = parseSpokenMath(PHRASE);
    expect(speech).toBe(
      'x equals the fraction negative b plus or minus the square root of ' +
        'the quantity b squared minus 4 a c end quantity, end root over 2 a, end fraction',
    );
  });

  it.each<[string, string]>([
    // Whisper often glues spoken letters onto digits: "four a c" -> "4ac"
    ['b squared minus 4ac', 'b^{2}-4ac'],
    ['ac', 'ac'],
    ['xy plus two', 'xy+2'],
    ['2ab squared', '2ab^{2}'],
    // ...or emits the formula symbolically, including ² and √:
    ['x = -b ± √(b² - 4ac) / 2a', 'x=-b\\pm \\frac{\\sqrt{b^{2}-4ac}}{2a}'],
  ])('ASR glued/symbol form: %s -> %s', (phrase, expected) => {
    expect(latex(phrase)).toBe(expected);
  });

  it('does not split common English words into variables', () => {
    expect(() => parseSpokenMath('x plus you')).toThrowError(ParseError);
    expect(() => parseSpokenMath('for')).toThrowError(ParseError);
  });

  it('keeps the discriminant inside the root and the 2a in the denominator', () => {
    const { ast } = parseSpokenMath(PHRASE);
    expect(ast.type).toBe('rel');
    if (ast.type !== 'rel') return;
    expect(ast.right.type).toBe('frac');
    if (ast.right.type !== 'frac') return;
    expect(ast.right.num.type).toBe('bin'); // -b ± √(...)
    if (ast.right.num.type === 'bin') {
      expect(ast.right.num.op).toBe('pm');
      expect(ast.right.num.right.type).toBe('root');
    }
  });
});

describe('errors', () => {
  it('rejects unknown words with a helpful message', () => {
    expect(() => parseSpokenMath('hello world')).toThrowError(ParseError);
    expect(() => parseSpokenMath('hello world')).toThrowError(/hello/);
  });

  it('rejects empty input', () => {
    expect(() => parseSpokenMath('')).toThrowError(ParseError);
  });

  it('rejects trailing binary operators', () => {
    expect(() => parseSpokenMath('x plus')).toThrowError(ParseError);
  });

  it('rejects two numbers in a row', () => {
    expect(() => parseSpokenMath('two open paren x close paren five')).toThrowError(ParseError);
  });
});
