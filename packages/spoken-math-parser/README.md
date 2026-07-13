# @voxtex/spoken-math-parser

A deterministic, hand-rolled recursive-descent parser that converts transcribed
English math phrases into LaTeX. Pure TypeScript, **no DOM dependencies** — it can
be reused by any input lane (speech, ink, photo OCR) that produces a phrase string.

```ts
import { parseSpokenMath } from '@voxtex/spoken-math-parser';

const { latex, ast, tokens, speech } = parseSpokenMath('one over x plus two');
// latex  -> "\frac{1}{x}+2"
// speech -> "the fraction 1 over x, end fraction plus 2"
```

## Vocabulary (v1)

| Category | Words |
|---|---|
| Numbers | `zero`–`ninety-nine`, `hundred`, `thousand`, `point` decimals, `negative`, raw digits (`3.5`) |
| Fraction words | `one half`, `two thirds`, `three quarters/fourths`, … `tenths`; mixed numbers (`three and a half` → 3 + ½); `half of x` → ½·x |
| Variables | single letters `a`–`z` (`a` reads as an article only before fraction words — "a half" — or "a hundred/thousand"); Greek: `theta`, `alpha`, `beta`, `gamma`, `phi`, `omega` |
| Constants | `pi`, `infinity` |
| Operators | `plus`, `minus`, `plus or minus` (±), `times`, `multiplied by`, `divided by` |
| Fractions | `over` (tight), `all over` (wide) |
| Powers | `squared`, `cubed`, `to the power of`, ordinals `to the fourth (power)` … `tenth`, `to the nth power` |
| Roots | `square root of`, `cube root of` |
| Summations | `(the) sum/summation (from n equals a to b) of BODY`; `infinity` bounds |
| Derivatives | `(the) (first/second/third) derivative of BODY (with respect to x)`; primes: `f prime of x`, `y double prime` |
| Trig | `sine/cosine/tangent/secant/cosecant/cotangent (of)`, `sine squared of`, `arc/inverse sine…` (+ Whisper spellings `sign`, `cosign`, `sin`, `cos`, `tan`) |
| Logs | `log (of)`, `log base N of`, `natural log`, `ln` |
| Integrals | `(the) integral (from a to b) of BODY dx` — also `with respect to x`, `d theta` |
| Other functions | `absolute value of`, `percent` |
| Grouping | `open paren` / `close paren`, `the quantity ... end quantity` |
| Relations | `equals`, `is equal to`, `is`, `(is) less than (or equal to)`, `(is) greater than (or equal to)` |
| ASR symbols | `+ - * / ^ % = < > ( ) × ÷ ≤ ≥ π`, digit-glued forms like `2x` |

Unrecognized words raise a `ParseError` with the offending word and its position —
they are never silently dropped (except a small filler list: *the, a, an, and, um, uh, please...*).

## Precedence (loosest → tightest)

1. **Relations** — `=`, `<`, `>`, `≤`, `≥`
2. **`all over`** — wide fraction: takes the entire sum parsed so far as numerator
3. **`plus` / `minus`** — additive
4. **`times` / `divided by`** — multiplicative
5. **Unary sign** — `negative x`, leading `minus x`
6. **`over`** — TIGHT fraction (see ambiguity rule below)
7. **Implicit multiplication** — `two x`, `two pi r`, `2 (x + 3)`
8. **Postfix** — `squared`, `cubed`, `percent`, `to the power of`
9. **Functions** — `square root of`, `cube root of`, `absolute value of`
10. **Primary** — numbers, variables, `pi`, parens, `the quantity ...`

## The "over" ambiguity rule (documented, deterministic)

Spoken *"one over x plus two"* is genuinely ambiguous: 1/(x+2) or (1/x)+2?

**Rule: `over` binds tightly.** It takes the smallest complete operand on each side:

| Phrase | Result |
|---|---|
| `one over x plus two` | `\frac{1}{x}+2` |
| `one over the quantity x plus two end quantity` | `\frac{1}{x+2}` |
| `one over x all over two` (or `x plus one all over two`) | wide fraction — `all over` splits everything said so far |

Corollaries of the same tight/wide philosophy:

- **Implicit multiplication is tighter than `over`**: `one over two x` → `\frac{1}{2x}`.
- **Postfix is tighter than `over`**: `x over two squared` → `\frac{x}{2^{2}}`.
- **`over` is tighter than `times`**: `two times x over three` → `2\times\frac{x}{3}`.
- **Function arguments are tight**: `square root of x plus two` → `\sqrt{x}+2`,
  `sine of x plus two` → `\sin(x)+2`.
  Use `the quantity` to widen: `square root of the quantity x plus two` → `\sqrt{x+2}`.
- **Exponents are tight-level (they include `over`)**: `x to the power of two over three`
  → `x^{\frac{2}{3}}`.
- **Sum and derivative bodies are wide**, like integrals: `sum from n equals one
  to ten of n squared plus n` puts the `+n` inside the sum → `\sum(n^2+n)`, and a
  derivative body runs until `with respect to` or the end of the utterance.
  (A derivative without `with respect to` renders against `x` by default.)
- **Integral bodies are wide** — the `dx` is the delimiter:
  `integral of x squared plus one dx` → `\int x^2+1\,dx`, and anything after the
  `dx` is outside the integral. Without a `dx` the body extends to the end of
  the utterance (same rule as an unclosed `the quantity`).
- **Fraction-word plurality disambiguates mixed numbers**: `three halves` → 3/2,
  `three and a half` → 3 + 1/2. Caveat: since articles are dropped, `one and a
  half` collides with `one half` and parses as 1/2 — say `one point five` or
  `three halves`-style plurals instead.

## Worked example: the quadratic formula

> **x equals negative b plus or minus the square root of the quantity
> b squared minus four a c end quantity all over two a**

→ `x=\frac{-b\pm \sqrt{b^{2}-4ac}}{2a}`

Two structural markers do the work:

1. `the quantity … end quantity` scopes the square root's argument. Say
   `end quantity` **before** `all over` — without it, the quantity (and
   therefore the root) would swallow the rest of the sentence.
2. `all over` makes everything said so far the numerator, putting `2a` in the
   denominator.

## ASR-friendly leniency

- `close paren` / `end quantity` may be omitted at the end of an utterance
  (Whisper frequently drops trailing words).
- Digits, decimal digits, and glued forms (`2x`, `1/2`, `1 + 2 = 3`) are accepted,
  since Whisper often emits symbols instead of words — including `± ² ³ √ ( )`.
- Short glued letter runs become variable products: Whisper writes spoken
  "four a c" as `4ac`, which parses as 4·a·c. Common English words (`you`,
  `for`, `not`, …) are never split this way — they still raise a ParseError,
  since they signal a mis-dictation.
- Case and punctuation are ignored.

## API

- `parseSpokenMath(input): ParseResult` — throws `ParseError`
- `tryParseSpokenMath(input)` — non-throwing variant
- `tokenize(input): Token[]` — token stream (used by the debug panel)
- `toLatex(ast)`, `toSpeech(ast)` — renderers over the AST

`toSpeech` produces an unambiguous English read-back (*"the fraction 1 over x,
end fraction, plus 2"*) used as a local fallback when speech-rule-engine is
unavailable.
