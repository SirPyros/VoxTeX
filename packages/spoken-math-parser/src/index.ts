import type { MathNode } from './ast';
import { toLatex } from './latex';
import { parsePhrase } from './parser';
import { toSpeech } from './speech';
import { ParseError, Token, tokenize } from './tokenizer';

export type { MathNode, BinNode, DerivativeNode, FracNode, FuncName, FuncNode, GroupNode, IntegralNode, NumNode, PowNode, PrimeNode, RelNode, RootNode, SumNode, VarNode } from './ast';
export { ParseError, tokenize, normalizeWords } from './tokenizer';
export type { Token, TokenKind } from './tokenizer';
export { toLatex } from './latex';
export { toSpeech } from './speech';

export interface ParseResult {
  /** LaTeX rendering of the parsed expression. */
  latex: string;
  /** The parse tree (useful for debugging and alternate renderers). */
  ast: MathNode;
  /** Token stream, for debug display. */
  tokens: Token[];
  /** Unambiguous spoken-English read-back of the parsed expression. */
  speech: string;
}

/** Parse a spoken/typed math phrase. Throws ParseError on failure. */
export function parseSpokenMath(input: string): ParseResult {
  const { ast, tokens } = parsePhrase(input);
  return { latex: toLatex(ast), ast, tokens, speech: toSpeech(ast) };
}

export type TryParseResult =
  | { ok: true; result: ParseResult }
  | { ok: false; error: ParseError };

/** Non-throwing variant of parseSpokenMath. */
export function tryParseSpokenMath(input: string): TryParseResult {
  try {
    return { ok: true, result: parseSpokenMath(input) };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e };
    throw e;
  }
}
