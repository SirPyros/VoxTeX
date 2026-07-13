/// <reference lib="webworker" />
// Whisper ASR in a Web Worker via Transformers.js.
// Tries WebGPU first (unless device is pinned), falls back to WASM.
// All remote assets can be redirected to a private CDN via AssetOptions;
// inference is always fully local.
import { env, pipeline } from '@huggingface/transformers';
import type { FromWorker, ToWorker } from './messages';
import type { AssetOptions, DeviceMode } from './types';

// The pipeline type is unwieldy across transformers.js versions; keep it loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let backend: 'webgpu' | 'wasm' = 'wasm';

function post(msg: FromWorker) {
  self.postMessage(msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function progressCallback(p: any) {
  if (p && p.status === 'progress' && typeof p.progress === 'number') {
    post({ type: 'progress', file: String(p.file ?? ''), progress: p.progress });
  }
}

function applyAssetOverrides(assets: AssetOptions | undefined) {
  if (!assets) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = env as any;
  if (assets.modelBaseUrl) {
    // Fetch model files from `${modelBaseUrl}/<model-id>/<file>` instead of
    // the Hugging Face Hub. "local" here just means "URL I control".
    e.allowRemoteModels = false;
    e.allowLocalModels = true;
    e.localModelPath = assets.modelBaseUrl;
  }
  if (assets.wasmBaseUrl && e.backends?.onnx?.wasm) {
    e.backends.onnx.wasm.wasmPaths = assets.wasmBaseUrl;
  }
}

async function createPipeline(model: string, device: 'webgpu' | 'wasm') {
  return pipeline('automatic-speech-recognition', model, {
    device,
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: progressCallback,
  });
}

async function load(model: string, fallbackModel: string, device: DeviceMode) {
  const attempts: Array<['webgpu' | 'wasm', string]> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasWebGpu = Boolean((self.navigator as any)?.gpu);
  if (device !== 'wasm' && hasWebGpu) {
    attempts.push(['webgpu', model]);
    if (fallbackModel !== model) attempts.push(['webgpu', fallbackModel]);
  }
  if (device !== 'webgpu') {
    attempts.push(['wasm', model]);
    if (fallbackModel !== model) attempts.push(['wasm', fallbackModel]);
  }
  if (attempts.length === 0) {
    throw new Error('WebGPU was requested but is not available in this browser.');
  }

  let lastError: unknown = null;
  for (const [dev, m] of attempts) {
    try {
      asr = await createPipeline(m, dev);
      backend = dev;
      return;
    } catch (err) {
      lastError = err;
      post({ type: 'info', message: `${dev}/${m} failed: ${String(err)}` });
    }
  }
  throw lastError ?? new Error('No ASR backend available');
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      applyAssetOverrides(msg.assets);
      await load(msg.model, msg.fallbackModel, msg.device);
      post({ type: 'ready', backend });
    } catch (err) {
      post({ type: 'error', id: null, message: `Could not load the speech model: ${String(err)}` });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    if (!asr) {
      post({ type: 'error', id: msg.id, message: 'Speech model is not loaded yet.' });
      return;
    }
    try {
      const started = performance.now();
      const output = await asr(msg.audio);
      const text = Array.isArray(output)
        ? output.map((o: { text?: string }) => o.text ?? '').join(' ')
        : (output?.text ?? '');
      post({
        type: 'transcript',
        id: msg.id,
        text: String(text).trim(),
        ms: Math.round(performance.now() - started),
      });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: `Transcription failed: ${String(err)}` });
    }
  }
};
