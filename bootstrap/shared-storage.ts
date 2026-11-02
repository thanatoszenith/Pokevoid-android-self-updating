import { registerPlugin } from '@capacitor/core';

export const SharedStorage = registerPlugin<{
  status(): Promise<{ granted: boolean; path: string }>;
  requestAccess(): Promise<{ granted: boolean }>;
  addListener(event: 'accessChanged', callback: (state: { granted: boolean }) => void): Promise<{ remove(): Promise<void> }>;
  createFolders(): Promise<{ path: string }>;
}>('SharedStorage');

/** Opens Android settings when access is missing; Android always controls the grant. */
export async function configureSharedStorage(): Promise<void> {
  const state = await SharedStorage.status();
  if (!state.granted) {
    await SharedStorage.requestAccess();
    if (!(await SharedStorage.status()).granted) return;
  }
  await SharedStorage.createFolders();
}
