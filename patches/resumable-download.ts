import { registerPlugin } from '@capacitor/core';

export type ResumableProgress = { downloaded: number; total: number };
export const ResumableDownload = registerPlugin<{
  download(options: { url: string; checksum: string }): Promise<{ checksum: string; bytes: number }>;
  releaseArchive(options: { checksum: string }): Promise<void>;
  addListener(event: 'progress', callback: (progress: ResumableProgress) => void): Promise<{ remove(): Promise<void> }>;
}>('ResumableDownload');
