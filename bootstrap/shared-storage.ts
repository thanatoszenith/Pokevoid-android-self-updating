import { registerPlugin } from '@capacitor/core';

export const SharedStorage = registerPlugin<{
  status(): Promise<{ granted: boolean; path: string }>;
  requestAccess(): Promise<void>;
  createFolders(): Promise<{ path: string }>;
}>('SharedStorage');

/** Only ask after a user gesture; never block game startup if access is declined. */
export async function configureSharedStorage(): Promise<void> {
  const state = await SharedStorage.status();
  if (!state.granted) {
    await SharedStorage.requestAccess();
    return; // Settings opens; user must return and confirm.
  }
  await SharedStorage.createFolders();
}
