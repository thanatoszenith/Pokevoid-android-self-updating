import { registerPlugin } from '@capacitor/core';

/** Native external installation; never points at CapacitorUpdater's private bundles. */
export const ExternalGame = registerPlugin<{
  status(): Promise<{ path: string; installed: boolean }>;
  stage(options: { checksum: string }): Promise<{ path: string; bytes: number }>;
  activate(options: { checksum: string }): Promise<{ path: string; previousRetained: boolean }>;
  confirmLaunch(): Promise<void>;
  recover(): Promise<{ installed: boolean; previousRetained: boolean }>;
}>('ExternalGame');
