import type { BinOp, FuncName, MathNode, RelOp } from './ast';
import { ParseError, Token, TokenKind, tokenize } from './tokenizer';

/**
 * Recursive-descent parser for spoken math.
 *
 * Precedence, loosest to tightest (see package README for rationale):
 *   1. relations         =, <, >, <=, >=
 *   2. "all over"        wide fraction: everything parsed so far on each side
 *   3. plus / minus      additive
 *   4. times / divided by
 *   5. unary sign        "negative x", leading "minus x"
 *   6. "over"            TIGHT fraction (the documented ambiguity rule)
 *   7. implicit multiplication   "two x", "two pi r", "two open paren ..."
 *   8. postfix           squared, cubed, percent, "to the power of"
 *   9. functions         square root of / cube root of / absolute value of
 *  10. primary           numbers, variables, pi, parens, "the quantity ..."
 */
class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.tokens[this.pos]!;
    if (t.kind !== 'EOF') this.pos++;
    return t;
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private eat(kind: TokenKind): Token | null {
    if (this.at(kind)) return this.next();
    return null;
  }

  private fail(expected: string): never {
    const t = this.peek();
    if (t.kind === 'EOF') {
      throw new ParseError(`The phrase ended early — I expected ${expected}.`, t.pos, null);
    }
    throw new ParseError(`I expected ${expected} but heard "${t.raw}".`, t.pos, t.raw);
  }

  parse(): MathNode {
    const node = this.parseRelation();
    if (!this.at('EOF')) {
      const t = this.peek();
      throw new ParseError(`I didn't expect "${t.raw}" after a complete expression.`, t.pos, t.raw);
    }
    return node;
  }

  // 1. relation := allOverExpr ((= | < | > | <= | >=) allOverExpr)?
  private parseRelation(): MathNode {
    const left = this.parseAllOver();
    const relMap: Partial<Record<TokenKind, RelOp>> = {
      EQ: 'eq', LT: 'lt', GT: 'gt', LE: 'le', GE: 'ge',
    };
    const op = relMap[this.peek().kind];
    if (op !== undefined) {
      this.next();
      const right = this.parseAllOver();
      return { type: 'rel', op, left, right };
    }
    return left;
  }

  // 2. allOver := sum ("all over" sum)*     -- wide fraction, left-assoc
  private parseAllOver(): MathNode {
    let node = this.parseSum();
    while (this.eat('ALLOVER')) {
      const den = this.parseSum();
      node = { type: 'frac', num: node, den };
    }
    return node;
  }

  // 3. sum := product ((plus | minus | plus or minus) product)*
  private parseSum(): MathNode {
    let node = this.parseProduct();
    for (;;) {
      let op: BinOp | null = null;
      if (this.eat('PLUS')) op = 'plus';
      else if (this.eat('MINUS')) op = 'minus';
      else if (this.eat('PM')) op = 'pm';
      if (!op) return node;
      const right = this.parseProduct();
      node = { type: 'bin', op, left: node, right };
    }
  }

  // 4. product := signed ((times | divided by) signed)*
  private parseProduct(): MathNode {
    let node = this.parseSigned();
    for (;;) {
      let op: BinOp | null = null;
      if (this.eat('TIMES')) op = 'times';
      else if (this.eat('DIV')) op = 'div';
      if (!op) return node;
      const right = this.parseSigned();
      node = { type: 'bin', op, left: node, right };
    }
  }

  // 5. signed := ("negative" | "minus") signed | tight
  private parseSigned(): MathNode {
    if (this.eat('NEG') || this.eat('MINUS')) {
      return { type: 'neg', arg: this.parseSigned() };
    }
    return this.parseTight();
  }

  // 6. tight := implicit ("over" overOperand)*    -- "over" binds tightly
  private parseTight(): MathNode {
    let node = this.parseImplicit();
    while (this.eat('OVER')) {
      const den = this.parseOverOperand();
      node = { type: 'frac', num: node, den };
    }
    return node;
  }

  // overOperand := ("negative"|"minus") overOperand | implicit
  private parseOverOperand(): MathNode {
    if (this.eat('NEG') || this.eat('MINUS')) {
      return { type: 'neg', arg: this.parseOverOperand() };
    }
    return this.parseImplicit();
  }

  /** Token kinds that may start a juxtaposed (implicitly multiplied) factor. */
  private static readonly IMPLICIT_STARTERS: ReadonlySet<TokenKind> = new Set<TokenKind>([
    'VAR', 'PI', 'LPAREN', 'QTY', 'SQRT', 'CBRT', 'ABS', 'FUNC',
  ]);

  // 7. implicit := postfix (postfix)*   -- "two x", "two pi r", "2 ( x + 3 )"
  private parseImplicit(): MathNode {
    let node = this.parsePostfix();
    while (Parser.IMPLICIT_STARTERS.has(this.peek().kind)) {
      const right = this.parsePostfix();
      node = { type: 'bin', op: 'imp', left: node, right };
    }
    return node;
  }

  // 8. postfix := func ("squared" | "cubed" | "percent" | "to the power of" expOperand
  //                     | "to the fourth (power)" | "prime"*)*
  private parsePostfix(): MathNode {
    let node = this.parseFunc();
    for (;;) {
      if (this.eat('SQUARED')) {
        node = { type: 'pow', base: node, exp: { type: 'num', value: '2' } };
      } else if (this.eat('CUBED')) {
        node = { type: 'pow', base: node, exp: { type: 'num', value: '3' } };
      } else if (this.eat('PERCENT')) {
        node = { type: 'percent', arg: node };
      } else if (this.eat('POW')) {
        const exp = this.parseExpOperand();
        node = { type: 'pow', base: node, exp };
      } else if (this.at('POWORD')) {
        const t = this.next();
        const exp: MathNode =
          t.value === 'n' ? { type: 'var', name: 'n' } : { type: 'num', value: t.value! };
        node = { type: 'pow', base: node, exp };
      } else if (this.at('PRIME')) {
        const t = this.next();
        const order = Number(t.value ?? '1');
        if (node.type === 'prime' && node.arg === undefined) {
          node = { ...node, order: node.order + order }; // "f prime prime"
        } else {
          node = { type: 'prime', base: node, order };
        }
        // "f prime of x" -> f'(x)
        if (this.eat('OF')) {
          node = { ...node, arg: this.parseFuncArg() };
        }
      } else {
        return node;
      }
    }
  }

  // expOperand := ("negative"|"minus") expOperand | tight
  // The exponent is tight-level, so "x to the power of two over three" -> x^(2/3).
  private parseExpOperand(): MathNode {
    if (this.eat('NEG') || this.eat('MINUS')) {
      return { type: 'neg', arg: this.parseExpOperand() };
    }
    return this.parseTight();
  }

  // 9. func := ("square root of" | "cube root of" | "absolute value of") funcArg
  //          | FUNC ("base" postfix)? ("squared" | "cubed")? "of"? funcArg
  //          | primary
  private parseFunc(): MathNode {
    if (this.eat('SQRT')) return { type: 'root', index: 2, arg: this.parseFuncArg() };
    if (this.eat('CBRT')) return { type: 'root', index: 3, arg: this.parseFuncArg() };
    if (this.eat('ABS')) return { type: 'abs', arg: this.parseFuncArg() };
    if (this.at('FUNC')) {
      const t = this.next();
      const name = t.value as FuncName;
      let base: MathNode | undefined;
      if (name === 'log' && this.eat('BASE')) {
        base = this.parsePostfix(); // "log base two", "log base ten"
      }
      // "sine squared of x" -> (sin x)^2
      let exp: MathNode | null = null;
      if (this.eat('SQUARED')) exp = { type: 'num', value: '2' };
      else if (this.eat('CUBED')) exp = { type: 'num', value: '3' };
      this.eat('OF'); // optional: "sine x" also accepted
      const arg = this.parseFuncArg();
      const fn: MathNode = base !== undefined
        ? { type: 'func', name, arg, base }
        : { type: 'func', name, arg };
      return exp ? { type: 'pow', base: fn, exp } : fn;
    }
    return this.parsePrimary();
  }

  // funcArg := ("negative"|"minus") funcArg | implicit
  // Function arguments bind tightly: "square root of x plus two" = sqrt(x) + 2.
  private parseFuncArg(): MathNode {
    if (this.eat('NEG') || this.eat('MINUS')) {
      return { type: 'neg', arg: this.parseFuncArg() };
    }
    return this.parseImplicit();
  }

  /**
   * Fraction words. Singular vs plural disambiguates (articles like "a"/"and"
   * are dropped as fillers before we get here):
   *   "one half"    -> 1/2      (numerator 1)
   *   "two thirds"  -> 2/3      (plural denominator)
   *   "three and a half" (seen as NUMBER(3) + singular "half") -> 3 + 1/2
   * An optional "of" multiplies: "one half of x" -> (1/2)x.
   */
  private finishFracWord(numerator: string | null): MathNode {
    const t = this.next(); // FRACWORD
    const [den, plurality] = t.value!.split('|') as [string, string];
    const denNode: MathNode = { type: 'num', value: den };
    let node: MathNode;
    if (numerator === null || numerator === '1' || plurality === 'p') {
      node = { type: 'frac', num: { type: 'num', value: numerator ?? '1' }, den: denNode };
    } else {
      // mixed number: "three and a half"
      node = {
        type: 'bin',
        op: 'plus',
        left: { type: 'num', value: numerator },
        right: { type: 'frac', num: { type: 'num', value: '1' }, den: denNode },
      };
    }
    if (this.eat('OF')) {
      return { type: 'bin', op: 'imp', left: node, right: this.parseFuncArg() };
    }
    return node;
  }

  // integral := "integral" ("from" signed "to" signed)? "of"? allOver (DIFF | "with respect to" VAR)?
  private parseIntegral(): MathNode {
    this.next(); // INTEGRAL
    let from: MathNode | undefined;
    let to: MathNode | undefined;
    if (this.eat('FROM')) {
      from = this.parseSigned();
      if (!this.eat('TO')) this.fail('"to" after the lower bound of the integral');
      to = this.parseSigned();
    }
    this.eat('OF');
    const body = this.parseAllOver();
    let variable: string | undefined;
    const diff = this.eat('DIFF');
    if (diff) {
      variable = diff.value!;
    } else if (this.eat('WRT')) {
      const v = this.eat('VAR');
      if (!v) this.fail('a variable after "with respect to"');
      variable = v.value!;
    }
    return {
      type: 'integral',
      body,
      ...(variable !== undefined ? { variable } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    };
  }

  // summation := "sum" ("from" (VAR "equals")? signed "to" signed)? "of"? allOver
  private parseSummation(): MathNode {
    this.next(); // SUM
    let index: string | undefined;
    let from: MathNode | undefined;
    let to: MathNode | undefined;
    if (this.eat('FROM')) {
      if (this.at('VAR') && this.peek(1).kind === 'EQ') {
        index = this.next().value!;
        this.next(); // EQ
      }
      from = this.parseSigned();
      if (!this.eat('TO')) this.fail('"to" after the lower bound of the sum');
      to = this.parseSigned();
    }
    this.eat('OF');
    const body = this.parseAllOver();
    return {
      type: 'sum',
      body,
      ...(index !== undefined ? { index } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    };
  }

  // derivative := "(first|second|third) derivative" "of"? allOver ("with respect to" VAR)?
  private parseDerivative(): MathNode {
    const t = this.next(); // DERIV
    const order = Number(t.value ?? '1');
    this.eat('OF');
    const body = this.parseAllOver();
    let variable: string | undefined;
    if (this.eat('WRT')) {
      const v = this.eat('VAR');
      if (!v) this.fail('a variable after "with respect to"');
      variable = v.value!;
    }
    return {
      type: 'derivative',
      body,
      order,
      ...(variable !== undefined ? { variable } : {}),
    };
  }

  // 10. primary := NUMBER FRACWORD? | FRACWORD | VAR | pi | infinity
  //              | integral | sum | derivative
  //              | "(" relation ")" | "the quantity" allOver ("end quantity")?
  private parsePrimary(): MathNode {
    const t = this.peek();
    switch (t.kind) {
      case 'NUMBER':
        this.next();
        if (this.at('FRACWORD')) return this.finishFracWord(t.value!);
        return { type: 'num', value: t.value! };
      case 'FRACWORD':
        return this.finishFracWord(null);
      case 'INTEGRAL':
        return this.parseIntegral();
      case 'SUM':
        return this.parseSummation();
      case 'DERIV':
        return this.parseDerivative();
      case 'INFINITY':
        this.next();
        return { type: 'const', name: 'infinity' };
      case 'VAR':
        this.next();
        return { type: 'var', name: t.value! };
      case 'PI':
        this.next();
        return { type: 'const', name: 'pi' };
      case 'LPAREN': {
        this.next();
        const inner = this.parseRelation();
        // Tolerate a missing "close paren" at the end of the utterance —
        // ASR frequently drops trailing words.
        if (!this.eat('RPAREN') && !this.at('EOF')) {
          this.fail('"close paren"');
        }
        return { type: 'group', arg: inner };
      }
      case 'QTY': {
        this.next();
        const inner = this.parseAllOver();
        this.eat('QTYEND'); // optional: quantity extends as far as the expression parses
        return { type: 'group', arg: inner };
      }
      default:
        this.fail('a number, a variable, or an expression');
    }
  }
}

export function parseTokens(tokens: Token[]): MathNode {
  return new Parser(tokens).parse();
}

export function parsePhrase(input: string): { ast: MathNode; tokens: Token[] } {
  const tokens = tokenize(input);
  if (tokens.length === 1) {
    // Only EOF: nothing usable was said.
    throw new ParseError('I didn\'t hear any math in that phrase.', 0, null);
  }
  const ast = parseTokens(tokens);
  return { ast, tokens };
}
