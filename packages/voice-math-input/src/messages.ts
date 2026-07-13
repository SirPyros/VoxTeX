import type { AssetOptions, DeviceMode } from './types';

/** Message protocol between the session and the ASR Web Worker. */

export type ToWorker =
  | {
      type: 'load';
      model: string;
      fallbackModel: string;
      device: DeviceMode;
      assets?: AssetOptions;
    }
  | { type: 'transcribe'; id: number; audio: Float32Array };

export type FromWorker =
  | { type: 'progress'; file: string; progress: number }
  | { type: 'info'; message: string }
  | { type: 'ready'; backend: 'webgpu' | 'wasm' }
  | { type: 'transcript'; id: number; text: string; ms: number }
  | { type: 'error'; id: number | null; message: string };
