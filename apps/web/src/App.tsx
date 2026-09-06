import { Command as CommandIcon, Download, Maximize2, Pause, Palette, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

import { MERMAID_VERSION, type SemanticTarget } from '@mermotion/engine';

import {
  defaultAppearancePreference,
  defaultMermaidDiagramPalette,
  readMermaidPalette,
  resolveMermaidPalette,
  resolveShellPalette,
  shellPaletteCssVariables,
  writeMermaidPalette,
  type AppearancePreference,
  type HexColor,
  type MermaidDiagramPalette,
} from './appearance';
import { summarizeCues, inferDuration, type CueSummary } from './cues';
import { AppearancePanel } from './components/AppearancePanel';
import { CommandMenu, type CommandAction } from './components/CommandMenu';
import { Preview } from './components/Preview';
import { SourceEditor, type SourceFile, type UiDiagnostic } from './components/SourceEditor';
import { Timeline } from './components/Timeline';
import { readMotionDefaultColor, writeMotionDefaultColor } from './motion-source';
import {
  loadWorkspace,
  requestPersistentStorage,
  saveWorkspace,
  type ThemePreference,
} from './storage';
import { DEMO_DURATION_MS, clampTime } from './time';
import { motionStatementForTarget } from './target-source';
import { isMermaidTheme, readMermaidTheme, writeMermaidTheme } from './theme';

const legacyStarterDiagram = `---
config:
  theme: base
  themeVariables:
    primaryColor: "#dff8f3"
    primaryTextColor: "#173c37"
    primaryBorderColor: "#2a9d8f"
    lineColor: "#68847e"
    secondaryColor: "#fff6dd"
    tertiaryColor: "#eef2f0"
---
flowchart LR
  brief["Write Mermaid"]:::source --> render{"Render & select"}:::decision
  render -->|node| cue["Add motion"]:::motion
  render -->|route| trace["Trace a path"]:::motion
  cue --> preview["Seek any moment"]:::result
  trace --> preview

  classDef source fill:#dff8f3,stroke:#2a9d8f,color:#173c37
  classDef engine fill:#eef2f0,stroke:#68847e,color:#23332f
  classDef decision fill:#fff6dd,stroke:#c28a21,color:#563d0c
  classDef motion fill:#d8f3ef,stroke:#0f766e,color:#17443e
  classDef result fill:#173c37,stroke:#2dd4bf,color:#ecf4f1`;

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

const legacyStarterMotion = `motionDiagram-v1
  defaults duration 480ms easing ease-out
  marker request as "Request" shape dot

  at 0ms highlight brief
  at 450ms move request along brief --> render --> cue over 1.6s
  at 2.25s pulse cue for 550ms
  at 3.1s move request along render --> trace --> preview over 1.4s`;

const previousStarterMotion = `motionDiagram-v1
  defaults duration 480ms easing ease-out
  marker request as "Request" shape dot

  at 0ms highlight brief
  at 450ms move request along brief --> render --> cue --> preview over 2.4s easing linear
  at 2.25s pulse cue for 550ms
  at 3.1s trace render --> trace --> preview over 1.4s easing linear`;

const previousShapedStarterMotion = `motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request" shape dot

  at 0ms highlight brief
  at 450ms move request along brief --> render --> cue --> preview over 2.4s easing linear
  at 2.25s pulse cue for 550ms
  at 3.1s trace render --> trace --> preview over 1.4s easing linear`;

const defaultMotion = `motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  at 0ms highlight brief
  at 450ms move request along brief --> render --> cue --> preview over 2.4s easing linear
  at 2.25s pulse cue for 550ms
  at 3.1s trace render --> trace --> preview over 1.4s easing linear`;

type MobileView = 'source' | 'preview' | 'timeline';
type SaveState = 'loading' | 'saving' | 'saved' | 'error';

const defaultMotionColor = '#ff5470' as HexColor;

function downloadSources(diagramSource: string, motionSource: string) {
  const content = JSON.stringify(
    {
      format: 'mermotion-document-v1',
      files: {
        'diagram.mmd': diagramSource,
        'diagram.motion': motionSource,
      },
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'checkout.mermotion.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const appearanceTrigger = useRef<HTMLButtonElement>(null);
  const persistedOnce = useRef(false);
  const animationFrame = useRef<number | undefined>(undefined);
  const playbackTime = useRef(0);
  const [diagramSource, setDiagramSource] = useState(defaultDiagram);
  const [motionSource, setMotionSource] = useState(defaultMotion);
  const [activeFile, setActiveFile] = useState<SourceFile>('motion');
  const [mobileView, setMobileView] = useState<MobileView>('preview');
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  const [appearance, setAppearance] = useState<AppearancePreference>(defaultAppearancePreference);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [diagnostics, setDiagnostics] = useState<UiDiagnostic[]>([]);
  const [durationMs, setDurationMs] = useState(DEMO_DURATION_MS);
  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [renderNonce, setRenderNonce] = useState(0);
  const [fitNonce, setFitNonce] = useState(0);
  const [lastRenderedAt, setLastRenderedAt] = useState<number>();
  const [hydrated, setHydrated] = useState(false);

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

  useEffect(() => {
    let active = true;
    void loadWorkspace()
      .then((workspace) => {
        if (!active) return;
        if (workspace) {
          setDiagramSource(
            workspace.diagramSource === legacyStarterDiagram
              ? defaultDiagram
              : workspace.diagramSource,
          );
          setMotionSource(
            workspace.motionSource === legacyStarterMotion ||
              workspace.motionSource === previousStarterMotion ||
              workspace.motionSource === previousShapedStarterMotion
              ? defaultMotion
              : workspace.motionSource,
          );
          if (workspace.appearance) {
            setAppearance(workspace.appearance);
            setThemePreference(workspace.appearance.shellPreset === 'Paper' ? 'light' : 'dark');
          } else {
            setAppearance(defaultAppearancePreference);
            setThemePreference('dark');
          }
        }
        setSaveState('saved');
        setHydrated(true);
      })
      .catch(() => {
        if (!active) return;
        setSaveState('error');
        setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const resolved = themePreference === 'light' ? 'light' : 'dark';
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    for (const [property, value] of Object.entries(shellPaletteCssVariables(shellPalette))) {
      root.style.setProperty(property, value);
    }
    root.style.setProperty('--signal', motionColor);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', shellPalette.header);
  }, [motionColor, shellPalette, themePreference]);

  useEffect(() => {
    if (!hydrated) return undefined;
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      void saveWorkspace({ appearance, diagramSource, motionSource, themePreference })
        .then(() => {
          setSaveState('saved');
          if (!persistedOnce.current) {
            persistedOnce.current = true;
            void requestPersistentStorage();
          }
        })
        .catch(() => setSaveState('error'));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [appearance, diagramSource, hydrated, motionSource, themePreference]);

  const restart = useCallback(() => {
    setIsPlaying(false);
    playbackTime.current = 0;
    setTimeMs(0);
  }, []);

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
  }, []);

  const closeAppearance = useCallback(() => {
    setAppearanceOpen(false);
    window.requestAnimationFrame(() => appearanceTrigger.current?.focus());
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
    setMobileView('source');
    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>(
          `[data-source-file="diagram.${file === 'diagram' ? 'mmd' : 'motion'}"]`,
        )
        ?.focus();
    });
  }, []);

  const actions = useMemo<CommandAction[]>(
    () => [
      {
        group: 'Diagram',
        label: 'Render diagram',
        shortcut: '⌘↵',
        run: () => setRenderNonce((value) => value + 1),
      },
      {
        group: 'Diagram',
        label: 'Fit preview',
        shortcut: 'F',
        run: () => {
          setFitNonce((value) => value + 1);
          setMobileView('preview');
        },
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
        group: 'View',
        label: 'Open Appearance',
        run: () => setAppearanceOpen(true),
      },
      {
        group: 'Project',
        label: 'Download source bundle',
        run: () => downloadSources(diagramSource, motionSource),
      },
    ],
    [diagramSource, focusFile, isPlaying, motionSource, restart, togglePlayback],
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        setRenderNonce((value) => value + 1);
      } else if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault();
        focusFile('diagram');
      } else if ((event.metaKey || event.ctrlKey) && event.key === '2') {
        event.preventDefault();
        focusFile('motion');
      } else if (!usingControl && event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (!usingControl && event.key.toLowerCase() === 'r') {
        restart();
      } else if (!usingControl && event.key.toLowerCase() === 'f') {
        setFitNonce((value) => value + 1);
        setMobileView('preview');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusFile, restart, togglePlayback]);

  const onDiagnosticsChange = useCallback((nextDiagnostics: UiDiagnostic[]) => {
    setDiagnostics(nextDiagnostics);
  }, []);
  const onDurationChange = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) setDurationMs(duration);
  }, []);
  const onRender = useCallback(() => setLastRenderedAt(Date.now()), []);

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
              <strong>checkout</strong>
              <span>.mmd</span>
              <i className={diagnostics.length ? 'document-dot has-error' : 'document-dot'} />
            </div>
            <div className="document-meta">
              <span>{diagnostics.length ? 'Needs attention' : 'Ready'}</span>
              <span>Mermaid {MERMAID_VERSION}</span>
              {lastRenderedAt ? <span data-testid="render-status">Preview current</span> : null}
              <span data-testid="save-status">
                {saveState === 'loading'
                  ? 'Opening'
                  : saveState === 'saving'
                    ? 'Saving locally'
                    : saveState === 'error'
                      ? 'Save unavailable'
                      : 'Saved locally'}
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
            onClick={() => setAppearanceOpen(true)}
            ref={appearanceTrigger}
            type="button"
          >
            <Palette aria-hidden="true" size={14} /> Appearance
          </button>
          <button
            aria-label="Download diagram and motion sources"
            className="header-button download-control"
            onClick={() => downloadSources(diagramSource, motionSource)}
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
                  key={renderNonce}
                  motionSource={motionSource}
                  onAddPulse={addPulse}
                  onDiagnosticsChange={onDiagnosticsChange}
                  onDurationChange={onDurationChange}
                  onRender={onRender}
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
          onDiagramThemeChange={(theme) => {
            if (isMermaidTheme(theme)) {
              setDiagramSource((source) => writeMermaidTheme(source, theme));
            }
          }}
          onMotionColorChange={(color) =>
            setMotionSource((source) => writeMotionDefaultColor(source, color))
          }
          onReset={resetAppearance}
        />
      ) : null}
    </div>
  );
}
