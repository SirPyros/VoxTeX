import { ComputeEngine } from '@cortex-js/compute-engine';

let ce: ComputeEngine | null = null;

function engine(): ComputeEngine {
  if (!ce) ce = new ComputeEngine();
  return ce;
}

export interface CheckResult {
  verdict: 'correct' | 'incorrect' | 'unknown';
  /** Canonical (simplified) form of the student's answer, for the debug panel. */
  studentCanonical: string;
  expectedCanonical: string;
  error?: string;
}

/**
 * Symbolic equivalence check: "2 times the quantity x plus 3" (2(x+3))
 * matches an expected answer of 2x+6.
 */
export function checkAnswer(studentLatex: string, expectedLatex: string): CheckResult {
  try {
    const e = engine();
    const student = e.parse(studentLatex);
    const expected = e.parse(expectedLatex);
    const eq = student.isEqual(expected);
    return {
      verdict: eq === true ? 'correct' : eq === false ? 'incorrect' : 'unknown',
      studentCanonical: student.simplify().latex,
      expectedCanonical: expected.simplify().latex,
    };
  } catch (err) {
    return {
      verdict: 'unknown',
      studentCanonical: '',
      expectedCanonical: '',
      error: String(err),
    };
  }
}
