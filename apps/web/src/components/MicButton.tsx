interface Props {
  mode: 'load' | 'start' | 'stop' | 'busy';
  disabled?: boolean;
  onClick: () => void;
}

const LABELS: Record<Props['mode'], string> = {
  load: 'Enable voice input (downloads speech model)',
  start: 'Start dictating',
  stop: 'Stop and transcribe',
  busy: 'Working…',
};

/** Big, keyboard-accessible microphone toggle. */
export function MicButton({ mode, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      className={`mic-button mic-${mode}`}
      aria-label={LABELS[mode]}
      aria-pressed={mode === 'stop'}
      disabled={disabled}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
        {mode === 'stop' ? (
          <rect x="6" y="6" width="12" height="12" rx="2" />
        ) : (
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5.3-3a.75.75 0 0 1 1.5.1A6.75 6.75 0 0 1 12.75 17.7v2.55h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5V17.7A6.75 6.75 0 0 1 5.2 11.1a.75.75 0 0 1 1.5-.1 5.25 5.25 0 0 0 10.6 0z" />
        )}
      </svg>
      <span className="mic-button-text">{LABELS[mode]}</span>
    </button>
  );
}
