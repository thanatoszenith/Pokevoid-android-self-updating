import { registerPlugin } from '@capacitor/core';

export type ResumableProgress = { downloaded: number; total: number };
export const ResumableDownload = registerPlugin<{
  download(options: { url: string; checksum: string }): Promise<{ url: string; bytes: number }>;
  addListener(event: 'progress', callback: (progress: ResumableProgress) => void): Promise<{ remove(): Promise<void> }>;
}>('ResumableDownload');
