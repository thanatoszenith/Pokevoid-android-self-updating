import { registerPlugin } from '@capacitor/core';
export type ExternalState = { path: string; installed: boolean; version: string; pending: boolean; launchId: string; failedChecksum: string; loadFailed: boolean };
export const ExternalGame = registerPlugin<{
  status(): Promise<ExternalState>;
  recover(): Promise<ExternalState>;
  stage(options: { checksum: string; version: string }): Promise<void>;
  activate(options: { checksum: string }): Promise<void>;
  open(): Promise<void>;
  abortLaunch(): Promise<void>;
  confirmLaunch(options: { launchId: string }): Promise<void>;
}>('ExternalGame');
