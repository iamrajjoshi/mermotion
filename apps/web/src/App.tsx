import { Command as CommandIcon, Download, Maximize2, Pause, Palette, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

import { MERMAID_VERSION, type SemanticTarget } from '@mermotion/engine';

import {
  defaultAppearancePreference,
  defaultMermaidDiagramPalette,
  resolveMermaidPalette,
  resolveShellPalette,
  shellPaletteCssVariables,
  type AppearancePreference,
  type HexColor,
  type MermaidDiagramPalette,
} from './appearance';
import { summarizeCues, inferDuration, type CueSummary } from './cues';
import { AppearancePanel } from './components/AppearancePanel';
import { CommandMenu, type CommandAction } from './components/CommandMenu';
import { ExportPanel } from './components/ExportPanel';
import { Preview, type PreviewHandle } from './components/Preview';
import { PresentationView } from './components/PresentationView';
import { SceneRail } from './components/SceneRail';
import { SourceEditor, type SourceFile, type UiDiagnostic } from './components/SourceEditor';
import { Timeline } from './components/Timeline';
import type { GifExporter, GifExportInfo } from './gif-export';
import { readMotionDefaultColor, writeMotionDefaultColor } from './motion-source';
import {
  activeScene,
  addScene,
  deleteScene,
  duplicateScene,
  moveScene,
  renameScene,
  selectScene,
  updateActiveSceneSource,
  type SceneWorkspace,
} from './scenes';
import {
  loadWorkspace,
  requestPersistentStorage,
  saveWorkspace,
  type ThemePreference,
  WorkspaceRevisionConflictError,
} from './storage';
import { DEMO_DURATION_MS, clampTime } from './time';
import { motionStatementForTarget } from './target-source';
import {
  readMermaidPalette,
  readMermaidTheme,
  writeMermaidPalette,
  writeMermaidTheme,
} from './theme';

const defaultDiagram = `---
config:
  theme: base
  themeVariables:
    primaryColor: "#f7f8fc"
    primaryTextColor: "#252934"
    primaryBorderColor: "#8790a6"
    lineColor: "#687086"
    secondaryColor: "#e8ebff"
    tertiaryColor: "#eef0f6"
    background: "#f3f5f8"
---
flowchart LR
  brief["Write Mermaid"] --> render{"Render & select"}
  render -->|node| cue["Add motion"]
  render -->|route| trace["Trace a path"]
  cue --> preview["Seek any moment"]
  trace --> preview`;

const defaultMotion = `motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  at 0ms highlight brief
  at 450ms move request along brief --> render --> cue --> preview over 2.4s
  at 2.25s pulse cue for 550ms
  at 3.1s trace render --> trace --> preview over 1.4s`;

const newSceneDiagram = `flowchart LR
  start["Start"] --> next["Next"]`;

const newSceneMotion = `motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470`;

const defaultSceneWorkspace: SceneWorkspace = {
  activeSceneId: 'scene-checkout',
  scenes: [
    {
      id: 'scene-checkout',
      name: 'Checkout',
      diagramSource: defaultDiagram,
      motionSource: defaultMotion,
    },
  ],
};

type MobileView = 'source' | 'preview' | 'timeline';
type SaveState = 'loading' | 'saving' | 'saved' | 'error' | 'conflict';

const defaultMotionColor: HexColor = '#ff5470';
const saveStateLabels: Readonly<Record<SaveState, string>> = {
  conflict: 'Reload to sync',
  error: 'Save unavailable',
  loading: 'Opening',
  saved: 'Saved locally',
  saving: 'Saving locally',
};

function createSceneId(): string {
  return `scene-${crypto.randomUUID()}`;
}

function downloadSources(workspace: SceneWorkspace): void {
  const current = activeScene(workspace);
  const content = JSON.stringify(
    {
      format: 'mermotion-workspace-v2',
      activeSceneId: workspace.activeSceneId,
      files: {
        'diagram.mmd': current.diagramSource,
        'diagram.motion': current.motionSource,
      },
      scenes: workspace.scenes.map(({ id, name, diagramSource, motionSource }) => ({
        id,
        name,
        files: {
          'diagram.mmd': diagramSource,
          'diagram.motion': motionSource,
        },
      })),
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'workspace.mermotion.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const appearanceTrigger = useRef<HTMLButtonElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const persistedOnce = useRef(false);
  const persistenceEnabled = useRef(false);
  const workspaceRevision = useRef<number | null | undefined>(undefined);
  const skipNextAutosave = useRef(true);
  const saveAttempt = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const animationFrame = useRef<number | undefined>(undefined);
  const playbackTime = useRef(0);
  const [sceneWorkspace, setSceneWorkspace] = useState<SceneWorkspace>(defaultSceneWorkspace);
  const [activeFile, setActiveFile] = useState<SourceFile>('motion');
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('preview');
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  const [appearance, setAppearance] = useState<AppearancePreference>(defaultAppearancePreference);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [gifExportInfo, setGifExportInfo] = useState<GifExportInfo>();
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [saveError, setSaveError] = useState<string>();
  const [diagnostics, setDiagnostics] = useState<UiDiagnostic[]>([]);
  const [durationMs, setDurationMs] = useState(DEMO_DURATION_MS);
  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [renderNonce, setRenderNonce] = useState(0);
  const [fitNonce, setFitNonce] = useState(0);
  const [lastRenderedAt, setLastRenderedAt] = useState<number>();
  const [semanticInventory, setSemanticInventory] = useState<{
    source: string;
    targets: SemanticTarget[];
  }>({ source: '', targets: [] });
  const [persistenceReady, setPersistenceReady] = useState(false);
  const currentScene = activeScene(sceneWorkspace);
  const currentSceneIndex = sceneWorkspace.scenes.findIndex(
    ({ id }) => id === sceneWorkspace.activeSceneId,
  );
  const diagramSource = currentScene.diagramSource;
  const motionSource = currentScene.motionSource;
  const setDiagramSource = useCallback((update: SetStateAction<string>) => {
    setSceneWorkspace((workspace) => updateActiveSceneSource(workspace, 'diagramSource', update));
  }, []);
  const setMotionSource = useCallback((update: SetStateAction<string>) => {
    setSceneWorkspace((workspace) => updateActiveSceneSource(workspace, 'motionSource', update));
  }, []);

  const outerLayout = useDefaultLayout({
    id: 'mermotion-rows',
    panelIds: ['work-area', 'timeline'],
    storage: localStorage,
  });
  const innerLayout = useDefaultLayout({
    id: 'mermotion-columns',
    panelIds: ['source', 'preview'],
    storage: localStorage,
  });

  const cues = useMemo(() => summarizeCues(motionSource), [motionSource]);
  const visibleDuration = useMemo(
    () => Math.max(400, durationMs, inferDuration(cues, 0)),
    [cues, durationMs],
  );
  const diagramTheme = useMemo(() => readMermaidTheme(diagramSource), [diagramSource]);
  const diagramPalette = useMemo(
    () => resolveMermaidPalette(readMermaidPalette(diagramSource)),
    [diagramSource],
  );
  const motionColor = useMemo(
    () => readMotionDefaultColor(motionSource) ?? defaultMotionColor,
    [motionSource],
  );
  const shellPalette = useMemo(() => resolveShellPalette(appearance), [appearance]);
  const semanticTargets =
    semanticInventory.source === diagramSource ? semanticInventory.targets : [];
  const currentGifExportInfo =
    gifExportInfo?.diagramSource === diagramSource && gifExportInfo.motionSource === motionSource
      ? gifExportInfo
      : undefined;
  const canExportGif =
    currentGifExportInfo !== undefined &&
    !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const updateSemanticTargets = useCallback((source: string, targets: SemanticTarget[]) => {
    setSemanticInventory({ source, targets });
  }, []);

  useEffect(() => {
    let active = true;
    void loadWorkspace()
      .then((workspace) => {
        if (!active) return;
        if (workspace) {
          setSceneWorkspace({
            activeSceneId: workspace.activeSceneId,
            scenes: workspace.scenes,
          });
          if (workspace.appearance) {
            setAppearance(workspace.appearance);
            setThemePreference(workspace.appearance.shellPreset === 'Paper' ? 'light' : 'dark');
          } else {
            setAppearance(defaultAppearancePreference);
            setThemePreference('dark');
          }
        }
        workspaceRevision.current = workspace?.revision ?? null;
        persistenceEnabled.current = true;
        skipNextAutosave.current = true;
        setSaveError(undefined);
        setSaveState('saved');
        setPersistenceReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        persistenceEnabled.current = false;
        workspaceRevision.current = undefined;
        setSaveError(error instanceof Error ? error.message : 'Local storage could not be opened.');
        setSaveState('error');
        setPersistenceReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themePreference;
    root.style.colorScheme = themePreference;
    for (const [property, value] of Object.entries(shellPaletteCssVariables(shellPalette))) {
      root.style.setProperty(property, value);
    }
    root.style.setProperty('--signal', motionColor);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', shellPalette.header);
  }, [motionColor, shellPalette, themePreference]);

  useEffect(() => {
    if (!persistenceReady || !persistenceEnabled.current) return undefined;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return undefined;
    }
    const attempt = ++saveAttempt.current;
    const workspace = { ...sceneWorkspace, appearance, themePreference };
    setSaveError(undefined);
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      saveQueue.current = saveQueue.current
        .then(async () => {
          if (!persistenceEnabled.current) return;
          const expectedRevision = workspaceRevision.current;
          if (expectedRevision === undefined) {
            throw new Error('The local workspace has not finished opening.');
          }
          const saved = await saveWorkspace(workspace, expectedRevision);
          workspaceRevision.current = saved.revision;
          if (attempt === saveAttempt.current) setSaveState('saved');
          if (!persistedOnce.current) {
            persistedOnce.current = true;
            void requestPersistentStorage();
          }
        })
        .catch((error: unknown) => {
          persistenceEnabled.current = false;
          setPersistenceReady(false);
          setSaveError(
            error instanceof Error ? error.message : 'Local storage could not save this workspace.',
          );
          setSaveState(error instanceof WorkspaceRevisionConflictError ? 'conflict' : 'error');
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [appearance, persistenceReady, sceneWorkspace, themePreference]);

  const restart = useCallback(() => {
    setIsPlaying(false);
    playbackTime.current = 0;
    setTimeMs(0);
  }, []);

  const fitPreview = useCallback(() => {
    setFitNonce((value) => value + 1);
    setMobileView('preview');
  }, []);

  const renderPreview = useCallback(() => setRenderNonce((value) => value + 1), []);

  const openPresentation = useCallback(() => {
    restart();
    setPresentationOpen(true);
  }, [restart]);

  const resetSceneView = useCallback(() => {
    restart();
    setDurationMs(DEMO_DURATION_MS);
    setSelectedCueId(undefined);
    setDiagnostics([]);
    setGifExportInfo(undefined);
    setLastRenderedAt(undefined);
    setSemanticInventory({ source: '', targets: [] });
    setFitNonce((value) => value + 1);
  }, [restart]);

  const activateScene = useCallback(
    (sceneId: string) => {
      if (sceneId === sceneWorkspace.activeSceneId) return;
      setSceneWorkspace((workspace) => selectScene(workspace, sceneId));
      resetSceneView();
    },
    [resetSceneView, sceneWorkspace.activeSceneId],
  );

  const createScene = useCallback(() => {
    const id = createSceneId();
    setSceneWorkspace((workspace) =>
      addScene(workspace, {
        id,
        diagramSource: newSceneDiagram,
        motionSource: newSceneMotion,
      }),
    );
    resetSceneView();
  }, [resetSceneView]);

  const copyScene = useCallback(
    (sceneId: string) => {
      setSceneWorkspace((workspace) => duplicateScene(workspace, sceneId, createSceneId()));
      resetSceneView();
    },
    [resetSceneView],
  );

  const removeScene = useCallback(
    (sceneId: string) => {
      setSceneWorkspace((workspace) => deleteScene(workspace, sceneId));
      resetSceneView();
    },
    [resetSceneView],
  );

  const togglePlayback = useCallback(() => {
    setIsPlaying((playing) => {
      if (!playing && timeMs >= visibleDuration) {
        playbackTime.current = 0;
        setTimeMs(0);
      }
      return !playing;
    });
  }, [timeMs, visibleDuration]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const startedAt = performance.now() - playbackTime.current;
    const tick = (now: number) => {
      const nextTime = now - startedAt;
      if (nextTime >= visibleDuration) {
        playbackTime.current = visibleDuration;
        setTimeMs(visibleDuration);
        setIsPlaying(false);
        return;
      }
      playbackTime.current = nextTime;
      setTimeMs(nextTime);
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
    };
  }, [isPlaying, visibleDuration]);

  useEffect(() => {
    playbackTime.current = timeMs;
  }, [timeMs]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setIsPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const addPulse = useCallback(
    (target: SemanticTarget) => {
      const statement = motionStatementForTarget(target, timeMs);
      setMotionSource((source) => `${source.trimEnd()}\n${statement}\n`);
      setActiveFile('motion');
      setSyntaxOpen(false);
      setMobileView('source');
    },
    [timeMs],
  );

  const selectCue = useCallback((cue: CueSummary) => {
    setSelectedCueId(cue.id);
    playbackTime.current = cue.startMs;
    setTimeMs(cue.startMs);
    setIsPlaying(false);
    setActiveFile('motion');
    setSyntaxOpen(false);
  }, []);

  const closeAppearance = useCallback(() => {
    setAppearanceOpen(false);
    window.requestAnimationFrame(() => appearanceTrigger.current?.focus());
  }, []);

  const openAppearance = useCallback(() => {
    setExportOpen(false);
    setAppearanceOpen(true);
  }, []);

  const openExport = useCallback(() => {
    setAppearanceOpen(false);
    setExportOpen(true);
  }, []);

  const closeExport = useCallback(() => setExportOpen(false), []);

  const exportGif = useCallback<GifExporter>((settings, control) => {
    const preview = previewRef.current;
    if (!preview) return Promise.reject(new Error('The preview is not ready for export.'));
    return preview.exportGif(settings, control);
  }, []);

  const changeAppearance = useCallback((nextAppearance: AppearancePreference) => {
    setAppearance(nextAppearance);
    if (nextAppearance.shellOverrides === undefined) {
      setThemePreference(nextAppearance.shellPreset === 'Paper' ? 'light' : 'dark');
    }
  }, []);

  const changeDiagramColor = useCallback(
    (key: keyof MermaidDiagramPalette, color: HexColor) => {
      setDiagramSource((source) =>
        writeMermaidPalette(source, { ...diagramPalette, [key]: color }),
      );
    },
    [diagramPalette],
  );

  const resetAppearance = useCallback(() => {
    setAppearance(defaultAppearancePreference);
    setThemePreference('dark');
    setDiagramSource((source) => writeMermaidPalette(source, defaultMermaidDiagramPalette));
    setMotionSource((source) => writeMotionDefaultColor(source, defaultMotionColor));
  }, []);

  const focusFile = useCallback((file: SourceFile) => {
    setActiveFile(file);
    setSyntaxOpen(false);
    setMobileView('source');
    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>(
          `[data-source-file="diagram.${file === 'diagram' ? 'mmd' : 'motion'}"]`,
        )
        ?.focus();
    });
  }, []);

  const openSyntax = useCallback(() => {
    setSyntaxOpen(true);
    setMobileView('source');
    window.requestAnimationFrame(() => document.getElementById('motion-syntax-reference')?.focus());
  }, []);

  const actions = useMemo<CommandAction[]>(
    () => [
      {
        group: 'Diagram',
        label: 'Render diagram',
        shortcut: '⌘↵',
        run: renderPreview,
      },
      {
        group: 'Diagram',
        label: 'Fit preview',
        shortcut: 'F',
        run: fitPreview,
      },
      {
        group: 'Source',
        label: 'Open diagram.mmd',
        shortcut: '⌘1',
        run: () => focusFile('diagram'),
      },
      {
        group: 'Source',
        label: 'Open diagram.motion',
        shortcut: '⌘2',
        run: () => focusFile('motion'),
      },
      {
        group: 'Source',
        keywords: ['docs', 'help', 'language', 'reference'],
        label: 'Open syntax reference',
        shortcut: '⌘/',
        run: openSyntax,
      },
      {
        group: 'Playback',
        label: isPlaying ? 'Pause animation' : 'Play animation',
        shortcut: 'Space',
        run: togglePlayback,
      },
      {
        group: 'Playback',
        label: 'Restart animation',
        shortcut: 'R',
        run: restart,
      },
      {
        group: 'Scenes',
        label: 'Add scene',
        run: createScene,
      },
      {
        group: 'Scenes',
        label: 'Duplicate current scene',
        run: () => copyScene(sceneWorkspace.activeSceneId),
      },
      {
        group: 'Scenes',
        keywords: ['slides', 'present', 'preview'],
        label: 'Start presentation',
        run: openPresentation,
      },
      {
        group: 'View',
        label: 'Open Appearance',
        run: openAppearance,
      },
      {
        group: 'Project',
        keywords: ['gif', 'download', 'loop', 'animation'],
        label: 'Open export',
        run: openExport,
      },
      {
        group: 'Project',
        label: 'Download source bundle',
        run: () => downloadSources(sceneWorkspace),
      },
    ],
    [
      copyScene,
      createScene,
      fitPreview,
      focusFile,
      isPlaying,
      openAppearance,
      openExport,
      openPresentation,
      openSyntax,
      renderPreview,
      restart,
      sceneWorkspace,
      togglePlayback,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const usingControl =
        editing ||
        event.target instanceof HTMLButtonElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (presentationOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setPresentationOpen(false);
        } else if (!usingControl && event.key === 'ArrowLeft' && currentSceneIndex > 0) {
          event.preventDefault();
          activateScene(sceneWorkspace.scenes[currentSceneIndex - 1]!.id);
        } else if (
          !usingControl &&
          event.key === 'ArrowRight' &&
          currentSceneIndex < sceneWorkspace.scenes.length - 1
        ) {
          event.preventDefault();
          activateScene(sceneWorkspace.scenes[currentSceneIndex + 1]!.id);
        } else if (!usingControl && event.code === 'Space') {
          event.preventDefault();
          togglePlayback();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        renderPreview();
      } else if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault();
        focusFile('diagram');
      } else if ((event.metaKey || event.ctrlKey) && event.key === '2') {
        event.preventDefault();
        focusFile('motion');
      } else if ((event.metaKey || event.ctrlKey) && event.code === 'Slash') {
        event.preventDefault();
        openSyntax();
      } else if (!usingControl && event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (!usingControl && event.key.toLowerCase() === 'r') {
        restart();
      } else if (!usingControl && event.key.toLowerCase() === 'f') {
        fitPreview();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activateScene,
    currentSceneIndex,
    fitPreview,
    focusFile,
    openSyntax,
    presentationOpen,
    renderPreview,
    restart,
    sceneWorkspace.scenes,
    togglePlayback,
  ]);

  const onDurationChange = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) setDurationMs(duration);
  }, []);
  const onRender = useCallback(() => setLastRenderedAt(Date.now()), []);

  if (presentationOpen) {
    return (
      <PresentationView
        isPlaying={isPlaying}
        onClose={() => {
          setIsPlaying(false);
          setPresentationOpen(false);
        }}
        onNext={() => activateScene(sceneWorkspace.scenes[currentSceneIndex + 1]!.id)}
        onPlayToggle={togglePlayback}
        onPrevious={() => activateScene(sceneWorkspace.scenes[currentSceneIndex - 1]!.id)}
        onSelect={activateScene}
        workspace={sceneWorkspace}
      >
        <Preview
          diagramBackground={diagramPalette.background}
          diagramSource={diagramSource}
          fitNonce={fitNonce}
          key={`presentation-${sceneWorkspace.activeSceneId}-${renderNonce}`}
          motionSource={motionSource}
          onAddPulse={addPulse}
          onDiagnosticsChange={setDiagnostics}
          onDurationChange={onDurationChange}
          onRender={onRender}
          onTargetsChange={updateSemanticTargets}
          readOnly
          timeMs={timeMs}
        />
      </PresentationView>
    );
  }

  return (
    <div className="app-shell" data-mobile-view={mobileView}>
      <header className="app-header">
        <div className="brand-cluster">
          <a className="wordmark" href="/" aria-label="Mermotion home">
            <svg aria-hidden="true" viewBox="0 0 32 28">
              <path d="M3 21V7l7 8 6-11 6 11 7-8v14" />
              <circle cx="3" cy="21" r="2" />
              <circle cx="16" cy="4" r="2" />
              <circle cx="29" cy="21" r="2" />
            </svg>
            <span>Mermotion</span>
          </a>
          <span className="header-rule" />
          <div className="document-identity">
            <div className="document-line">
              <strong>{currentScene.name}</strong>
              <span>.mmd</span>
              <i className={diagnostics.length ? 'document-dot has-error' : 'document-dot'} />
            </div>
            <div className="document-meta">
              <span>{diagnostics.length ? 'Needs attention' : 'Ready'}</span>
              <span>Mermaid {MERMAID_VERSION}</span>
              {lastRenderedAt ? <span data-testid="render-status">Preview current</span> : null}
              <span data-testid="save-status" title={saveError}>
                {saveStateLabels[saveState]}
              </span>
            </div>
          </div>
        </div>
        <nav className="header-tools" aria-label="Workspace tools">
          <button
            aria-label="Fit diagram"
            className="header-button fit-control"
            onClick={() => {
              setFitNonce((value) => value + 1);
              setMobileView('preview');
            }}
            type="button"
          >
            <Maximize2 aria-hidden="true" size={13} /> Fit
          </button>
          <button
            aria-expanded={appearanceOpen}
            className="header-button appearance-trigger"
            onClick={openAppearance}
            ref={appearanceTrigger}
            type="button"
          >
            <Palette aria-hidden="true" size={14} /> Appearance
          </button>
          <button
            aria-expanded={exportOpen}
            aria-label="Open export options"
            className="header-button download-control"
            onClick={openExport}
            ref={exportTrigger}
            type="button"
          >
            <Download aria-hidden="true" size={14} /> Export
          </button>
          <button
            aria-label="Open commands"
            className="command-trigger"
            onClick={() => setCommandOpen(true)}
            type="button"
          >
            <CommandIcon aria-hidden="true" size={14} />
            <span>Commands</span>
            <kbd>⌘K</kbd>
          </button>
          <button
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            className="header-play"
            onClick={togglePlayback}
            type="button"
          >
            {isPlaying ? (
              <Pause aria-hidden="true" fill="currentColor" size={13} />
            ) : (
              <Play aria-hidden="true" fill="currentColor" size={13} />
            )}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </nav>
      </header>

      <SceneRail
        onAdd={createScene}
        onDelete={removeScene}
        onDuplicate={copyScene}
        onMove={(sceneId, direction) =>
          setSceneWorkspace((workspace) => moveScene(workspace, sceneId, direction))
        }
        onPresent={openPresentation}
        onRename={(sceneId, name) =>
          setSceneWorkspace((workspace) => renameScene(workspace, sceneId, name))
        }
        onSelect={activateScene}
        workspace={sceneWorkspace}
      />

      <nav className="mobile-tabs" aria-label="Workspace regions">
        {(['source', 'preview', 'timeline'] as const).map((view) => (
          <button
            aria-current={mobileView === view ? 'page' : undefined}
            className={mobileView === view ? 'is-active' : ''}
            key={view}
            onClick={() => setMobileView(view)}
            type="button"
          >
            {view}
          </button>
        ))}
      </nav>

      <main className="workbench">
        <Group {...outerLayout} className="rows-group" id="mermotion-rows" orientation="vertical">
          <Panel defaultSize="77%" id="work-area" minSize="320px">
            <Group
              {...innerLayout}
              className="columns-group"
              id="mermotion-columns"
              orientation="horizontal"
            >
              <Panel defaultSize="38%" id="source" minSize="320px">
                <SourceEditor
                  activeFile={activeFile}
                  diagnostics={diagnostics}
                  diagramSource={diagramSource}
                  motionSource={motionSource}
                  onActiveFileChange={setActiveFile}
                  onDiagramSourceChange={setDiagramSource}
                  onMotionSourceChange={setMotionSource}
                  onSyntaxOpenChange={setSyntaxOpen}
                  syntaxOpen={syntaxOpen}
                  targets={semanticTargets}
                />
              </Panel>
              <Separator className="resize-handle vertical-handle">
                <span />
              </Separator>
              <Panel defaultSize="62%" id="preview" minSize="380px">
                <Preview
                  diagramBackground={diagramPalette.background}
                  diagramSource={diagramSource}
                  fitNonce={fitNonce}
                  key={`${sceneWorkspace.activeSceneId}-${renderNonce}`}
                  motionSource={motionSource}
                  onAddPulse={addPulse}
                  onDiagnosticsChange={setDiagnostics}
                  onDurationChange={onDurationChange}
                  onGifExportInfoChange={setGifExportInfo}
                  onRender={onRender}
                  onTargetsChange={updateSemanticTargets}
                  ref={previewRef}
                  timeMs={timeMs}
                />
              </Panel>
            </Group>
          </Panel>
          <Separator className="resize-handle horizontal-handle">
            <span />
          </Separator>
          <Panel defaultSize="23%" id="timeline" minSize="178px">
            <Timeline
              cues={cues}
              durationMs={visibleDuration}
              isPlaying={isPlaying}
              onPlayToggle={togglePlayback}
              onRestart={restart}
              onSeek={(time) => {
                setIsPlaying(false);
                const nextTime = clampTime(time, visibleDuration);
                playbackTime.current = nextTime;
                setTimeMs(nextTime);
              }}
              onSelectCue={selectCue}
              selectedCueId={selectedCueId}
              timeMs={timeMs}
            />
          </Panel>
        </Group>
      </main>

      <CommandMenu actions={actions} onOpenChange={setCommandOpen} open={commandOpen} />
      {appearanceOpen ? (
        <AppearancePanel
          appearance={appearance}
          diagramPalette={diagramPalette}
          diagramTheme={diagramTheme}
          motionColor={motionColor}
          onAppearanceChange={changeAppearance}
          onClose={closeAppearance}
          onDiagramColorChange={changeDiagramColor}
          onDiagramThemeChange={(theme) =>
            setDiagramSource((source) => writeMermaidTheme(source, theme))
          }
          onMotionColorChange={(color) =>
            setMotionSource((source) => writeMotionDefaultColor(source, color))
          }
          onReset={resetAppearance}
        />
      ) : null}
      {exportOpen ? (
        <ExportPanel
          canExport={canExportGif}
          exportInfo={currentGifExportInfo}
          onClose={closeExport}
          onDownloadSources={() => downloadSources(sceneWorkspace)}
          onExport={exportGif}
          returnFocusRef={exportTrigger}
        />
      ) : null}
    </div>
  );
}
