import type { AudioProfile, CorrectionRule, DictationResult } from '@voxtex/voice-math-input';

export interface DebugInfo {
  transcript: string;
  transcribeMs: number | null;
  result: DictationResult | null;
  parseErrorMessage: string | null;
  readbackEngine: 'sre' | 'builtin' | null;
  asrBackend: string | null;
  checkCanonical: { student: string; expected: string } | null;
  personalRules: CorrectionRule[] | null;
  audioProfile: AudioProfile | null;
  onClearProfile: (() => void) | null;
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
          <pre>
            {info.result?.rawTranscript ?? info.transcript ?? '—'}
            {info.result?.appliedCorrections?.length
              ? `\ncorrections applied: ${info.result.appliedCorrections
                  .map((c) => `"${c.from}" → "${c.to}"`)
                  .join(', ')}\n→ ${info.result.transcript}`
              : ''}
          </pre>
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

        {info.personalRules && (
          <>
            <dt>Voice profile (stored locally)</dt>
            <dd>
              <pre>
                {info.personalRules.length > 0
                  ? info.personalRules
                      .map((r) => `"${r.from}" → "${r.to}" (seen ${r.count}×)`)
                      .join('\n')
                  : 'no learned corrections yet'}
                {info.audioProfile
                  ? `\nmic noise floor: ${info.audioProfile.noiseFloor.toFixed(4)} (${info.audioProfile.samples} recordings)`
                  : ''}
              </pre>
              {info.onClearProfile && (
                <button type="button" className="debug-clear" onClick={info.onClearProfile}>
                  Clear voice profile
                </button>
              )}
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
