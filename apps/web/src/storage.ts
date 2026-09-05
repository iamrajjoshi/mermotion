import { openDB, type DBSchema } from 'idb';

import type { AppearancePreference } from './appearance';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface WorkspaceDocument {
  id: 'current';
  diagramSource: string;
  motionSource: string;
  themePreference: ThemePreference;
  appearance?: AppearancePreference;
  updatedAt: number;
}

interface MermotionDatabase extends DBSchema {
  documents: {
    key: WorkspaceDocument['id'];
    value: WorkspaceDocument;
  };
}

const database = openDB<MermotionDatabase>('mermotion', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('documents')) {
      db.createObjectStore('documents', { keyPath: 'id' });
    }
  },
});

export async function loadWorkspace(): Promise<WorkspaceDocument | undefined> {
  return (await database).get('documents', 'current');
}

export async function saveWorkspace(
  workspace: Omit<WorkspaceDocument, 'id' | 'updatedAt'>,
): Promise<WorkspaceDocument> {
  const document: WorkspaceDocument = {
    ...workspace,
    id: 'current',
    updatedAt: Date.now(),
  };

  await (await database).put('documents', document);
  return document;
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  return navigator.storage?.persist?.();
}
