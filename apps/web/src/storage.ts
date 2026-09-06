import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import {
  isShellPaletteName,
  normalizeHexColor,
  shellPaletteFields,
  type AppearancePreference,
  type HexColor,
  type ShellPaletteField,
} from './appearance';
import type { SceneSources, SceneWorkspace, WorkspaceScene } from './scenes';

export type ThemePreference = 'light' | 'dark';

type LegacyThemePreference = ThemePreference | 'system';

interface LegacyWorkspaceDocument extends SceneSources {
  id: 'current';
  themePreference: LegacyThemePreference;
  appearance?: AppearancePreference;
  updatedAt: number;
}

/** The source fields mirror the active scene for clients that only understand v1 records. */
export interface WorkspaceDocument extends SceneSources, SceneWorkspace {
  id: 'current';
  format: 'mermotion-workspace-v2';
  revision: number;
  themePreference: ThemePreference;
  appearance?: AppearancePreference;
  updatedAt: number;
}

type StoredWorkspaceDocument = LegacyWorkspaceDocument | WorkspaceDocument;

interface MermotionDatabase extends DBSchema {
  documents: {
    key: StoredWorkspaceDocument['id'];
    value: StoredWorkspaceDocument;
  };
}

const databaseOpenTimeoutMs = 2_000;

export class WorkspaceRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null,
  ) {
    super('A newer version was saved in another tab. Reload before saving more changes.');
    this.name = 'WorkspaceRevisionConflictError';
  }
}

class WorkspaceStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceStorageUnavailableError';
  }
}

