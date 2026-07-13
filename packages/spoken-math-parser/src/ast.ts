/** AST node types for spoken-math expressions. Pure data — no DOM, no deps. */

export type BinOp = 'plus' | 'minus' | 'pm' | 'times' | 'div' | 'imp';
export type RelOp = 'eq' | 'lt' | 'gt' | 'le' | 'ge';

export type MathNode =
  | NumNode
  | VarNode
  | ConstNode
  | BinNode
  | FracNode
  | RelNode
  | NegNode
  | PowNode
  | RootNode
  | AbsNode
  | PercentNode
  | GroupNode
  | FuncNode
  | IntegralNode
  | SumNode
  | DerivativeNode
  | PrimeNode;

export interface NumNode {
  type: 'num';
  /** Decimal literal as a string, e.g. "3.5", "105". */
  value: string;
}

export interface VarNode {
  type: 'var';
  name: string;
}

export interface ConstNode {
  type: 'const';
  name: 'pi' | 'infinity';
}

/** Binary +, -, explicit times, explicit "divided by", or implicit multiplication. */
export interface BinNode {
  type: 'bin';
  op: BinOp;
  left: MathNode;
  right: MathNode;
}

/** A fraction produced by "over" or "all over". */
export interface FracNode {
  type: 'frac';
  num: MathNode;
  den: MathNode;
}

export interface RelNode {
  type: 'rel';
  op: RelOp;
  left: MathNode;
  right: MathNode;
}

export interface NegNode {
  type: 'neg';
  arg: MathNode;
}

export interface PowNode {
  type: 'pow';
  base: MathNode;
  exp: MathNode;
}

/** Square root (index 2) or cube root (index 3). */
export interface RootNode {
  type: 'root';
  index: 2 | 3;
  arg: MathNode;
}

export interface AbsNode {
  type: 'abs';
  arg: MathNode;
}

export interface PercentNode {
  type: 'percent';
  arg: MathNode;
}

/** Explicit grouping: "open paren ... close paren" or "the quantity ... end quantity". */
export interface GroupNode {
  type: 'group';
  arg: MathNode;
}

export type FuncName =
  | 'sin' | 'cos' | 'tan' | 'sec' | 'csc' | 'cot'
  | 'arcsin' | 'arccos' | 'arctan'
  | 'log' | 'ln';

/** Named function application: "sine of x", "log base two of x". */
export interface FuncNode {
  type: 'func';
  name: FuncName;
  arg: MathNode;
  /** Only for log: "log base two of x" -> base = 2. */
  base?: MathNode;
}

/** "the integral (from a to b) of BODY (dx | with respect to x)". */
export interface IntegralNode {
  type: 'integral';
  body: MathNode;
  /** Variable of integration ("x" for dx); may be a Greek name like "theta". */
  variable?: string;
  from?: MathNode;
  to?: MathNode;
}

/** "the sum from n equals one to ten of BODY". */
export interface SumNode {
  type: 'sum';
  body: MathNode;
  /** Summation index ("n" in "from n equals one"). */
  index?: string;
  from?: MathNode;
  to?: MathNode;
}

/** "the (second) derivative of BODY (with respect to x)". */
export interface DerivativeNode {
  type: 'derivative';
  body: MathNode;
  /** Differentiation variable; rendering defaults to "x" when omitted. */
  variable?: string;
  order: number;
}

/** Lagrange prime notation: "f prime", "y double prime", "f prime of x". */
export interface PrimeNode {
  type: 'prime';
  base: MathNode;
  order: number;
  /** Optional application argument: "f prime of x" -> f'(x). */
  arg?: MathNode;
}
