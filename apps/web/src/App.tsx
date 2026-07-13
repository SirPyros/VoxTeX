import {
  createVoiceMathInput,
  toSpeech,
  VoiceMathError,
  type DictationResult,
  type ModelProgress,
  type SessionStatus,
  type VoiceMathInputSession,
} from '@voxtex/voice-math-input';
import { createSreReadback } from '@voxtex/voice-math-input/readback-sre';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAnswer, type CheckResult } from './check/equivalence';
import { DebugPanel, type DebugInfo } from './components/DebugPanel';
import { MathView } from './components/MathView';
import { MicButton } from './components/MicButton';
import { ITEMS } from './items';

type Phase = 'input' | 'review' | 'done';

interface LoadState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  backend?: 'webgpu' | 'wasm';
  progressText?: string;
  error?: string;
}

export default function App() {
  const sessionRef = useRef<VoiceMathInputSession | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'idle' });
  const [itemIndex, setItemIndex] = useState(0);
  const item = ITEMS[itemIndex]!;

  const [phase, setPhase] = useState<Phase>('input');
  const [status, setStatus] = useState('Type a math phrase below, or enable voice input.');
  const [result, setResult] = useState<DictationResult | null>(null);
  const [parseError, setParseError] = useState<{ message: string; transcript: string } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [typed, setTyped] = useState('');

  const session = useCallback((): VoiceMathInputSession => {
    if (!sessionRef.current) {
      sessionRef.current = createVoiceMathInput({
        readback: createSreReadback({
          mathmapsUrl: `${import.meta.env.BASE_URL}sre/mathmaps`,
        }),
      });
      sessionRef.current.on('status', setSessionStatus);
    }
    return sessionRef.current;
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  const resetAttempt = useCallback((message: string) => {
    setPhase('input');
    setStatus(message);
    setResult(null);
    setParseError(null);
    setCheck(null);
  }, []);

  const enableVoice = useCallback(async () => {
    const s = session();
    setLoadState({ phase: 'loading', progressText: 'Starting…' });
    try {
      const { backend } = await s.load((p: ModelProgress) =>
        setLoadState({
          phase: 'loading',
          progressText: `Downloading ${p.file} — ${Math.round(p.progress)}%`,
        }),
      );
      setLoadState({ phase: 'ready', backend });
      setStatus('Voice ready — press the mic and speak your math.');
    } catch (err) {
      setLoadState({ phase: 'error', error: String(err) });
    }
  }, [session]);

  const submit = useCallback(
    async (r: DictationResult) => {
      const outcome = checkAnswer(r.latex, item.expectedLatex);
      setCheck(outcome);
      setPhase('done');
      const message =
        outcome.verdict === 'correct'
          ? 'Correct! Well done.'
          : outcome.verdict === 'incorrect'
            ? 'Not quite. You can try again.'
            : `I couldn't check that answer. ${outcome.error ?? ''}`;
      setStatus(message);
      await session().speak(message);
    },
    [item, session],
  );

  /** Voice yes/no loop after a read-back; falls back to buttons when unclear. */
  const listenForConfirmation = useCallback(
    async (r: DictationResult, attempt = 1): Promise<void> => {
      const s = session();
      setStatus('Listening for “yes” or “no”… (stops when you pause)');
      try {
        const { reply, transcript } = await s.listenYesNo();
        if (reply === 'yes') {
          await submit(r);
        } else if (reply === 'no') {
          resetAttempt('Okay — try again.');
          await s.speak('Okay, try again.');
          void beginDictation();
        } else if (attempt === 1) {
          setStatus(reply === 'silence' ? 'I didn’t hear anything — asking again.' : `I heard “${transcript}” — asking again.`);
          await s.speak('Please say yes to submit, or no to try again.');
          await listenForConfirmation(r, 2);
        } else {
          setStatus('No clear yes or no — use the Confirm / Try again buttons, or the mic.');
        }
      } catch (err) {
        setStatus(`Couldn't listen for confirmation (${String(err)}). Use the buttons instead.`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, submit, resetAttempt],
  );

  const applyResult = useCallback(
    async (r: DictationResult, viaVoice: boolean) => {
      setResult(r);
      setParseError(null);
      setCheck(null);
      setPhase('review');
      setStatus('Here is what I heard. Confirm to submit, or try again.');
      await session().speak(
        `I heard: ${r.speech}. ${viaVoice ? 'Say yes to submit, or no to try again.' : ''}`,
      );
      if (viaVoice) await listenForConfirmation(r);
    },
    [session, listenForConfirmation],
  );

  const beginDictation = useCallback(async () => {
    const s = session();
    setResult(null);
    setParseError(null);
    setCheck(null);
    setStatus('Listening… speak your math. I stop automatically when you pause.');
    try {
      const r = await s.dictateOnce();
      await applyResult(r, true);
    } catch (err) {
      if (err instanceof VoiceMathError) {
        switch (err.code) {
          case 'no-speech':
          case 'empty-transcript':
            resetAttempt("I didn't hear anything — press the mic and try again.");
            await s.speak("I didn't hear anything. Try again.");
            return;
          case 'parse-error':
            setParseError({ message: err.message, transcript: err.transcript ?? '' });
            setResult(null);
            setStatus(`Couldn't parse that: ${err.message}`);
            await s.speak(`Sorry — ${err.message}`);
            return;
          case 'cancelled':
            return;
          default:
            resetAttempt(err.message);
            return;
        }
      }
      resetAttempt(String(err));
    }
  }, [session, applyResult, resetAttempt]);

  const onMicClick = useCallback(() => {
    if (loadState.phase === 'idle') {
      void enableVoice();
      return;
    }
    if (loadState.phase !== 'ready') return;
    if (sessionStatus === 'recording' || sessionStatus === 'confirm-listening') {
      session().stop();
      return;
    }
    if (sessionStatus === 'ready' || sessionStatus === 'speaking') {
      session().stopSpeaking();
      void beginDictation();
    }
  }, [loadState.phase, sessionStatus, session, enableVoice, beginDictation]);

  const onTypedSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!typed.trim()) return;
      void (async () => {
        try {
          const r = await session().parseText(typed.trim());
          await applyResult(r, false);
        } catch (err) {
          if (err instanceof VoiceMathError && err.code === 'parse-error') {
            setParseError({ message: err.message, transcript: err.transcript ?? '' });
            setResult(null);
            setStatus(`Couldn't parse that: ${err.message}`);
          } else {
            setStatus(String(err));
          }
        }
      })();
    },
    [typed, session, applyResult],
  );

  const micMode =
    loadState.phase === 'idle'
      ? 'load'
      : loadState.phase === 'loading'
        ? 'busy'
        : sessionStatus === 'recording' || sessionStatus === 'confirm-listening'
          ? 'stop'
          : sessionStatus === 'transcribing'
            ? 'busy'
            : 'start';

  const transcript = result?.transcript ?? parseError?.transcript ?? '';
  const readbackEngine = result
    ? result.speech === toSpeech(result.ast)
      ? 'builtin'
      : 'sre'
    : null;

  const debugInfo: DebugInfo = {
    transcript,
    transcribeMs: result && result.transcribeMs > 0 ? result.transcribeMs : null,
    result,
    parseErrorMessage: parseError?.message ?? null,
    readbackEngine,
    asrBackend: loadState.backend ?? null,
    checkCanonical: check
      ? { student: check.studentCanonical, expected: check.expectedCanonical }
      : null,
  };

  return (
    <main className="app">
      <header>
        <h1>VoxTeX</h1>
        <p className="tagline">
          Speech-to-math input for assessments — everything runs in your browser.
        </p>
      </header>

      <section className="item-card" aria-labelledby="question-heading">
        <div className="item-picker">
          <label htmlFor="item-select">Assessment item</label>
          <select
            id="item-select"
            value={itemIndex}
            onChange={(e) => {
              setItemIndex(Number(e.target.value));
              session().cancel();
              resetAttempt('New question — type a phrase or use the mic.');
            }}
          >
            {ITEMS.map((it, i) => (
              <option key={it.id} value={i}>
                {i + 1}. {it.prompt}
              </option>
            ))}
          </select>
        </div>

        <h2 id="question-heading" className="prompt">
          {item.prompt}
        </h2>
        <p className="hint">{item.hint}</p>

        <div className="input-row">
          <MicButton
            mode={micMode}
            disabled={loadState.phase === 'loading' || loadState.phase === 'error'}
            onClick={onMicClick}
          />
          <div className="status-block">
            <p role="status" aria-live="polite" className="status">
              {loadState.phase === 'loading'
                ? (loadState.progressText ?? 'Loading speech model…')
                : loadState.phase === 'error'
                  ? `Voice input unavailable: ${loadState.error}`
                  : status}
            </p>
            {loadState.phase === 'ready' && (
              <p className="backend-note">
                Speech model ready ({loadState.backend === 'webgpu' ? 'WebGPU' : 'WASM'} backend).
              </p>
            )}
          </div>
        </div>

        <form className="typed-row" onSubmit={onTypedSubmit}>
          <label htmlFor="typed-input">Or type the spoken phrase</label>
          <div className="typed-controls">
            <input
              id="typed-input"
              type="text"
              value={typed}
              placeholder="e.g. one over x plus two"
              onChange={(e) => setTyped(e.target.value)}
            />
            <button type="submit">Parse</button>
          </div>
        </form>

        {transcript && (
          <p className="transcript">
            <span className="label">Transcript:</span> “{transcript}”
          </p>
        )}

        {result && (
          <div className="result-block">
            <MathView latex={result.latex} srText={result.speech} />
            {phase === 'review' && (
              <div className="confirm-row">
                <button type="button" className="primary" onClick={() => void submit(result)}>
                  Confirm — submit this answer
                </button>
                <button
                  type="button"
                  onClick={() => resetAttempt('Okay — try again.')}
                >
                  Try again
                </button>
                <button type="button" onClick={() => void session().speak(result.speech)}>
                  Repeat read-back
                </button>
              </div>
            )}
          </div>
        )}

        {parseError && !result && (
          <p className="parse-error" role="alert">
            {parseError.message}
          </p>
        )}

        {check && (
          <p className={`feedback ${check.verdict}`} role="alert">
            {check.verdict === 'correct'
              ? '✓ Correct!'
              : check.verdict === 'incorrect'
                ? '✗ Not quite — try again.'
                : `? Couldn't check the answer. ${check.error ?? ''}`}
          </p>
        )}

        {phase === 'done' && (
          <button type="button" onClick={() => resetAttempt('Ready for a new attempt.')}>
            New attempt
          </button>
        )}
      </section>

      <DebugPanel info={debugInfo} />

      <footer>
        <p>
          Proof of concept: Whisper (Transformers.js) → spoken-math grammar → KaTeX →
          speech-rule-engine read-back → Compute Engine equivalence check. No servers.
          Voice pipeline via <code>@voxtex/voice-math-input</code>.
        </p>
      </footer>
    </main>
  );
}
