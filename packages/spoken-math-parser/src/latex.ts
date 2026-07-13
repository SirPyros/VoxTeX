import type { FuncName, MathNode } from './ast';

const FUNC_LATEX: Record<FuncName, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  sec: '\\sec',
  csc: '\\csc',
  cot: '\\cot',
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  log: '\\log',
  ln: '\\ln',
};

/** Variables: single letters as-is, Greek names as commands ("theta" -> \theta). */
function varLatex(name: string): string {
  return name.length > 1 ? `\\${name}` : name;
}

/**
 * Emit LaTeX from an AST.
 *
 * Grouping nodes ("open paren", "the quantity") render as \left( ... \right),
 * except in slots where the notation already isolates the content
 * (fraction numerator/denominator, root and abs arguments, exponents) —
 * there the redundant parens are stripped for cleaner output.
 */
export function toLatex(node: MathNode): string {
  return emit(node).trim();
}

/** Strip one explicit grouping layer in slots that already isolate content. */
function bare(node: MathNode): string {
  return emit(node.type === 'group' ? node.arg : node);
}

/**
 * Wide bodies (sum, derivative) get parens when the top level is an operator,
 * so \sum n^2+n can't be misread — it renders as \sum(n^2+n).
 */
function wideBody(body: MathNode): string {
  const inner = bare(body).trim();
  if (body.type === 'bin' || body.type === 'neg' || body.type === 'rel') {
    return `\\left(${inner}\\right)`;
  }
  return inner;
}

/** \sin(x), \log_{2}(x); exponent (if any) sits between name and argument. */
function emitFunc(node: Extract<MathNode, { type: 'func' }>, exponent: string | null): string {
  const sub = node.base !== undefined ? `_{${bare(node.base).trim()}}` : '';
  const exp = exponent !== null ? `^{${exponent}}` : '';
  return `${FUNC_LATEX[node.name]}${sub}${exp}\\left(${bare(node.arg).trim()}\\right)`;
}

function emit(node: MathNode): string {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'var':
      // Trailing space after a command so juxtaposition stays valid LaTeX.
      return node.name.length > 1 ? `${varLatex(node.name)} ` : node.name;
    case 'const':
      return node.name === 'pi' ? '\\pi ' : '\\infty ';
    case 'group':
      return `\\left(${emit(node.arg)}\\right)`;
    case 'neg': {
      const inner = node.arg;
      // Defensive: the grammar shouldn't produce a bare sum/relation under
      // negation, but parenthesize if it ever does.
      if (inner.type === 'bin' && (inner.op === 'plus' || inner.op === 'minus' || inner.op === 'pm')) {
        return `-\\left(${emit(inner)}\\right)`;
      }
      return `-${emit(inner)}`;
    }
    case 'bin': {
      const l = emit(node.left);
      const r = node.right.type === 'neg'
        ? `\\left(${emit(node.right)}\\right)` // e.g. x \times (-2), 2 - (-3)
        : emit(node.right);
      switch (node.op) {
        case 'plus': return `${l}+${r}`;
        case 'minus': return `${l}-${r}`;
        case 'pm': return `${l}\\pm ${r}`;
        case 'times': return `${l}\\times ${r}`;
        case 'div': return `${l}\\div ${r}`;
        case 'imp': return `${l}${r}`;
      }
      break;
    }
    case 'frac':
      return `\\frac{${bare(node.num).trim()}}{${bare(node.den).trim()}}`;
    case 'pow': {
      // "sine squared of x" -> \sin^{2}(x), exponent between name and argument
      if (node.base.type === 'func') {
        return emitFunc(node.base, bare(node.exp).trim());
      }
      const needsParens =
        node.base.type === 'pow' || node.base.type === 'neg' ||
        node.base.type === 'bin' || node.base.type === 'frac' ||
        node.base.type === 'integral';
      const base = needsParens ? `\\left(${emit(node.base)}\\right)` : emit(node.base);
      return `${base}^{${bare(node.exp).trim()}}`;
    }
    case 'func':
      return emitFunc(node, null);
    case 'integral': {
      const bounds =
        node.from !== undefined && node.to !== undefined
          ? `_{${bare(node.from).trim()}}^{${bare(node.to).trim()}}`
          : ' ';
      const diff = node.variable !== undefined ? `\\,d${varLatex(node.variable)}` : '';
      return `\\int${bounds}${emit(node.body).trim()}${diff}`;
    }
    case 'sum': {
      const lower =
        node.from !== undefined
          ? `_{${node.index !== undefined ? `${varLatex(node.index)}=` : ''}${bare(node.from).trim()}}`
          : '';
      const upper = node.to !== undefined ? `^{${bare(node.to).trim()}}` : '';
      const spacer = lower === '' && upper === '' ? ' ' : '';
      return `\\sum${lower}${upper}${spacer}${wideBody(node.body)}`;
    }
    case 'derivative': {
      const v = varLatex(node.variable ?? 'x');
      const op =
        node.order === 1
          ? `\\frac{d}{d${v}}`
          : `\\frac{d^{${node.order}}}{d${v}^{${node.order}}}`;
      return `${op}${wideBody(node.body)}`;
    }
    case 'prime': {
      const primes = "'".repeat(node.order);
      const app = node.arg !== undefined ? `\\left(${bare(node.arg).trim()}\\right)` : '';
      return `${emit(node.base).trim()}${primes}${app}`;
    }
    case 'root':
      return node.index === 3
        ? `\\sqrt[3]{${bare(node.arg).trim()}}`
        : `\\sqrt{${bare(node.arg).trim()}}`;
    case 'abs':
      return `\\left|${bare(node.arg).trim()}\\right|`;
    case 'percent':
      return `${emit(node.arg)}\\%`;
    case 'rel': {
      const l = emit(node.left);
      const r = emit(node.right);
      switch (node.op) {
        case 'eq': return `${l}=${r}`;
        case 'lt': return `${l}<${r}`;
        case 'gt': return `${l}>${r}`;
        case 'le': return `${l}\\le ${r}`;
        case 'ge': return `${l}\\ge ${r}`;
      }
    }
  }
}
