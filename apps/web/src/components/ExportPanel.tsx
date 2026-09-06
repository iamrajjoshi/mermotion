import { Check, Download, FileArchive, Film, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import {
  GIF_FRAME_RATES,
  GIF_WIDTHS,
  createGifFramePlan,
  fitGifDimensions,
  validateGifWorkload,
  type GifDimensions,
  type GifExporter,
  type GifExportInfo,
  type GifExportProgress,
  type GifExportResult,
  type GifExportSettings,
  type GifFramePlan,
  type GifFrameRate,
  type GifWidth,
} from '../gif-export';

interface ExportPanelProps {
  canExport: boolean;
  exportInfo: GifExportInfo | undefined;
  onClose: () => void;
  onDownloadSources: () => void;
  onExport: GifExporter;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

type ExportStatus = 'complete' | 'exporting' | 'idle';

interface ExportPlanState {
  error: string | undefined;
  value:
    | {
        dimensions: GifDimensions;
        framePlan: GifFramePlan;
      }
    | undefined;
}

const defaultSettings: GifExportSettings = {
  endPauseMs: 500,
  frameRate: 20,
  loopMode: 'forever',
  playCount: 3,
  width: 960,
};

// Treat Notion's documented 5 MB ceiling as decimal bytes so the green result stays conservative.
const NOTION_FILE_TARGET_BYTES = 5_000_000;
const notionSettings: GifExportSettings = {
  endPauseMs: 500,
  frameRate: 10,
  loopMode: 'forever',
  playCount: 3,
  width: 640,
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The GIF could not be exported.';
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(milliseconds >= 10_000 ? 1 : 2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes >= 1_024 * 1_024) return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
  return `${(bytes / 1_024).toFixed(bytes >= 102_400 ? 0 : 1)} KB`;
}

function isGifFrameRate(value: number): value is GifFrameRate {
  return GIF_FRAME_RATES.some((frameRate) => frameRate === value);
}

function isGifWidth(value: number): value is GifWidth {
  return GIF_WIDTHS.some((width) => width === value);
}

function downloadGif(result: GifExportResult): void {
  const bytes = new Uint8Array(result.bytes.length);
  bytes.set(result.bytes);
  const blob = new Blob([bytes.buffer], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'checkout.gif';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ExportPanel({
  canExport,
  exportInfo,
  onClose,
  onDownloadSources,
  onExport,
  returnFocusRef,
}: ExportPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const activeElementRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [endPauseEnabled, setEndPauseEnabled] = useState(true);
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [progress, setProgress] = useState<GifExportProgress>({
    completedFrames: 0,
    totalFrames: 0,
  });
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<GifExportResult>();

  const effectiveSettings = useMemo<GifExportSettings>(
    () => ({
      ...settings,
      endPauseMs: settings.loopMode === 'once' || !endPauseEnabled ? 0 : settings.endPauseMs,
    }),
    [endPauseEnabled, settings],
  );
  const exportPlan = useMemo<ExportPlanState>(() => {
    if (!exportInfo) return { error: undefined, value: undefined };
    try {
      const framePlan = createGifFramePlan(
        exportInfo.durationMs,
        effectiveSettings.frameRate,
        effectiveSettings.endPauseMs,
      );
      const dimensions = fitGifDimensions(
        exportInfo.viewBoxWidth,
        exportInfo.viewBoxHeight,
        effectiveSettings.width,
      );
      validateGifWorkload(dimensions, framePlan.frames.length);
      return { error: undefined, value: { dimensions, framePlan } };
    } catch (caught) {
      return { error: errorMessage(caught), value: undefined };
    }
  }, [effectiveSettings, exportInfo]);
  const plan = exportPlan.value;
  const playCountValid =
    settings.loopMode !== 'count' ||
    (Number.isInteger(settings.playCount) &&
      settings.playCount >= 2 &&
      settings.playCount <= 65_536);
  const exporting = status === 'exporting';

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    activeElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = panel.parentElement;
    const background = container
      ? Array.from(container.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            element !== panel &&
            !element.classList.contains('export-backdrop'),
        )
      : [];
    const previousInert = background.map((element) => element.inert);
    for (const element of background) element.inert = true;

    closeRef.current?.focus();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        controllerRef.current?.abort();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', containFocus);
    return () => {
      controllerRef.current?.abort();
      window.removeEventListener('keydown', containFocus);
      background.forEach((element, index) => {
        element.inert = previousInert[index] ?? false;
      });
      window.requestAnimationFrame(() =>
        (returnFocusRef?.current ?? activeElementRef.current)?.focus(),
      );
    };
  }, [onClose, returnFocusRef]);

  const close = () => {
    controllerRef.current?.abort();
    onClose();
  };

  const startExport = async () => {
    if (!canExport || !plan || !playCountValid || exporting) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('exporting');
    setError(undefined);
    setResult(undefined);
    setProgress({ completedFrames: 0, totalFrames: plan.framePlan.frames.length });

    try {
      const nextResult = await onExport(effectiveSettings, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      downloadGif(nextResult);
      setResult(nextResult);
      setStatus('complete');
    } catch (caught) {
      if (isAbortError(caught)) {
        setStatus('idle');
      } else {
        setError(errorMessage(caught));
        setStatus('idle');
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = undefined;
    }
  };

  const cancelExport = () => controllerRef.current?.abort();
  const updateSettings = <Key extends keyof GifExportSettings>(
    key: Key,
    value: GifExportSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setStatus('idle');
    setResult(undefined);
    setError(undefined);
  };
  const applyNotionPreset = () => {
    setSettings(notionSettings);
    setEndPauseEnabled(true);
    setStatus('idle');
    setResult(undefined);
    setError(undefined);
  };

  return (
    <>
      <div aria-hidden="true" className="export-backdrop" onClick={close} />
      <aside
        aria-label="Export"
        aria-modal="true"
        className="export-panel"
        data-testid="export-panel"
        ref={panelRef}
        role="dialog"
      >
        <header className="export-header">
          <div className="export-title">
            <span className="export-mark">
              <Film aria-hidden="true" size={15} />
            </span>
            <span>
              <strong>Export</strong>
              <small>Render locally in this browser</small>
            </span>
          </div>
          <button
            aria-label="Close Export"
            className="panel-close"
            onClick={close}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="export-scroll">
          <section className="export-section export-gif-section">
            <div className="export-section-heading">
              <div>
                <h3>Animated GIF</h3>
                <p>Every frame is drawn from the current Mermaid and motion source.</p>
              </div>
              <span className="export-format">GIF89a</span>
            </div>

            <div className="export-preset-row">
              <span>Uploading to Notion?</span>
              <button disabled={exporting} onClick={applyNotionPreset} type="button">
                Use 640px · 10fps
              </button>
            </div>

            <div className="export-field-row">
              <label>
                <span>Width</span>
                <select
                  aria-label="GIF width"
                  disabled={exporting}
                  onChange={(event) => {
                    const width = Number(event.target.value);
                    if (isGifWidth(width)) updateSettings('width', width);
                  }}
                  value={settings.width}
                >
                  {GIF_WIDTHS.map((width) => (
                    <option key={width} value={width}>
                      {width}px
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Cadence</span>
                <select
                  aria-label="GIF frame rate"
                  disabled={exporting}
                  onChange={(event) => {
                    const frameRate = Number(event.target.value);
                    if (isGifFrameRate(frameRate)) updateSettings('frameRate', frameRate);
                  }}
                  value={settings.frameRate}
                >
                  {GIF_FRAME_RATES.map((frameRate) => (
                    <option key={frameRate} value={frameRate}>
                      {frameRate} fps
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="loop-options" disabled={exporting}>
              <legend>Playback</legend>
              {(
                [
                  ['forever', 'Loop forever'],
                  ['once', 'Play once'],
                  ['count', 'Set count'],
                ] as const
              ).map(([mode, label]) => (
                <label className="loop-option" key={mode}>
                  <input
                    checked={settings.loopMode === mode}
                    name="gif-loop"
                    onChange={() => updateSettings('loopMode', mode)}
                    type="radio"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            {settings.loopMode === 'count' ? (
              <label className="export-number-field">
                <span>Total plays</span>
                <input
                  aria-describedby="play-count-note"
                  aria-invalid={!playCountValid}
                  disabled={exporting}
                  max={65_536}
                  min={2}
                  onChange={(event) => updateSettings('playCount', event.target.valueAsNumber)}
                  type="number"
                  value={Number.isNaN(settings.playCount) ? '' : settings.playCount}
                />
                <small id="play-count-note">First play included · 2–65,536</small>
              </label>
            ) : null}

            <div className="end-pause-row">
              <label className="check-field">
                <input
                  checked={endPauseEnabled && settings.loopMode !== 'once'}
                  disabled={exporting || settings.loopMode === 'once'}
                  onChange={(event) => {
                    setEndPauseEnabled(event.target.checked);
                    setStatus('idle');
                  }}
                  type="checkbox"
                />
                <span>Pause on final frame</span>
              </label>
              <select
                aria-label="Final frame pause"
                disabled={exporting || settings.loopMode === 'once' || !endPauseEnabled}
                onChange={(event) => updateSettings('endPauseMs', Number(event.target.value))}
                value={settings.endPauseMs}
              >
                <option value={250}>0.25s</option>
                <option value={500}>0.5s</option>
                <option value={1_000}>1s</option>
                <option value={2_000}>2s</option>
              </select>
            </div>

            {plan ? (
              <div className="export-readout" aria-label="GIF export summary">
                <div
                  aria-hidden="true"
                  className="export-cadence"
                  title={`${plan.framePlan.frames.length} sampled frames`}
                >
                  <span
                    className="export-cadence-motion"
                    style={{
                      backgroundSize: `${Math.max(
                        3,
                        100 / Math.min(plan.framePlan.frames.length, 32),
                      )}% 100%`,
                      flexGrow: Math.max(exportInfo?.durationMs ?? 0, 10),
                    }}
                  />
                  {effectiveSettings.endPauseMs > 0 ? (
                    <span
                      className="export-cadence-hold"
                      style={{ flexGrow: effectiveSettings.endPauseMs }}
                    />
                  ) : null}
                </div>
                <div className="export-readout-values">
                  <span>{plan.framePlan.frames.length} frames</span>
                  <span>
                    {plan.dimensions.width} × {plan.dimensions.height}px
                  </span>
                  <span>{formatDuration(plan.framePlan.playbackMs)}</span>
                </div>
              </div>
            ) : (
              <p className="export-unavailable" role="status">
                {exportPlan.error ?? 'Finish a valid render to export an animation.'}
              </p>
            )}

            {exporting ? (
              <>
                <span className="sr-only" role="status">
                  GIF export started.
                </span>
                <div className="export-progress">
                  <div>
                    <span>Rendering frames</span>
                    <output>
                      {progress.completedFrames} / {progress.totalFrames}
                    </output>
                  </div>
                  <progress
                    aria-label="GIF export progress"
                    max={Math.max(progress.totalFrames, 1)}
                    value={progress.completedFrames}
                  />
                </div>
              </>
            ) : null}
            {error ? (
              <p className="export-error" role="alert">
                {error}
              </p>
            ) : null}
            {status === 'complete' && result ? (
              <p
                className={`export-complete ${
                  result.bytes.byteLength <= NOTION_FILE_TARGET_BYTES ? '' : 'is-over-target'
                }`}
                role="status"
              >
                <Check aria-hidden="true" size={13} /> Downloaded checkout.gif ·{' '}
                {formatBytes(result.bytes.byteLength)} ·{' '}
                {result.bytes.byteLength <= NOTION_FILE_TARGET_BYTES
                  ? 'ready to upload to Notion'
                  : 'over the 5 MB Notion target'}
              </p>
            ) : null}

            <div className="export-primary-actions">
              {exporting ? (
                <button className="export-cancel" onClick={cancelExport} type="button">
                  Cancel export
                </button>
              ) : (
                <button
                  className="export-gif-button"
                  disabled={!canExport || !plan || !playCountValid}
                  onClick={() => void startExport()}
                  type="button"
                >
                  {status === 'complete' ? (
                    <Download aria-hidden="true" size={14} />
                  ) : (
                    <Film aria-hidden="true" size={14} />
                  )}
                  {status === 'complete' ? 'Export again' : 'Export GIF'}
                </button>
              )}
              {exporting ? (
                <LoaderCircle aria-hidden="true" className="spinning" size={15} />
              ) : null}
            </div>
          </section>

          <section className="export-section export-source-section">
            <FileArchive aria-hidden="true" size={16} />
            <span>
              <strong>Project source</strong>
              <small>All scenes + active source pair</small>
            </span>
            <button disabled={exporting} onClick={onDownloadSources} type="button">
              <Download aria-hidden="true" size={13} /> Bundle
            </button>
          </section>
        </div>

        <footer className="export-footer">
          <span>Local only · no upload</span>
          <span>Rendered locally</span>
        </footer>
      </aside>
    </>
  );
}
