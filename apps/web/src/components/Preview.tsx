import {
  applyFrameToSvg,
  clearMotionFromSvg,
  compileMotion,
  discoverTargets,
  neutralizeSvgNetworkResources,
  resolveTargetFromElement,
  sampleTimeline,
  settleMotionViewport,
  type CompiledTimeline,
  type Diagnostic,
  type SemanticTarget,
} from '@mermotion/engine';
import { Check, Copy, Crosshair, LoaderCircle, Scan, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { writeClipboardText } from '../clipboard';
import {
  createGifFrameEncoder,
  createGifFramePlan,
  encodeGifFrames,
  fitGifDimensions,
  gifRepeatCount,
  validateGifWorkload,
  type GifDimensions,
  type GifExporter,
  type GifExportInfo,
} from '../gif-export';
import { renderPreviewInFrame, type PreviewRenderResult } from '../preview-renderer-api';
import { previewRendererDocument } from '../preview-renderer-document';
import type { UiDiagnostic } from './SourceEditor';

interface PreviewProps {
  diagramBackground: string;
  diagramSource: string;
  fitNonce: number;
  motionSource: string;
  readOnly?: boolean;
  timeMs: number;
  onAddPulse: (target: SemanticTarget) => void;
  onDiagnosticsChange: (diagnostics: UiDiagnostic[]) => void;
  onDurationChange: (durationMs: number) => void;
  onGifExportInfoChange?: (info: GifExportInfo | undefined) => void;
  onRender: () => void;
  onTargetsChange: (source: string, targets: SemanticTarget[]) => void;
}

export interface PreviewHandle {
  exportGif: GifExporter;
}

interface ExportSnapshot extends PreviewRenderResult {
  diagramSource: GifExportInfo['diagramSource'];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): DOMException {
  return new DOMException('GIF export canceled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function loadSvgImage(markup: string, signal: AbortSignal): Promise<HTMLImageElement> {
  throwIfAborted(signal);
  const image = new Image();
  image.decoding = 'sync';

  return new Promise((resolve, reject) => {
    const cleanUp = () => {
      image.removeEventListener('load', load);
      image.removeEventListener('error', fail);
      signal.removeEventListener('abort', abort);
    };
    const load = () => {
      cleanUp();
      resolve(image);
    };
    const fail = () => {
      cleanUp();
      reject(new Error('The browser could not rasterize an exported SVG frame.'));
    };
    const abort = () => {
      cleanUp();
      image.src = '';
      reject(abortError());
    };

    image.addEventListener('load', load, { once: true });
    image.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    // Blob URLs make SVG foreignObject content taint the canvas in current browsers. A fully
    // encoded data URL keeps Mermaid's HTML labels readable by getImageData after rasterization.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

async function rasterizeSvg(
  svg: SVGSVGElement,
  canvas: HTMLCanvasElement,
  background: string,
  signal: AbortSignal,
): Promise<Uint8ClampedArray> {
  throwIfAborted(signal);
  const serialized = new XMLSerializer().serializeToString(svg);
  const image = await loadSvgImage(neutralizeSvgNetworkResources(serialized), signal);
  throwIfAborted(signal);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot create a canvas for GIF export.');

  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.restore();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function viewBoxDimensions(svg: SVGSVGElement): GifDimensions {
  const { height, width } = svg.viewBox.baseVal;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The rendered diagram has no exportable dimensions.');
  }
  return { height, width };
}

function toUiDiagnostics(diagnostics: readonly Diagnostic[]): UiDiagnostic[] {
  return diagnostics.map(({ message, severity, span }) => ({
    line: span.line,
    message,
    severity,
  }));
}

function markTarget(root: SVGSVGElement, key: string | undefined, attribute: string): void {
  for (const element of root.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
  if (!key) return;

  for (const element of root.querySelectorAll('[data-mermotion-target]')) {
    if (element.getAttribute('data-mermotion-target') === key) element.setAttribute(attribute, '');
  }
}

function addConnectionHitAreas(root: SVGSVGElement, targets: SemanticTarget[]): void {
  const connectionKeys = new Set(
    targets.filter(({ kind }) => kind === 'edge' || kind === 'message').map(({ key }) => key),
  );
  const boundElements = root.querySelectorAll<SVGGraphicsElement>(
    '[data-mermotion-target][data-mermotion-effect-root]',
  );

  for (const element of boundElements) {
    const key = element.getAttribute('data-mermotion-target');
    if (!key || !connectionKeys.has(key) || !element.matches('path, line, polyline')) continue;

    try {
      const box = element.getBBox();
      const padding = 7;
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('aria-hidden', 'true');
      hitArea.setAttribute('data-mermotion-hit-area', '');
      hitArea.setAttribute('data-mermotion-target', key);
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('height', `${Math.max(box.height + padding * 2, padding * 2)}`);
      hitArea.setAttribute('pointer-events', 'all');
      hitArea.setAttribute('width', `${Math.max(box.width + padding * 2, padding * 2)}`);
      hitArea.setAttribute('x', `${box.x - padding}`);
      hitArea.setAttribute('y', `${box.y - padding}`);
      const transform = element.getAttribute('transform');
      if (transform) hitArea.setAttribute('transform', transform);
      // Keep the transparent interaction surface above Mermaid's painted stroke so it receives
      // pointer input across the full padded area, including directly on the connection.
      element.after(hitArea);
    } catch {
      // Some custom Mermaid renderers do not expose SVG geometry. Their native hit area still works.
    }
  }
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
  {
    diagramBackground,
    diagramSource,
    fitNonce,
    motionSource,
    readOnly = false,
    timeMs,
    onAddPulse,
    onDiagnosticsChange,
    onDurationChange,
    onGifExportInfoChange,
    onRender,
    onTargetsChange,
  },
  ref,
) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<HTMLIFrameElement>(null);
  const exportSnapshotRef = useRef<ExportSnapshot | undefined>(undefined);
  const renderSequence = useRef(0);
  const dragStart = useRef<
    { pointerId: number; x: number; y: number; panX: number; panY: number } | undefined
  >(undefined);
  const didPan = useRef(false);
  const userAdjustedView = useRef(false);
  const [timeline, setTimeline] = useState<CompiledTimeline>();
  const [targets, setTargets] = useState<SemanticTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SemanticTarget>();
  const [inspecting, setInspecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renderState, setRenderState] = useState<'rendering' | 'ready' | 'error'>('rendering');
  const [renderError, setRenderError] = useState<string>();
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [renderScaleRevision, setRenderScaleRevision] = useState(0);
  const [rendererRevision, setRendererRevision] = useState(0);
  const [panning, setPanning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const canvasStyle: CSSProperties & { '--diagram-ground': string } = {
    '--diagram-ground': diagramBackground,
  };

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event: MediaQueryListEvent) => setReducedMotion(event.matches);

    setReducedMotion(preference.matches);
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  const fitPreview = () => {
    const stage = canvasRef.current;
    const canvas = stage?.parentElement;
    const svg = stage?.querySelector('svg');
    if (
      !stage ||
      !canvas ||
      !svg ||
      svg.viewBox.baseVal.width <= 0 ||
      svg.viewBox.baseVal.height <= 0
    ) {
      setView({ zoom: 1, x: 0, y: 0 });
      return;
    }

    const bounds = svg.getBBox();
    const containedScale = Math.min(
      stage.clientWidth / svg.viewBox.baseVal.width,
      stage.clientHeight / svg.viewBox.baseVal.height,
    );
    const renderedWidth = Math.max(bounds.width * containedScale, 1);
    const desiredWidth = canvas.clientWidth * 0.86;
    const maxZoom = canvas.clientWidth < 520 ? 1.45 : 1.2;
    const minZoom = canvas.clientWidth < 520 ? 0.92 : 0.7;
    const zoom = Math.min(Math.max(desiredWidth / renderedWidth, minZoom), maxZoom);
    setView({ zoom, x: 0, y: 0 });
  };

  useEffect(() => {
    userAdjustedView.current = false;
    fitPreview();
  }, [fitNonce]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => {
      if (!userAdjustedView.current) fitPreview();
      setRenderScaleRevision((current) => current + 1);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sequence = ++renderSequence.current;
    exportSnapshotRef.current = undefined;
    onGifExportInfoChange?.(undefined);
    setRenderState('rendering');
    setTargets([]);
    setSelectedTarget(undefined);
    setInspecting(false);
    setTimeline(undefined);
    onTargetsChange(diagramSource, []);
    const timeout = window.setTimeout(async () => {
      try {
        const renderer = rendererRef.current;
        if (rendererRevision === 0) return;
        if (!renderer) throw new Error('The isolated Mermaid renderer could not start.');
        const result = await renderPreviewInFrame(renderer, {
          id: `mermotion-preview-${sequence}`,
          source: diagramSource,
        });
        if (sequence !== renderSequence.current || !canvasRef.current) return;

        const safeSvg = neutralizeSvgNetworkResources(result.svg);
        exportSnapshotRef.current = {
          diagramSource,
          diagramType: result.diagramType,
          svg: safeSvg,
        };
        canvasRef.current.innerHTML = safeSvg;
        const svg = canvasRef.current.querySelector('svg');
        if (!svg) throw new Error('Mermaid did not return an SVG document.');

        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Rendered Mermaid diagram');

        const inventory = discoverTargets(svg, result.diagramType);
        addConnectionHitAreas(svg, inventory);
        setTargets(inventory);
        onTargetsChange(diagramSource, inventory);
        setSelectedTarget((current) => inventory.find(({ key }) => key === current?.key));
        setRenderError(undefined);
        setRenderState('ready');
        if (!userAdjustedView.current) requestAnimationFrame(fitPreview);
        onRender();
      } catch (error) {
        if (sequence !== renderSequence.current) return;
        const message = errorMessage(error);
        exportSnapshotRef.current = undefined;
        onGifExportInfoChange?.(undefined);
        setRenderError(message);
        setRenderState('error');
        setTargets([]);
        onTargetsChange(diagramSource, []);
        onDiagnosticsChange([{ message, severity: 'error' }]);
      }
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [
    diagramSource,
    onDiagnosticsChange,
    onGifExportInfoChange,
    onRender,
    onTargetsChange,
    rendererRevision,
  ]);

  useEffect(() => {
    onGifExportInfoChange?.(undefined);
    if (renderState !== 'ready') return;

    try {
      const compiled = compileMotion({ mermaidSource: diagramSource, motionSource }, { targets });
      setTimeline(compiled.timeline);
      if (compiled.timeline) onDurationChange(compiled.timeline.durationMs);
      else {
        const svg = canvasRef.current?.querySelector('svg');
        if (svg) clearMotionFromSvg(svg);
      }
      onDiagnosticsChange(toUiDiagnostics(compiled.diagnostics));
      const snapshot = exportSnapshotRef.current;
      const svg = canvasRef.current?.querySelector('svg');
      const hasErrors = compiled.diagnostics.some(({ severity }) => severity === 'error');
      if (compiled.timeline && !hasErrors && snapshot?.diagramSource === diagramSource && svg) {
        const dimensions = viewBoxDimensions(svg);
        onGifExportInfoChange?.({
          diagramSource,
          durationMs: compiled.timeline.durationMs,
          motionSource,
          viewBoxHeight: dimensions.height,
          viewBoxWidth: dimensions.width,
        });
      }
    } catch (error) {
      setTimeline(undefined);
      const svg = canvasRef.current?.querySelector('svg');
      if (svg) clearMotionFromSvg(svg);
      onDiagnosticsChange([{ message: errorMessage(error), severity: 'error' }]);
    }
  }, [
    diagramSource,
    motionSource,
    onDiagnosticsChange,
    onDurationChange,
    onGifExportInfoChange,
    renderState,
    targets,
  ]);

  const exportGif = useCallback<GifExporter>(
    async (settings, options) => {
      throwIfAborted(options.signal);
      const snapshot = exportSnapshotRef.current;
      if (!snapshot || snapshot.diagramSource !== diagramSource || renderState !== 'ready') {
        throw new Error('Wait for the current Mermaid diagram to finish rendering before export.');
      }

      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.inert = true;
      Object.assign(host.style, {
        background: diagramBackground,
        height: '1px',
        left: '-100000px',
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'fixed',
        top: '0',
        width: '1px',
        zIndex: '-1',
      });
      host.innerHTML = snapshot.svg;
      document.body.append(host);

      try {
        throwIfAborted(options.signal);
        const svg = host.querySelector('svg');
        if (!(svg instanceof SVGSVGElement)) {
          throw new Error('Mermaid did not return an exportable SVG document.');
        }
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const baseViewBox = viewBoxDimensions(svg);
        svg.setAttribute('height', `${baseViewBox.height}`);
        svg.setAttribute('width', `${baseViewBox.width}`);
        svg.style.display = 'block';
        svg.style.maxWidth = 'none';

        const exportTargets = discoverTargets(svg, snapshot.diagramType);
        const compiled = compileMotion(
          { mermaidSource: diagramSource, motionSource },
          { targets: exportTargets },
        );
        const compileError = compiled.diagnostics.find(({ severity }) => severity === 'error');
        if (compileError) throw new Error(compileError.message);
        const exportTimeline = compiled.timeline;
        if (!exportTimeline) throw new Error('The current motion source could not be compiled.');

        const plan = createGifFramePlan(
          exportTimeline.durationMs,
          settings.frameRate,
          settings.endPauseMs,
        );
        svg.style.overflow = 'visible';
        const settled = settleMotionViewport(
          svg,
          exportTargets,
          plan.frames.map(({ timeMs: frameTimeMs }) => frameTimeMs),
          {
            fit: ({ height, width }) => fitGifDimensions(width, height, settings.width),
            resize: ({ height, width }) => {
              host.style.height = `${height}px`;
              host.style.width = `${width}px`;
              svg.setAttribute('height', `${height}`);
              svg.setAttribute('width', `${width}`);
              svg.style.height = `${height}px`;
              svg.style.maxHeight = 'none';
              svg.style.width = `${width}px`;
            },
            sample: (frameTimeMs) => sampleTimeline(exportTimeline, frameTimeMs),
            throwIfCanceled: () => throwIfAborted(options.signal),
          },
        );
        const dimensions = settled.dimensions;
        validateGifWorkload(dimensions, plan.frames.length);
        const canvas = document.createElement('canvas');
        canvas.height = dimensions.height;
        canvas.width = dimensions.width;
        const encoder = createGifFrameEncoder(
          dimensions.width,
          dimensions.height,
          gifRepeatCount(settings.loopMode, settings.playCount),
        );
        const bytes = await encodeGifFrames(
          plan,
          async (frameTimeMs) => {
            throwIfAborted(options.signal);
            applyFrameToSvg(svg, exportTargets, sampleTimeline(exportTimeline, frameTimeMs), {
              reducedMotion: false,
            });
            return rasterizeSvg(svg, canvas, diagramBackground, options.signal);
          },
          encoder,
          {
            onProgress: options.onProgress,
            signal: options.signal,
            yieldControl: () =>
              new Promise((resolve) => {
                window.setTimeout(resolve, 0);
              }),
          },
        );
        return {
          bytes,
          frameCount: plan.frames.length,
          height: dimensions.height,
          playbackMs: plan.playbackMs,
          width: dimensions.width,
        };
      } finally {
        host.remove();
      }
    },
    [diagramBackground, diagramSource, motionSource, renderState],
  );

  useImperativeHandle(ref, () => ({ exportGif }), [exportGif]);

  useEffect(() => {
    const svg = canvasRef.current?.querySelector('svg');
    if (!svg || !timeline) return;
    applyFrameToSvg(svg, targets, sampleTimeline(timeline, timeMs), { reducedMotion });
    markTarget(svg, selectedTarget?.key, 'data-mermotion-selected');
  }, [
    reducedMotion,
    renderScaleRevision,
    selectedTarget?.key,
    targets,
    timeMs,
    timeline,
    view.zoom,
  ]);

  useEffect(() => {
    const clearSelection = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedTarget(undefined);
    };
    window.addEventListener('keydown', clearSelection);
    return () => window.removeEventListener('keydown', clearSelection);
  }, []);

  const selectFromEvent = (element: EventTarget | null) => {
    const svg = canvasRef.current?.querySelector('svg');
    if (!svg || !(element instanceof Element)) return;
    const target = resolveTargetFromElement(targets, element);
    setSelectedTarget(target);
    setInspecting(false);
    markTarget(svg, target?.key, 'data-mermotion-selected');
  };

  const copyTarget = async () => {
    if (!selectedTarget) return;
    await writeClipboardText(selectedTarget.key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  };

  return (
    <section
      className={readOnly ? 'preview-region is-read-only' : 'preview-region'}
      aria-label="Preview"
    >
      <iframe
        aria-hidden="true"
        className="preview-render-realm"
        onLoad={() => setRendererRevision((revision) => revision + 1)}
        ref={rendererRef}
        sandbox="allow-scripts"
        srcDoc={previewRendererDocument}
        tabIndex={-1}
        title="Isolated Mermaid renderer"
      />
      <header className="region-heading preview-heading">
        <h2>Preview</h2>
        <div className="preview-heading-tools">
          <div className="preview-state" aria-live="polite">
            {renderState === 'rendering' ? (
              <>
                <LoaderCircle aria-hidden="true" className="spinning" size={13} /> Rendering
              </>
            ) : renderState === 'error' ? (
              <span className="has-error">Render failed</span>
            ) : (
              <>
                <span className="target-count">{targets.length}</span> semantic targets
              </>
            )}
          </div>
          <div className="preview-zoom" aria-label="Preview zoom controls">
            <button
              aria-label="Zoom out"
              data-tooltip="Zoom out"
              onClick={() => {
                userAdjustedView.current = true;
                setView((current) => ({ ...current, zoom: Math.max(0.65, current.zoom - 0.15) }));
              }}
              type="button"
            >
              <ZoomOut aria-hidden="true" size={13} />
            </button>
            <output aria-label="Preview zoom">{Math.round(view.zoom * 100)}%</output>
            <button
              aria-label="Zoom in"
              data-tooltip="Zoom in"
              onClick={() => {
                userAdjustedView.current = true;
                setView((current) => ({ ...current, zoom: Math.min(2.4, current.zoom + 0.15) }));
              }}
              type="button"
            >
              <ZoomIn aria-hidden="true" size={13} />
            </button>
            <button
              aria-label="Fit diagram"
              data-tooltip="Fit diagram"
              onClick={() => {
                userAdjustedView.current = false;
                fitPreview();
              }}
              type="button"
            >
              <Scan aria-hidden="true" size={13} />
            </button>
          </div>
        </div>
      </header>
      <div
        className={panning ? 'preview-canvas is-panning' : 'preview-canvas'}
        style={canvasStyle}
        onClick={(event) => {
          if (didPan.current) {
            didPan.current = false;
            return;
          }
          if (readOnly) return;
          selectFromEvent(event.target);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !(event.target instanceof Element)) return;
          const target = resolveTargetFromElement(targets, event.target);
          if (!readOnly && target && target.kind !== 'diagram') return;
          didPan.current = false;
          dragStart.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            panX: view.x,
            panY: view.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerLeave={() => {
          const svg = canvasRef.current?.querySelector('svg');
          if (svg) markTarget(svg, undefined, 'data-mermotion-hovered');
        }}
        onPointerMove={(event) => {
          const drag = dragStart.current;
          if (drag?.pointerId === event.pointerId) {
            if (Math.abs(event.clientX - drag.x) > 2 || Math.abs(event.clientY - drag.y) > 2) {
              didPan.current = true;
            }
            userAdjustedView.current = true;
            setView((current) => ({
              ...current,
              x: drag.panX + event.clientX - drag.x,
              y: drag.panY + event.clientY - drag.y,
            }));
            return;
          }
          if (readOnly) return;
          const svg = canvasRef.current?.querySelector('svg');
          if (!svg || !(event.target instanceof Element)) return;
          const target = resolveTargetFromElement(targets, event.target);
          markTarget(svg, target?.key, 'data-mermotion-hovered');
        }}
        onPointerUp={(event) => {
          if (dragStart.current?.pointerId === event.pointerId) {
            dragStart.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
            setPanning(false);
          }
        }}
        onPointerCancel={() => {
          dragStart.current = undefined;
          setPanning(false);
        }}
      >
        <div aria-hidden="true" className="canvas-coordinate x-coordinate">
          x
        </div>
        <div aria-hidden="true" className="canvas-coordinate y-coordinate">
          y
        </div>
        {renderState === 'error' ? (
          <div className="preview-error" role="alert">
            <span>Preview held at the last valid state</span>
            <strong>{renderError}</strong>
          </div>
        ) : null}
        <div
          className="mermaid-stage"
          ref={canvasRef}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        />

        {!readOnly && selectedTarget ? (
          <aside
            className="target-hud"
            aria-label={`Selected target ${selectedTarget.label ?? selectedTarget.id}`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="target-identity">
              <Crosshair aria-hidden="true" size={15} />
              <span>
                <small>{selectedTarget.kind}</small>
                <strong>{selectedTarget.label ?? selectedTarget.id}</strong>
              </span>
            </div>
            <div className="target-actions">
              <button
                disabled={
                  selectedTarget.kind === 'edge' && (!selectedTarget.from || !selectedTarget.to)
                }
                onClick={() => onAddPulse(selectedTarget)}
                type="button"
              >
                Animate
              </button>
              <button onClick={() => void copyTarget()} type="button">
                {copied ? (
                  <Check aria-hidden="true" size={13} />
                ) : (
                  <Copy aria-hidden="true" size={13} />
                )}
                {copied ? 'Copied' : 'Copy target'}
              </button>
              <button onClick={() => setInspecting((value) => !value)} type="button">
                Inspect
              </button>
              <button
                aria-label="Clear target selection"
                className="target-close"
                data-tooltip="Clear selection  Esc"
                onClick={() => setSelectedTarget(undefined)}
                type="button"
              >
                <X aria-hidden="true" size={13} />
              </button>
            </div>
            {inspecting ? (
              <dl className="target-inspector">
                <div>
                  <dt>Target</dt>
                  <dd>{selectedTarget.key}</dd>
                </div>
                <div>
                  <dt>Order</dt>
                  <dd>{selectedTarget.order}</dd>
                </div>
                {selectedTarget.from ? (
                  <div>
                    <dt>Route</dt>
                    <dd>
                      {selectedTarget.from} → {selectedTarget.to}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </aside>
        ) : !readOnly ? (
          <div className="canvas-hint">
            <Crosshair aria-hidden="true" size={13} />{' '}
            {renderState === 'error'
              ? 'Fix Mermaid source to refresh selectable targets'
              : renderState === 'rendering'
                ? 'Rendering current source'
                : 'Select a node or connection to animate it'}
          </div>
        ) : null}
      </div>
    </section>
  );
});
