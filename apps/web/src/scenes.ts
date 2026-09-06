export interface SceneSources {
  diagramSource: string;
  motionSource: string;
}

export interface WorkspaceScene extends SceneSources {
  id: string;
  name: string;
}

export interface SceneWorkspace {
  activeSceneId: string;
  scenes: WorkspaceScene[];
}

export type SceneSourceKey = keyof SceneSources;

export function activeScene(workspace: SceneWorkspace): WorkspaceScene {
  return workspace.scenes.find(({ id }) => id === workspace.activeSceneId) ?? workspace.scenes[0]!;
}

function availableName(scenes: WorkspaceScene[], preferred: string): string {
  const names = new Set(scenes.map(({ name }) => name.toLocaleLowerCase()));
  if (!names.has(preferred.toLocaleLowerCase())) return preferred;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred} ${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function nextSceneName(scenes: WorkspaceScene[]): string {
  for (let number = 1; ; number += 1) {
    const candidate = `Scene ${number}`;
    if (!scenes.some(({ name }) => name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }
}

export function addScene(
  workspace: SceneWorkspace,
  scene: Omit<WorkspaceScene, 'name'> & { name?: string },
): SceneWorkspace {
  const next: WorkspaceScene = {
    ...scene,
    name: scene.name?.trim() || nextSceneName(workspace.scenes),
  };
  return { activeSceneId: next.id, scenes: [...workspace.scenes, next] };
}

export function duplicateScene(
  workspace: SceneWorkspace,
  sceneId: string,
  duplicateId: string,
): SceneWorkspace {
  const index = workspace.scenes.findIndex(({ id }) => id === sceneId);
  if (index < 0) return workspace;
  const source = workspace.scenes[index]!;
  const duplicate: WorkspaceScene = {
    ...source,
    id: duplicateId,
    name: availableName(workspace.scenes, `${source.name} copy`),
  };
  const scenes = [...workspace.scenes];
  scenes.splice(index + 1, 0, duplicate);
  return { activeSceneId: duplicate.id, scenes };
}

export function deleteScene(workspace: SceneWorkspace, sceneId: string): SceneWorkspace {
  if (workspace.scenes.length <= 1) return workspace;
  const index = workspace.scenes.findIndex(({ id }) => id === sceneId);
  if (index < 0) return workspace;
  const scenes = workspace.scenes.filter(({ id }) => id !== sceneId);
  if (sceneId !== workspace.activeSceneId) return { ...workspace, scenes };
  return { activeSceneId: scenes[Math.min(index, scenes.length - 1)]!.id, scenes };
}

export function moveScene(
  workspace: SceneWorkspace,
  sceneId: string,
  direction: -1 | 1,
): SceneWorkspace {
  const index = workspace.scenes.findIndex(({ id }) => id === sceneId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= workspace.scenes.length) return workspace;
  const scenes = [...workspace.scenes];
  [scenes[index], scenes[destination]] = [scenes[destination]!, scenes[index]!];
  return { ...workspace, scenes };
}

export function renameScene(
  workspace: SceneWorkspace,
  sceneId: string,
  name: string,
): SceneWorkspace {
  const trimmed = name.trim();
  if (!trimmed) return workspace;
  return {
    ...workspace,
    scenes: workspace.scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, name: trimmed } : scene,
    ),
  };
}

export function selectScene(workspace: SceneWorkspace, sceneId: string): SceneWorkspace {
  return workspace.scenes.some(({ id }) => id === sceneId)
    ? { ...workspace, activeSceneId: sceneId }
    : workspace;
}

export function updateActiveSceneSource(
  workspace: SceneWorkspace,
  key: SceneSourceKey,
  update: string | ((source: string) => string),
): SceneWorkspace {
  return {
    ...workspace,
    scenes: workspace.scenes.map((scene) => {
      if (scene.id !== workspace.activeSceneId) return scene;
      const source = scene[key];
      return { ...scene, [key]: typeof update === 'function' ? update(source) : update };
    }),
  };
}
