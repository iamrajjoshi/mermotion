import { Check, Palette, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  mermaidPaletteKeys,
  normalizeHexColor,
  resolveShellPalette,
  shellPaletteNames,
  shellPalettes,
  type AppearancePreference,
  type HexColor,
  type MermaidDiagramPalette,
  type ShellPalette,
  type ShellPaletteField,
} from '../appearance';
import { isMermaidTheme, mermaidThemes, type MermaidTheme } from '../theme';

interface AppearancePanelProps {
  appearance: AppearancePreference;
  diagramPalette: MermaidDiagramPalette;
  diagramTheme: MermaidTheme | 'source';
  motionColor: HexColor;
  onAppearanceChange: (appearance: AppearancePreference) => void;
  onClose: () => void;
  onDiagramColorChange: (key: keyof MermaidDiagramPalette, color: HexColor) => void;
  onDiagramThemeChange: (theme: MermaidTheme) => void;
  onMotionColorChange: (color: HexColor) => void;
  onReset: () => void;
}

interface ColorFieldProps {
  label: string;
  scope: string;
  value: HexColor;
  onChange: (value: HexColor) => void;
}

const interfaceFields: ReadonlyArray<{ key: ShellPaletteField; label: string }> = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'surface', label: 'Surface' },
  { key: 'raised', label: 'Raised surface' },
  { key: 'canvas', label: 'Canvas frame' },
  { key: 'ink', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'rule', label: 'Rules' },
  { key: 'header', label: 'Header' },
  { key: 'headerInk', label: 'Header text' },
];

const stateFields: ReadonlyArray<{ key: ShellPaletteField; label: string }> = [
  { key: 'transport', label: 'Transport' },
  { key: 'accent', label: 'Selection' },
  { key: 'warning', label: 'Timing' },
  { key: 'danger', label: 'Error' },
];

const diagramLabels: Record<keyof MermaidDiagramPalette, string> = {
  primaryColor: 'Node fill',
  primaryTextColor: 'Node text',
  primaryBorderColor: 'Node border',
  lineColor: 'Connections',
  secondaryColor: 'Secondary fill',
  tertiaryColor: 'Group fill',
  background: 'Diagram ground',
};

function ColorField({ label, scope, value, onChange }: ColorFieldProps) {
  const [draft, setDraft] = useState<string>(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const normalized = normalizeHexColor(draft);
    if (normalized) {
      onChange(normalized);
      setDraft(normalized);
    } else setDraft(value);
  };

  return (
    <div className="color-field">
      <label htmlFor={`${scope}-${label}-well`}>{label}</label>
      <input
        aria-label={`${scope} ${label} color`}
        className="color-well"
        id={`${scope}-${label}-well`}
        onChange={(event) => {
          const color = normalizeHexColor(event.target.value);
          if (color) onChange(color);
        }}
        type="color"
        value={value}
      />
      <input
        aria-label={`${scope} ${label} hex`}
        className="color-hex"
        inputMode="text"
        maxLength={7}
        onBlur={commit}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const normalized = normalizeHexColor(next);
          if (normalized && next.length >= 6) onChange(normalized);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        spellCheck={false}
        value={draft}
      />
    </div>
  );
}

function PaletteSample({ palette }: { palette: ShellPalette }) {
  return (
    <span className="palette-sample" aria-hidden="true">
      <i style={{ background: palette.workspace }} />
      <i style={{ background: palette.canvas }} />
      <i style={{ background: palette.accent }} />
    </span>
  );
}

