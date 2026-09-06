import { describe, expect, it } from 'vitest';

import {
  addScene,
  deleteScene,
  duplicateScene,
  moveScene,
  renameScene,
  updateActiveSceneSource,
  type SceneWorkspace,
} from './scenes';

const workspace: SceneWorkspace = {
  activeSceneId: 'one',
  scenes: [
    {
      id: 'one',
      name: 'Opening',
      diagramSource: 'flowchart LR\n A-->B',
      motionSource: 'motionDiagram-v1',
    },
    {
      id: 'two',
      name: 'Decision',
      diagramSource: 'flowchart LR\n B-->C',
      motionSource: 'motionDiagram-v1',
    },
  ],
};

describe('scene workspace operations', () => {
  it('keeps each scene source pair independent through add, edit, and duplicate', () => {
    const added = addScene(workspace, {
      id: 'three',
      diagramSource: 'flowchart LR\n C-->D',
      motionSource: 'motionDiagram-v1\n at 0ms pulse C',
    });
    expect(added.scenes.at(-1)?.name).toBe('Scene 1');

    const edited = updateActiveSceneSource(added, 'diagramSource', (source) => `${source}\n D-->E`);
    expect(edited.scenes[0]?.diagramSource).toBe(workspace.scenes[0]?.diagramSource);
    expect(edited.scenes.at(-1)?.diagramSource).toContain('D-->E');

    const duplicated = duplicateScene(edited, 'three', 'copy');
    expect(duplicated.activeSceneId).toBe('copy');
    expect(duplicated.scenes[3]).toMatchObject({
      diagramSource: edited.scenes[2]?.diagramSource,
      motionSource: edited.scenes[2]?.motionSource,
      name: 'Scene 1 copy',
    });
  });

  it('renames, reorders, and selects a neighboring scene after deletion', () => {
    const renamed = renameScene(workspace, 'one', '  Intro  ');
    const moved = moveScene(renamed, 'one', 1);
    expect(moved.scenes.map(({ name }) => name)).toEqual(['Decision', 'Intro']);

    const deleted = deleteScene(moved, 'one');
    expect(deleted).toEqual({ activeSceneId: 'two', scenes: [workspace.scenes[1]] });
    expect(deleteScene(deleted, 'two')).toBe(deleted);
  });
});
