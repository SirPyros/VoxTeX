import type { DictationResult } from '@voxtex/voice-math-input';

export interface DebugInfo {
  transcript: string;
  transcribeMs: number | null;
  result: DictationResult | null;
  parseErrorMessage: string | null;
  readbackEngine: 'sre' | 'builtin' | null;
  asrBackend: string | null;
  checkCanonical: { student: string; expected: string } | null;
}

/** Transcript → tokens → parse tree → LaTeX, plus pipeline metadata. */
export function DebugPanel({ info }: { info: DebugInfo }) {
  return (
    <details className="debug-panel">
      <summary>Debug: transcript → parse tree → LaTeX</summary>
      <dl>
        <dt>ASR backend</dt>
        <dd>
          <code>{info.asrBackend ?? 'not loaded (typed input)'}</code>
          {info.transcribeMs !== null && <span> — transcribed in {info.transcribeMs} ms</span>}
        </dd>

        <dt>Raw transcript</dt>
        <dd>
          <pre>{info.transcript || '—'}</pre>
        </dd>

        <dt>Tokens</dt>
        <dd>
          <pre>
            {info.result
              ? info.result.tokens
                  .filter((t) => t.kind !== 'EOF')
                  .map((t) => (t.value !== undefined ? `${t.kind}(${t.value})` : t.kind))
                  .join(' ')
              : '—'}
          </pre>
        </dd>

        <dt>Parse tree (AST)</dt>
        <dd>
          <pre>
            {info.result ? JSON.stringify(info.result.ast, null, 2) : (info.parseErrorMessage ?? '—')}
          </pre>
        </dd>

        <dt>LaTeX</dt>
        <dd>
          <pre>{info.result?.latex ?? '—'}</pre>
        </dd>

        <dt>Read-back ({info.readbackEngine ?? '—'})</dt>
        <dd>
          <pre>{info.result?.speech ?? '—'}</pre>
        </dd>

        {info.checkCanonical && (
          <>
            <dt>Compute Engine canonical forms</dt>
            <dd>
              <pre>
                student: {info.checkCanonical.student}
                {'\n'}expected: {info.checkCanonical.expected}
              </pre>
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
