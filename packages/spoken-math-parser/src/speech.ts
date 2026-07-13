import type { FuncName, MathNode } from './ast';

const FUNC_SPEECH: Record<FuncName, string> = {
  sin: 'the sine',
  cos: 'the cosine',
  tan: 'the tangent',
  sec: 'the secant',
  csc: 'the cosecant',
  cot: 'the cotangent',
  arcsin: 'the inverse sine',
  arccos: 'the inverse cosine',
  arctan: 'the inverse tangent',
  log: 'log',
  ln: 'the natural log',
};

/**
 * Render an AST as unambiguous spoken English for read-back confirmation.
 * Deliberately mirrors the input vocabulary so what the student hears is
 * something they could say back. Used as the local fallback when
 * speech-rule-engine is unavailable; the web app prefers SRE.
 */
export function toSpeech(node: MathNode): string {
  return speak(node).replace(/\s+/g, ' ').trim();
}

/** "the sine of x", "the sine squared of x", "log base 2 of x". */
function speakFunc(node: Extract<MathNode, { type: 'func' }>, power: string | null): string {
  const name = FUNC_SPEECH[node.name];
  const base = node.base !== undefined ? ` base ${speak(node.base)}` : '';
  const pow = power !== null ? ` ${power}` : '';
  return `${name}${base}${pow} of ${speak(node.arg)}, end function`;
}

function speak(node: MathNode): string {
  switch (node.type) {
    case 'num':
      return node.value.startsWith('-') ? `negative ${node.value.slice(1)}` : node.value;
    case 'var':
      return node.name;
    case 'const':
      return node.name === 'pi' ? 'pi' : 'infinity';
    case 'group':
      return `the quantity ${speak(node.arg)} end quantity`;
    case 'neg':
      return `negative ${speak(node.arg)}`;
    case 'bin':
      switch (node.op) {
        case 'plus': return `${speak(node.left)} plus ${speak(node.right)}`;
        case 'minus': return `${speak(node.left)} minus ${speak(node.right)}`;
        case 'pm': return `${speak(node.left)} plus or minus ${speak(node.right)}`;
        case 'times': return `${speak(node.left)} times ${speak(node.right)}`;
        case 'div': return `${speak(node.left)} divided by ${speak(node.right)}`;
        case 'imp': return `${speak(node.left)} ${speak(node.right)}`;
      }
      break;
    case 'frac':
      return `the fraction ${speak(node.num)} over ${speak(node.den)}, end fraction`;
    case 'pow': {
      // "sine squared of x", not the ambiguous "the sine of x squared"
      if (node.base.type === 'func' && node.exp.type === 'num' &&
          (node.exp.value === '2' || node.exp.value === '3')) {
        const word = node.exp.value === '2' ? 'squared' : 'cubed';
        return speakFunc(node.base, word);
      }
      if (node.exp.type === 'num' && node.exp.value === '2') return `${speak(node.base)} squared`;
      if (node.exp.type === 'num' && node.exp.value === '3') return `${speak(node.base)} cubed`;
      return `${speak(node.base)} to the power of ${speak(node.exp)}, end exponent`;
    }
    case 'func':
      return speakFunc(node, null);
    case 'integral': {
      const bounds =
        node.from !== undefined && node.to !== undefined
          ? ` from ${speak(node.from)} to ${speak(node.to)}`
          : '';
      const diff = node.variable !== undefined ? `, d ${node.variable}` : '';
      return `the integral${bounds} of ${speak(node.body)}${diff}, end integral`;
    }
    case 'sum': {
      const lower =
        node.from !== undefined
          ? ` from ${node.index !== undefined ? `${node.index} equals ` : ''}${speak(node.from)}`
          : '';
      const upper = node.to !== undefined ? ` to ${speak(node.to)}` : '';
      return `the sum${lower}${upper} of ${speak(node.body)}, end sum`;
    }
    case 'derivative': {
      const ordinal = node.order === 2 ? 'second ' : node.order === 3 ? 'third ' : '';
      const wrt = node.variable !== undefined ? `, with respect to ${node.variable}` : '';
      return `the ${ordinal}derivative of ${speak(node.body)}${wrt}, end derivative`;
    }
    case 'prime': {
      const primes = node.order === 2 ? 'double prime' : node.order === 3 ? 'triple prime' : 'prime';
      const app = node.arg !== undefined ? ` of ${speak(node.arg)}` : '';
      return `${speak(node.base)} ${primes}${app}`;
    }
    case 'root':
      return node.index === 3
        ? `the cube root of ${speak(node.arg)}, end root`
        : `the square root of ${speak(node.arg)}, end root`;
    case 'abs':
      return `the absolute value of ${speak(node.arg)}, end absolute value`;
    case 'percent':
      return `${speak(node.arg)} percent`;
    case 'rel':
      switch (node.op) {
        case 'eq': return `${speak(node.left)} equals ${speak(node.right)}`;
        case 'lt': return `${speak(node.left)} is less than ${speak(node.right)}`;
        case 'gt': return `${speak(node.left)} is greater than ${speak(node.right)}`;
        case 'le': return `${speak(node.left)} is less than or equal to ${speak(node.right)}`;
        case 'ge': return `${speak(node.left)} is greater than or equal to ${speak(node.right)}`;
      }
  }
}
