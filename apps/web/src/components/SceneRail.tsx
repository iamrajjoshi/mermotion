import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Presentation, Trash2 } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';

import type { SceneWorkspace } from '../scenes';

interface SceneRailProps {
  workspace: SceneWorkspace;
  onAdd: () => void;
  onDelete: (sceneId: string) => void;
  onDuplicate: (sceneId: string) => void;
  onMove: (sceneId: string, direction: -1 | 1) => void;
  onPresent: () => void;
  onRename: (sceneId: string, name: string) => void;
  onSelect: (sceneId: string) => void;
}

export function SceneRail({
  workspace,
  onAdd,
  onDelete,
  onDuplicate,
  onMove,
  onPresent,
  onRename,
  onSelect,
}: SceneRailProps) {
  const [renamingId, setRenamingId] = useState<string>();
  const [draftName, setDraftName] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const activeIndex = workspace.scenes.findIndex(({ id }) => id === workspace.activeSceneId);
  const activeScene = workspace.scenes[activeIndex]!;

  useEffect(() => {
    setPendingDeleteId(undefined);
    if (renamingId && renamingId !== workspace.activeSceneId) setRenamingId(undefined);
  }, [renamingId, workspace.activeSceneId]);

  const beginRename = () => {
    setDraftName(activeScene.name);
    setPendingDeleteId(undefined);
    setRenamingId(activeScene.id);
  };

  const commitRename = () => {
    if (!renamingId) return;
    onRename(renamingId, draftName);
    setRenamingId(undefined);
  };

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = workspace.scenes.length - 1;
    else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      nextIndex = (index + direction + workspace.scenes.length) % workspace.scenes.length;
    }
    const next = workspace.scenes[nextIndex]!;
    onSelect(next.id);
    window.requestAnimationFrame(() => document.getElementById(`scene-tab-${next.id}`)?.focus());
  };

  return (
    <section className="scene-rail" aria-label="Scenes">
      <div className="scene-tabs" role="tablist" aria-label="Diagram scenes">
        {workspace.scenes.map((scene, index) =>
          renamingId === scene.id ? (
            <form
              className="scene-rename"
              key={scene.id}
              onSubmit={(event) => {
                event.preventDefault();
                commitRename();
              }}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <input
                aria-label="Scene name"
                autoFocus
                maxLength={80}
                onBlur={commitRename}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  setRenamingId(undefined);
                }}
                value={draftName}
              />
            </form>
          ) : (
            <button
              aria-selected={scene.id === workspace.activeSceneId}
              className={scene.id === workspace.activeSceneId ? 'scene-tab is-active' : 'scene-tab'}
              id={`scene-tab-${scene.id}`}
              key={scene.id}
              onClick={() => onSelect(scene.id)}
              onDoubleClick={scene.id === workspace.activeSceneId ? beginRename : undefined}
              onKeyDown={(event) => moveTabFocus(event, index)}
              role="tab"
              tabIndex={scene.id === workspace.activeSceneId ? 0 : -1}
              type="button"
            >
              <span className="scene-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="scene-name">{scene.name}</span>
            </button>
          ),
        )}
      </div>

      <div className="scene-controls">
        {pendingDeleteId === activeScene.id ? (
          <div className="scene-delete-confirm" role="group" aria-label="Confirm scene deletion">
            <span>Delete {activeScene.name}?</span>
            <button onClick={() => setPendingDeleteId(undefined)} type="button">
              Keep
            </button>
            <button className="is-danger" onClick={() => onDelete(activeScene.id)} type="button">
              Delete
            </button>
          </div>
        ) : (
          <div className="scene-edit-controls" aria-label={`Edit ${activeScene.name}`}>
            <button
              aria-label="Move scene earlier"
              data-tooltip="Move earlier"
              disabled={activeIndex <= 0}
              onClick={() => onMove(activeScene.id, -1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="Move scene later"
              data-tooltip="Move later"
              disabled={activeIndex >= workspace.scenes.length - 1}
              onClick={() => onMove(activeScene.id, 1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="Duplicate scene"
              data-tooltip="Duplicate"
              onClick={() => onDuplicate(activeScene.id)}
              type="button"
            >
              <Copy aria-hidden="true" size={13} />
            </button>
            <button
              aria-label="Rename scene"
              data-tooltip="Rename"
              onClick={beginRename}
              type="button"
            >
              <Pencil aria-hidden="true" size={13} />
            </button>
            <button
              aria-label="Delete scene"
              data-tooltip={workspace.scenes.length === 1 ? 'Keep at least one scene' : 'Delete'}
              disabled={workspace.scenes.length === 1}
              onClick={() => setPendingDeleteId(activeScene.id)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={13} />
            </button>
          </div>
        )}
        <button className="scene-add" onClick={onAdd} type="button">
          <Plus aria-hidden="true" size={14} /> Scene
        </button>
        <button className="scene-present" onClick={onPresent} type="button">
          <Presentation aria-hidden="true" size={14} /> Present
        </button>
      </div>
    </section>
  );
}
