import { useMemo, useRef, useState } from 'react';
import { Braces, FileCode2 } from 'lucide-react';

export type SourceFile = 'diagram' | 'motion';

export interface UiDiagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
}

interface SourceEditorProps {
  activeFile: SourceFile;
  diagramSource: string;
  motionSource: string;
  diagnostics: UiDiagnostic[];
  onActiveFileChange: (file: SourceFile) => void;
  onDiagramSourceChange: (source: string) => void;
  onMotionSourceChange: (source: string) => void;
}

interface EditorSurfaceProps {
  active: boolean;
  filename: string;
  language: string;
  source: string;
  onChange: (source: string) => void;
}

function EditorSurface({ active, filename, language, source, onChange }: EditorSurfaceProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const lines = useMemo(() => source.split('\n'), [source]);

  const updateCursor = (element: HTMLTextAreaElement) => {
    const beforeCursor = element.value.slice(0, element.selectionStart);
    const rows = beforeCursor.split('\n');
    setCursor({ line: rows.length, column: (rows[rows.length - 1]?.length ?? 0) + 1 });
  };

  return (
    <section
      aria-label={`${filename} editor`}
      className={`editor-surface ${active ? 'is-active' : ''}`}
      hidden={!active}
    >
      <div className="editor-code-area">
        <div ref={gutterRef} aria-hidden="true" className="line-gutter">
          {lines.map((_, index) => (
            <span key={`${filename}-${index}`}>{index + 1}</span>
          ))}
        </div>
        <textarea
          aria-label={`Edit ${filename}`}
          autoCapitalize="off"
          autoComplete="off"
          className="source-textarea"
          data-source-file={filename}
          onChange={(event) => onChange(event.target.value)}
          onClick={(event) => updateCursor(event.currentTarget)}
          onKeyUp={(event) => updateCursor(event.currentTarget)}
          onScroll={(event) => {
            if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          spellCheck={false}
          value={source}
          wrap="off"
        />
      </div>
      <footer className="editor-meta" aria-label="Editor position">
        <span>{language}</span>
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
      </footer>
    </section>
  );
}

export function SourceEditor({
  activeFile,
  diagramSource,
  motionSource,
  diagnostics,
  onActiveFileChange,
  onDiagramSourceChange,
  onMotionSourceChange,
}: SourceEditorProps) {
  const errorCount = diagnostics.filter(({ severity }) => severity === 'error').length;

  return (
    <section className="source-region" aria-label="Source">
      <header className="source-heading">
        <h2 className="sr-only">Source</h2>
        <div className="source-tabs" role="tablist" aria-label="Source files">
          <button
            aria-selected={activeFile === 'diagram'}
            className={activeFile === 'diagram' ? 'source-tab is-active' : 'source-tab'}
            onClick={() => onActiveFileChange('diagram')}
            role="tab"
            type="button"
          >
            <FileCode2 aria-hidden="true" size={14} strokeWidth={1.8} />
            diagram.mmd
            <span className="file-state" aria-hidden="true" />
          </button>
          <button
            aria-selected={activeFile === 'motion'}
            className={activeFile === 'motion' ? 'source-tab is-active' : 'source-tab'}
            onClick={() => onActiveFileChange('motion')}
            role="tab"
            type="button"
          >
            <Braces aria-hidden="true" size={14} strokeWidth={1.8} />
            diagram.motion
            <span className="file-state" aria-hidden="true" />
          </button>
        </div>
        <span className={errorCount ? 'region-state has-error' : 'region-state'}>
          {errorCount ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : 'Valid'}
        </span>
      </header>
      <div className="editor-deck">
        <EditorSurface
          active={activeFile === 'diagram'}
          filename="diagram.mmd"
          language="Mermaid"
          onChange={onDiagramSourceChange}
          source={diagramSource}
        />
        <EditorSurface
          active={activeFile === 'motion'}
          filename="diagram.motion"
          language="Motion v1"
          onChange={onMotionSourceChange}
          source={motionSource}
        />
      </div>
      <div className="diagnostic-drawer" aria-live="polite">
        {diagnostics.length > 0 ? (
          diagnostics.slice(0, 2).map((diagnostic, index) => (
            <button
              className={`diagnostic-line is-${diagnostic.severity}`}
              key={`${diagnostic.message}-${index}`}
              onClick={() =>
                onActiveFileChange(
                  diagnostic.message.toLowerCase().includes('motion') ? 'motion' : activeFile,
                )
              }
              type="button"
            >
              <span>{diagnostic.severity}</span>
              <span>{diagnostic.message}</span>
              {diagnostic.line ? <span>:{diagnostic.line}</span> : null}
            </button>
          ))
        ) : (
          <div className="diagnostic-empty">
            <span className="status-light" />
            Source and motion agree
          </div>
        )}
      </div>
    </section>
  );
}