function openWorkspaceDatabase(): Promise<IDBPDatabase<MermotionDatabase>> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    let connection: IDBPDatabase<MermotionDatabase> | undefined;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return false;
      settled = true;
      globalThis.clearTimeout(timeout);
      operation();
      return true;
    };
    const timeout = globalThis.setTimeout(() => {
      finish(() =>
        reject(
          new WorkspaceStorageUnavailableError(
            blocked
              ? 'Local storage is blocked by another Mermotion tab. Close it, then reload this page.'
              : 'Local storage did not open in time. Reload this page to try again.',
          ),
        ),
      );
    }, databaseOpenTimeoutMs);

    void openDB<MermotionDatabase>('mermotion', 2, {
      blocked() {
        blocked = true;
      },
      blocking() {
        connection?.close();
      },
      terminated() {
        connection = undefined;
      },
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id' });
        }
      },
    }).then(
      (opened) => {
        connection = opened;
        if (!finish(() => resolve(opened))) opened.close();
      },
      (error: unknown) => {
        finish(() =>
          reject(
            new WorkspaceStorageUnavailableError(
              error instanceof Error
                ? `Local storage could not open: ${error.message}`
                : 'Local storage could not open.',
            ),
          ),
        );
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readThemePreference(value: unknown): ThemePreference {
  return value === 'light' ? 'light' : 'dark';
}

function readAppearance(value: unknown): AppearancePreference | undefined {
  if (!isRecord(value) || typeof value.shellPreset !== 'string') return undefined;
  if (!isShellPaletteName(value.shellPreset)) return undefined;
  if (!isRecord(value.shellOverrides)) return { shellPreset: value.shellPreset };

  const shellOverrides: Partial<Record<ShellPaletteField, HexColor>> = {};
  for (const field of shellPaletteFields) {
    const candidate = value.shellOverrides[field];
    const color = normalizeHexColor(typeof candidate === 'string' ? candidate : undefined);
    if (color) shellOverrides[field] = color;
  }
  return Object.keys(shellOverrides).length > 0
    ? { shellPreset: value.shellPreset, shellOverrides }
    : { shellPreset: value.shellPreset };
}

function readScenes(value: unknown): WorkspaceScene[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids = new Set<string>();
  const scenes: WorkspaceScene[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      ids.has(candidate.id) ||
      typeof candidate.name !== 'string' ||
      candidate.name.trim().length === 0 ||
      typeof candidate.diagramSource !== 'string' ||
      typeof candidate.motionSource !== 'string'
    ) {
      return undefined;
    }
    ids.add(candidate.id);
    scenes.push({
      id: candidate.id,
      name: candidate.name.trim(),
      diagramSource: candidate.diagramSource,
      motionSource: candidate.motionSource,
    });
  }
  return scenes;
}

/** Converts both the v1 source-pair record and v2 scene records into the current shape. */
export function migrateWorkspaceDocument(value: unknown): WorkspaceDocument | undefined {
  if (!isRecord(value) || value.id !== 'current') return undefined;
  const themePreference = readThemePreference(value.themePreference);
  const storedScenes = readScenes(value.scenes);
  let scenes: WorkspaceScene[];
  if ('scenes' in value) {
    if (!storedScenes) return undefined;
    scenes = storedScenes;
  } else if (typeof value.diagramSource === 'string' && typeof value.motionSource === 'string') {
    scenes = [
      {
        id: 'scene-1',
        name: 'Checkout',
        diagramSource: value.diagramSource,
        motionSource: value.motionSource,
      },
    ];
  } else return undefined;

  const fallbackScene = scenes[0];
  if (!fallbackScene) return undefined;
  const activeSceneId =
    typeof value.activeSceneId === 'string' && scenes.some(({ id }) => id === value.activeSceneId)
      ? value.activeSceneId
      : fallbackScene.id;
  const current = scenes.find(({ id }) => id === activeSceneId) ?? fallbackScene;
  const appearance = readAppearance(value.appearance);
  return {
    id: 'current',
    format: 'mermotion-workspace-v2',
    scenes,
    activeSceneId,
    diagramSource: current.diagramSource,
    motionSource: current.motionSource,
    revision:
      typeof value.revision === 'number' &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0
        ? value.revision
        : 0,
    themePreference,
    ...(appearance ? { appearance } : {}),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

export async function loadWorkspace(): Promise<WorkspaceDocument | undefined> {
  const database = await openWorkspaceDatabase();
  try {
    const stored = await database.get('documents', 'current');
    if (stored === undefined) return undefined;
    const workspace = migrateWorkspaceDocument(stored);
    if (!workspace) {
      throw new WorkspaceStorageUnavailableError(
        'The saved workspace is not readable. Export your current work before reloading.',
      );
    }
    return workspace;
  } catch (error) {
    if (error instanceof WorkspaceStorageUnavailableError) throw error;
    throw new WorkspaceStorageUnavailableError(
      error instanceof Error
        ? `Local storage could not be read: ${error.message}`
        : 'Local storage could not be read.',
    );
  } finally {
    database.close();
  }
}

export async function saveWorkspace(
  workspace: SceneWorkspace & {
    themePreference: ThemePreference;
    appearance?: AppearancePreference;
  },
  expectedRevision: number | null,
): Promise<WorkspaceDocument> {
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
  ) {
    throw new Error('The workspace revision is invalid.');
  }
  const current = workspace.scenes.find(({ id }) => id === workspace.activeSceneId);
  if (!current) throw new Error('The active scene is missing from the workspace.');
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction('documents', 'readwrite');
    const stored = await transaction.store.get('current');
    const storedWorkspace = migrateWorkspaceDocument(stored);
    if (stored !== undefined && !storedWorkspace) {
      await transaction.done;
      throw new WorkspaceStorageUnavailableError(
        'The saved workspace is not readable. Export your current work before reloading.',
      );
    }
    const actualRevision = storedWorkspace?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      await transaction.done;
      throw new WorkspaceRevisionConflictError(expectedRevision, actualRevision);
    }

    const document: WorkspaceDocument = {
      ...workspace,
      id: 'current',
      format: 'mermotion-workspace-v2',
      diagramSource: current.diagramSource,
      motionSource: current.motionSource,
      revision: (actualRevision ?? 0) + 1,
      updatedAt: Date.now(),
    };
    await transaction.store.put(document);
    await transaction.done;
    return document;
  } catch (error) {
    if (
      error instanceof WorkspaceRevisionConflictError ||
      error instanceof WorkspaceStorageUnavailableError
    ) {
      throw error;
    }
    throw new WorkspaceStorageUnavailableError(
      error instanceof Error
        ? `Local storage could not save: ${error.message}`
        : 'Local storage could not save.',
    );
  } finally {
    database.close();
  }
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  return navigator.storage?.persist?.();
}
