/** Status lifecycle for a file in the compression queue */
export type FileStatus = 'waiting' | 'compressing' | 'completed' | 'error';
export type ImageType = 'graphic' | 'photo';

/** A single file entry in the compression queue */
export interface FileEntry {
  id: string;
  file: File;
  name: string;
  originalSize: number;
  width?: number;
  height?: number;
  status: FileStatus;
  progress: number; // 0-100
  compressedSize?: number;
  compressedUrl?: string;
  compressedBuffer?: Uint8Array;
  errorMessage?: string;
}

/** Messages from main thread to worker */
export interface WorkerRequest {
  type: 'compress';
  id: string;
  buffer: ArrayBuffer;
  mimeType: string;
  fileName: string;
  targetFormat: 'original' | 'webp';
}

/** Messages from worker to main thread */
export type WorkerResponse =
  | { type: 'progress'; id: string; progress: number; width?: number; height?: number }
  | { type: 'result'; id: string; buffer: ArrayBuffer; originalSize: number; compressedSize: number; mimeType?: string }
  | { type: 'error'; id: string; message: string };
