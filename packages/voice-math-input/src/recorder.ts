/** Microphone capture via MediaRecorder, decoded to 16 kHz mono Float32
 * samples — the input format Whisper expects. Optional voice-activity
 * end-pointing auto-stops the recording after trailing silence, so the
 * whole flow can be hands-free. */

import { Endpointer } from './endpointer';

export type EndReason = 'manual' | 'speech-ended' | 'timeout' | 'no-speech';

export interface RecordingResult {
  samples: Float32Array;
  endReason: EndReason;
  /** RMS noise floor measured during calibration (null without VAD). */
  noiseFloor: number | null;
}

export interface VadOptions {
  /** Trailing silence that ends the utterance (ms). */
  silenceMs: number;
  /** Cumulative voiced time before speech counts as heard (ms). */
  minSpeechMs: number;
  /** Give up when nothing is said within this window (ms). */
  noSpeechTimeoutMs: number;
  /** Persisted noise floor to seed calibration (personalization). */
  initialNoiseFloor?: number;
}

export interface RecordingOptions {
  /** Hard cap on recording duration (ms). */
  maxMs: number;
  /** Enable energy-based auto-stop. Omit for manual/timed stop only. */
  vad?: VadOptions;
}

export interface RecordingController {
  /** Stop recording early (endReason becomes "manual"). */
  stop: () => void;
  /** Resolves once recording has stopped and decoded. */
  result: Promise<RecordingResult>;
}

const FRAME_MS = 50;

export async function startRecording(options: RecordingOptions): Promise<RecordingController> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let endReason: EndReason | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let vadInterval: ReturnType<typeof setInterval> | null = null;
  let monitorCtx: AudioContext | null = null;

  const stopWith = (reason: EndReason) => {
    if (endReason === null) endReason = reason;
    if (recorder.state !== 'inactive') recorder.stop();
  };

  // Voice-activity monitoring on the same stream via an AnalyserNode.
  let endpointer: Endpointer | null = null;
  if (options.vad) {
    endpointer = new Endpointer({ maxMs: options.maxMs, ...options.vad });
    const ep = endpointer;
    monitorCtx = new AudioContext();
    const source = monitorCtx.createMediaStreamSource(stream);
    const analyser = monitorCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const frame = new Float32Array(analyser.fftSize);
    let lastTick = performance.now();
    vadInterval = setInterval(() => {
      const now = performance.now();
      const frameMs = now - lastTick;
      lastTick = now;
      analyser.getFloatTimeDomainData(frame);
      let sumSquares = 0;
      for (let i = 0; i < frame.length; i++) sumSquares += frame[i]! * frame[i]!;
      const rms = Math.sqrt(sumSquares / frame.length);
      const decision = ep.update(rms, frameMs);
      if (decision !== null) stopWith(decision);
    }, FRAME_MS);
  } else {
    timer = setTimeout(() => stopWith('timeout'), options.maxMs);
  }

  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    if (vadInterval !== null) clearInterval(vadInterval);
    if (monitorCtx !== null) void monitorCtx.close();
    stream.getTracks().forEach((t) => t.stop());
  };

  const result = new Promise<RecordingResult>((resolve, reject) => {
    recorder.onstop = async () => {
      cleanup();
      try {
        const reason = endReason ?? 'manual';
        const noiseFloor = endpointer?.measuredNoiseFloor ?? null;
        if (reason === 'no-speech') {
          // Nothing worth decoding.
          resolve({ samples: new Float32Array(0), endReason: reason, noiseFloor });
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        resolve({ samples: await decodeTo16kMono(blob), endReason: reason, noiseFloor });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error('Recording failed.'));
    };
  });

  recorder.start();

  return {
    stop: () => stopWith('manual'),
    result,
  };
}

async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  // An AudioContext created at 16 kHz resamples during decodeAudioData.
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer);
    if (buf.numberOfChannels === 1) {
      return Float32Array.from(buf.getChannelData(0));
    }
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < buf.length; i++) out[i] = out[i]! + data[i]!;
    }
    for (let i = 0; i < out.length; i++) out[i] = out[i]! / buf.numberOfChannels;
    return out;
  } finally {
    void ctx.close();
  }
}
