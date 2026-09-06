import { describe, expect, it } from 'vitest';

import { migrateWorkspaceDocument } from './storage';

describe('workspace storage migration', () => {
  it('wraps a legacy source pair in one scene without changing either source', () => {
    expect(
      migrateWorkspaceDocument({
        id: 'current',
        diagramSource: 'sequenceDiagram\n A->>B: Hello',
        motionSource: 'motionDiagram-v1\n at 0ms pulse A',
        themePreference: 'light',
        updatedAt: 42,
      }),
    ).toMatchObject({
      activeSceneId: 'scene-1',
      diagramSource: 'sequenceDiagram\n A->>B: Hello',
      format: 'mermotion-workspace-v2',
      motionSource: 'motionDiagram-v1\n at 0ms pulse A',
      revision: 0,
      scenes: [
        {
          id: 'scene-1',
          name: 'Checkout',
          diagramSource: 'sequenceDiagram\n A->>B: Hello',
          motionSource: 'motionDiagram-v1\n at 0ms pulse A',
        },
      ],
      themePreference: 'light',
      updatedAt: 42,
    });
  });

  it('normalizes the retired system theme preference while migrating a legacy record', () => {
    expect(
      migrateWorkspaceDocument({
        id: 'current',
        diagramSource: 'flowchart LR\n A-->B',
        motionSource: 'motionDiagram-v1',
        themePreference: 'system',
        updatedAt: 42,
      })?.themePreference,
    ).toBe('dark');
  });

  it('keeps ordered v2 scenes and repairs a stale active id', () => {
    const migrated = migrateWorkspaceDocument({
      id: 'current',
      format: 'mermotion-workspace-v2',
      activeSceneId: 'missing',
      revision: 7,
      scenes: [
        { id: 'one', name: 'One', diagramSource: 'one mmd', motionSource: 'one motion' },
        { id: 'two', name: 'Two', diagramSource: 'two mmd', motionSource: 'two motion' },
      ],
      themePreference: 'dark',
      updatedAt: 84,
    });

    expect(migrated?.activeSceneId).toBe('one');
    expect(migrated?.scenes.map(({ id }) => id)).toEqual(['one', 'two']);
    expect(migrated?.diagramSource).toBe('one mmd');
    expect(migrated?.motionSource).toBe('one motion');
    expect(migrated?.revision).toBe(7);
  });

  it('does not rename a valid v2 scene that happens to use the legacy id and name', () => {
    const migrated = migrateWorkspaceDocument({
      id: 'current',
      format: 'mermotion-workspace-v2',
      activeSceneId: 'scene-1',
      scenes: [
        {
          id: 'scene-1',
          name: 'Scene 1',
          diagramSource: 'flowchart LR\n A-->B',
          motionSource: 'motionDiagram-v1',
        },
      ],
      themePreference: 'dark',
      updatedAt: 84,
    });

    expect(migrated?.scenes[0]?.name).toBe('Scene 1');
  });

  it('rejects a partially malformed scene collection instead of dropping user data', () => {
    expect(
      migrateWorkspaceDocument({
        id: 'current',
        format: 'mermotion-workspace-v2',
        activeSceneId: 'one',
        diagramSource: 'compatibility diagram',
        motionSource: 'compatibility motion',
        scenes: [
          { id: 'one', name: 'One', diagramSource: 'one mmd', motionSource: 'one motion' },
          { id: 'two', name: 'Two', diagramSource: 'missing motion' },
        ],
        themePreference: 'dark',
        updatedAt: 84,
      }),
    ).toBeUndefined();
  });

  it('normalizes known appearance colors and discards untrusted fields', () => {
    const migrated = migrateWorkspaceDocument({
      id: 'current',
      diagramSource: 'flowchart LR\n A-->B',
      motionSource: 'motionDiagram-v1',
      themePreference: 'dark',
      appearance: {
        shellPreset: 'Blueprint',
        shellOverrides: {
          accent: 'ABCDEF',
          workspace: 'javascript:alert(1)',
          unknown: '#123456',
        },
      },
      updatedAt: 42,
    });

    expect(migrated?.appearance).toEqual({
      shellPreset: 'Blueprint',
      shellOverrides: { accent: '#abcdef' },
    });
  });
});
