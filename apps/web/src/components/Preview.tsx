import {
  applyFrameToSvg,
  clearMotionFromSvg,
  compileMotion,
  discoverTargets,
  renderMermaid,
  resolveTargetFromElement,
  sampleTimeline,
  type SemanticTarget,
} from '@mermotion/engine';
import { Check, Copy, Crosshair, LoaderCircle, Scan, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { UiDiagnostic } from './SourceEditor';

type CompiledTimeline = NonNullable<ReturnType<typeof compileMotion>['timeline']>;

interface PreviewProps {
  diagramBackground: string;
  diagramSource: string;
  fitNonce: number;
  motionSource: string;
  timeMs: number;
  onAddPulse: (target: SemanticTarget) => void;
  onDiagnosticsChange: (diagnostics: UiDiagnostic[]) => void;
  onDurationChange: (durationMs: number) => void;
  onRender: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readDiagnostics(value: unknown): UiDiagnostic[] {
  if (!value || typeof value !== 'object' || !('diagnostics' in value)) return [];
  const diagnostics = value.diagnostics;
  if (!Array.isArray(diagnostics)) return [];

  return diagnostics.map((diagnostic) => {
    if (!diagnostic || typeof diagnostic !== 'object') {
      return { message: String(diagnostic), severity: 'error' as const };
    }
    const message =
      'message' in diagnostic ? String(diagnostic.message) : 'Invalid motion statement';
    const severityValue = 'severity' in diagnostic ? String(diagnostic.severity) : 'error';
    const severity: UiDiagnostic['severity'] =
      severityValue === 'warning' || severityValue === 'info' ? severityValue : 'error';
    const line =
      'span' in diagnostic &&
      diagnostic.span &&
      typeof diagnostic.span === 'object' &&
      'line' in diagnostic.span &&
      typeof diagnostic.span.line === 'number'
        ? diagnostic.span.line
        : undefined;
    return line === undefined ? { message, severity } : { line, message, severity };
  });
}

function markTarget(root: SVGSVGElement, key: string | undefined, attribute: string) {
  for (const element of root.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
  if (!key) return;

  for (const element of root.querySelectorAll('[data-mermotion-target]')) {
    if (element.getAttribute('data-mermotion-target') === key) element.setAttribute(attribute, '');
  }
}

function addConnectionHitAreas(root: SVGSVGElement, targets: SemanticTarget[]) {
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

export function Preview({
  diagramBackground,
  diagramSource,
  fitNonce,
  motionSource,
  timeMs,
  onAddPulse,
  onDiagnosticsChange,
  onDurationChange,
  onRender,
}: PreviewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
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
  const [panning, setPanning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const canvasStyle: CSSProperties & { '--diagram-ground': string } = {
    '--diagram-ground': diagramBackground,
  };

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
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
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (!userAdjustedView.current) fitPreview();
      setRenderScaleRevision((current) => current + 1);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sequence = ++renderSequence.current;
    const timeout = window.setTimeout(async () => {
      setRenderState('rendering');
      try {
        const result = await renderMermaid({
          id: `mermotion-preview-${sequence}`,
          source: diagramSource,
        });
        if (sequence !== renderSequence.current || !canvasRef.current) return;

        canvasRef.current.innerHTML = result.svg;
        const svg = canvasRef.current.querySelector('svg');
        if (!svg) throw new Error('Mermaid did not return an SVG document.');

        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Rendered Mermaid diagram');
        result.bindFunctions?.(canvasRef.current);

        const inventory = discoverTargets(svg, result.diagramType);
        addConnectionHitAreas(svg, inventory);
        setTargets(inventory);
        setSelectedTarget((current) => inventory.find(({ key }) => key === current?.key));
        setRenderError(undefined);
        setRenderState('ready');
        if (!userAdjustedView.current) requestAnimationFrame(fitPreview);
        onRender();
      } catch (error) {
        if (sequence !== renderSequence.current) return;
        setRenderError(errorMessage(error));
        setRenderState('error');
        setTargets([]);
        onDiagnosticsChange([{ message: errorMessage(error), severity: 'error' }]);
      }
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [diagramSource, onDiagnosticsChange, onRender]);

  useEffect(() => {
    if (renderState !== 'ready') return;

    try {
      const compiled = compileMotion({ mermaidSource: diagramSource, motionSource }, { targets });
      setTimeline(compiled.timeline);
      if (compiled.timeline) onDurationChange(compiled.timeline.durationMs);
      else {
        const svg = canvasRef.current?.querySelector('svg');
        if (svg) clearMotionFromSvg(svg);
      }
      onDiagnosticsChange(readDiagnostics(compiled));
    } catch (error) {
      setTimeline(undefined);
      const svg = canvasRef.current?.querySelector('svg');
      if (svg) clearMotionFromSvg(svg);
      onDiagnosticsChange([{ message: errorMessage(error), severity: 'error' }]);
    }
  }, [diagramSource, motionSource, onDiagnosticsChange, onDurationChange, renderState, targets]);

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
    await navigator.clipboard.writeText(selectedTarget.key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  };

  return (
    <section className="preview-region" aria-label="Preview">
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
          selectFromEvent(event.target);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !(event.target instanceof Element)) return;
          const target = resolveTargetFromElement(targets, event.target);
          if (target && target.kind !== 'diagram') return;
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
          if (dragStart.current?.pointerId === event.pointerId) {
            if (
              Math.abs(event.clientX - dragStart.current.x) > 2 ||
              Math.abs(event.clientY - dragStart.current.y) > 2
            ) {
              didPan.current = true;
            }
            userAdjustedView.current = true;
            setView((current) => ({
              ...current,
              x: dragStart.current!.panX + event.clientX - dragStart.current!.x,
              y: dragStart.current!.panY + event.clientY - dragStart.current!.y,
            }));
            return;
          }
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

        {selectedTarget ? (
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
        ) : (
          <div className="canvas-hint">
            <Crosshair aria-hidden="true" size={13} /> Select a node or connection to animate it
          </div>
        )}
      </div>
    </section>
  );
}
