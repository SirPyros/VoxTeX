/** Text-to-speech helpers on top of the browser's speechSynthesis. */

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speak text aloud; resolves when the utterance finishes (or fails). */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak()) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