export function AppearancePanel({
  appearance,
  diagramPalette,
  diagramTheme,
  motionColor,
  onAppearanceChange,
  onClose,
  onDiagramColorChange,
  onDiagramThemeChange,
  onMotionColorChange,
  onReset,
}: AppearancePanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const shellPalette = resolveShellPalette(appearance);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;

    const container = panel.parentElement;
    const background = container
      ? Array.from(container.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            element !== panel &&
            !element.classList.contains('appearance-backdrop'),
        )
      : [];
    const previousInert = background.map((element) => element.inert);
    for (const element of background) element.inert = true;

    closeRef.current?.focus();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', containFocus);
    return () => {
      window.removeEventListener('keydown', containFocus);
      background.forEach((element, index) => {
        element.inert = previousInert[index] ?? false;
      });
    };
  }, [onClose]);

  const changeShellColor = (key: ShellPaletteField, color: HexColor) => {
    onAppearanceChange({
      ...appearance,
      shellOverrides: { ...appearance.shellOverrides, [key]: color },
    });
  };

  return (
    <>
      <div aria-hidden="true" className="appearance-backdrop" onClick={onClose} />
      <aside
        aria-label="Appearance"
        aria-modal="true"
        className="appearance-panel"
        data-testid="appearance-panel"
        ref={panelRef}
        role="dialog"
      >
        <header className="appearance-header">
          <div className="appearance-title">
            <span className="appearance-mark">
              <Palette aria-hidden="true" size={15} />
            </span>
            <span>
              <strong>Appearance</strong>
              <small>Interface, Mermaid, and motion</small>
            </span>
          </div>
          <button
            aria-label="Close Appearance"
            className="panel-close"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="appearance-scroll">
          <section className="appearance-section preset-section">
            <div className="appearance-section-heading">
              <div>
                <h3>Desk</h3>
                <p>Choose a starting palette, then tune any role.</p>
              </div>
            </div>
            <div className="palette-presets">
              {shellPaletteNames.map((name) => {
                const selected = appearance.shellPreset === name;
                return (
                  <button
                    aria-pressed={selected}
                    className={selected ? 'palette-preset is-selected' : 'palette-preset'}
                    key={name}
                    onClick={() => onAppearanceChange({ shellPreset: name })}
                    type="button"
                  >
                    <PaletteSample palette={shellPalettes[name]} />
                    <span>{name}</span>
                    {selected ? <Check aria-hidden="true" size={13} /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="appearance-section">
            <div className="appearance-section-heading">
              <div>
                <h3>Interface</h3>
                <p>Saved with this local workspace.</p>
              </div>
            </div>
            <div className="color-fields">
              {interfaceFields.map(({ key, label }) => (
                <ColorField
                  key={key}
                  label={label}
                  onChange={(color) => changeShellColor(key, color)}
                  scope="Interface"
                  value={shellPalette[key]}
                />
              ))}
            </div>
          </section>

          <section className="appearance-section">
            <div className="appearance-section-heading">
              <div>
                <h3>Signals</h3>
                <p>Selection and feedback colors.</p>
              </div>
            </div>
            <div className="color-fields">
              {stateFields.map(({ key, label }) => (
                <ColorField
                  key={key}
                  label={label}
                  onChange={(color) => changeShellColor(key, color)}
                  scope="Interface"
                  value={shellPalette[key]}
                />
              ))}
            </div>
          </section>

          <section className="appearance-section source-owned-section">
            <div className="appearance-section-heading">
              <div>
                <h3>Diagram</h3>
                <p>Written to Mermaid frontmatter.</p>
              </div>
              <label className="compact-select">
                <span>Theme</span>
                <select
                  aria-label="Mermaid diagram theme"
                  onChange={(event) => {
                    const theme = event.target.value;
                    if (isMermaidTheme(theme)) onDiagramThemeChange(theme);
                  }}
                  value={diagramTheme === 'source' ? 'default' : diagramTheme}
                >
                  {mermaidThemes.map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="source-file-chip">diagram.mmd</div>
            <div className="color-fields">
              {mermaidPaletteKeys.map((key) => (
                <ColorField
                  key={key}
                  label={diagramLabels[key]}
                  onChange={(color) => onDiagramColorChange(key, color)}
                  scope="Diagram"
                  value={diagramPalette[key]}
                />
              ))}
            </div>
          </section>

          <section className="appearance-section source-owned-section motion-color-section">
            <div className="appearance-section-heading">
              <div>
                <h3>Motion</h3>
                <p>Written to the defaults line in diagram.motion.</p>
              </div>
            </div>
            <div className="source-file-chip">diagram.motion</div>
            <ColorField
              label="Signal"
              onChange={onMotionColorChange}
              scope="Motion"
              value={motionColor}
            />
            <code>defaults color {motionColor}</code>
          </section>
        </div>

        <footer className="appearance-footer">
          <button className="reset-appearance" onClick={onReset} type="button">
            <RotateCcw aria-hidden="true" size={13} /> Reset all colors
          </button>
          <span>Changes save locally</span>
        </footer>
      </aside>
    </>
  );
}
