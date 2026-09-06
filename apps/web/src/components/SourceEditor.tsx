import { useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { BookOpenText, Braces, FileCode2 } from 'lucide-react';

import type { Diagnostic, SemanticTarget } from '@mermotion/engine';

import { insertMotionSnippet } from '../syntax-reference';
import { SyntaxReference } from './SyntaxReference';

export type SourceFile = 'diagram' | 'motion';
type SourceView = SourceFile | 'syntax';

export interface UiDiagnostic extends Pick<Diagnostic, 'message' | 'severity'> {
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
  onSyntaxOpenChange: (open: boolean) => void;
  syntaxOpen: boolean;
  targets: SemanticTarget[];
}

interface EditorSurfaceProps {
  active: boolean;
  filename: string;
  id: string;
  language: string;
  labelledBy: string;
  source: string;
  onChange: (source: string) => void;
  onSelectionChange?: (selection: { end: number; start: number }) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

function EditorSurface({
  active,
  filename,
  id,
  labelledBy,
  language,
  source,
  onChange,
  onSelectionChange,
  textareaRef,
}: EditorSurfaceProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const lines = useMemo(() => source.split('\n'), [source]);

  const updateCursor = (element: HTMLTextAreaElement) => {
    const beforeCursor = element.value.slice(0, element.selectionStart);
    const rows = beforeCursor.split('\n');
    setCursor({ line: rows.length, column: (rows[rows.length - 1]?.length ?? 0) + 1 });
    onSelectionChange?.({ end: element.selectionEnd, start: element.selectionStart });
  };

  return (
    <section
      aria-label={`${filename} editor`}
      aria-labelledby={labelledBy}
      className={`editor-surface ${active ? 'is-active' : ''}`}
      hidden={!active}
      id={id}
      role="tabpanel"
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
          onSelect={(event) => updateCursor(event.currentTarget)}
          ref={textareaRef}
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
  onSyntaxOpenChange,
  syntaxOpen,
  targets,
}: SourceEditorProps) {
  const errorCount = diagnostics.filter(({ severity }) => severity === 'error').length;
  const activeView: SourceView = syntaxOpen ? 'syntax' : activeFile;
  const motionTextarea = useRef<HTMLTextAreaElement>(null);
  const motionSelection = useRef<{ end: number; start: number } | undefined>(undefined);

  const selectView = (view: SourceView) => {
    if (view === 'syntax') {
      onSyntaxOpenChange(true);
      return;
    }
    onSyntaxOpenChange(false);
    onActiveFileChange(view);
  };

  const moveBetweenTabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const views: SourceView[] = ['diagram', 'motion', 'syntax'];
    const current = views.indexOf(activeView);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      next = (current + direction + views.length) % views.length;
    }
    const view = views[next]!;
    selectView(view);
    document.getElementById(`source-tab-${view}`)?.focus();
  };

  const openMotion = () => {
    selectView('motion');
    window.requestAnimationFrame(() => motionTextarea.current?.focus());
  };

  const insertMotion = (snippet: string) => {
    const inserted = insertMotionSnippet(motionSource, snippet, motionSelection.current);
    onMotionSourceChange(inserted.source);
    selectView('motion');
    window.requestAnimationFrame(() => {
      motionTextarea.current?.focus();
      motionTextarea.current?.setSelectionRange(inserted.cursor, inserted.cursor);
      motionSelection.current = { end: inserted.cursor, start: inserted.cursor };
    });
  };

  return (
    <section className="source-region" aria-label="Source">
      <header className="source-heading">
        <h2 className="sr-only">Source</h2>
        <div className="source-tabs" role="tablist" aria-label="Source views">
          <button
            aria-controls="source-panel-diagram"
            aria-selected={activeView === 'diagram'}
            className={activeView === 'diagram' ? 'source-tab is-active' : 'source-tab'}
            id="source-tab-diagram"
            onClick={() => selectView('diagram')}
            onKeyDown={moveBetweenTabs}
            role="tab"
            tabIndex={activeView === 'diagram' ? 0 : -1}
            type="button"
          >
            <FileCode2 aria-hidden="true" size={14} strokeWidth={1.8} />
            <span className="source-tab-label">diagram.mmd</span>
            <span className="file-state" aria-hidden="true" />
          </button>
          <button
            aria-controls="source-panel-motion"
            aria-selected={activeView === 'motion'}
            className={activeView === 'motion' ? 'source-tab is-active' : 'source-tab'}
            id="source-tab-motion"
            onClick={() => selectView('motion')}
            onKeyDown={moveBetweenTabs}
            role="tab"
            tabIndex={activeView === 'motion' ? 0 : -1}
            type="button"
          >
            <Braces aria-hidden="true" size={14} strokeWidth={1.8} />
            <span className="source-tab-label">diagram.motion</span>
            <span className="file-state" aria-hidden="true" />
          </button>
          <button
            aria-controls="motion-syntax-reference"
            aria-selected={activeView === 'syntax'}
            className={
              activeView === 'syntax' ? 'source-tab syntax-tab is-active' : 'source-tab syntax-tab'
            }
            id="source-tab-syntax"
            onClick={() => selectView('syntax')}
            onKeyDown={moveBetweenTabs}
            role="tab"
            tabIndex={activeView === 'syntax' ? 0 : -1}
            type="button"
          >
            <BookOpenText aria-hidden="true" size={14} strokeWidth={1.8} />
            <span className="source-tab-label">Syntax</span>
          </button>
        </div>
        <span className={errorCount ? 'region-state has-error' : 'region-state'}>
          {errorCount ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : 'Valid'}
        </span>
      </header>
      <div className="editor-deck">
        <EditorSurface
          active={activeView === 'diagram'}
          filename="diagram.mmd"
          id="source-panel-diagram"
          labelledBy="source-tab-diagram"
          language="Mermaid"
          onChange={onDiagramSourceChange}
          source={diagramSource}
        />
        <EditorSurface
          active={activeView === 'motion'}
          filename="diagram.motion"
          id="source-panel-motion"
          labelledBy="source-tab-motion"
          language="Motion v1"
          onChange={onMotionSourceChange}
          onSelectionChange={(selection) => {
            motionSelection.current = selection;
          }}
          source={motionSource}
          textareaRef={motionTextarea}
        />
        {syntaxOpen ? (
          <SyntaxReference
            motionSource={motionSource}
            onInsertMotion={insertMotion}
            onOpenMotion={openMotion}
            targets={targets}
          />
        ) : null}
      </div>
      <div className="diagnostic-drawer" aria-live="polite">
        {diagnostics.length > 0 ? (
          diagnostics.slice(0, 2).map((diagnostic, index) => (
            <button
              className={`diagnostic-line is-${diagnostic.severity}`}
              key={`${diagnostic.message}-${index}`}
              onClick={() =>
                selectView(
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
