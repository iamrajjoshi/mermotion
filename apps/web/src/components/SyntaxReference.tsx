import { BookOpenText, Check, Copy, ExternalLink, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { SemanticTarget } from '@mermotion/engine';

import { writeClipboardText } from '../clipboard';
import {
  CANONICAL_MOTION_EXAMPLE,
  filterSyntaxEntries,
  resolveSyntaxEntries,
  type ResolvedSyntaxEntry,
} from '../syntax-reference';

interface SyntaxReferenceProps {
  motionSource: string;
  onInsertMotion: (source: string) => void;
  onOpenMotion: () => void;
  targets: SemanticTarget[];
}

export function SyntaxReference({
  motionSource,
  onInsertMotion,
  onOpenMotion,
  targets,
}: SyntaxReferenceProps) {
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string>();
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const resolvedEntries = useMemo(
    () => resolveSyntaxEntries(targets, motionSource),
    [motionSource, targets],
  );
  const visibleEntries = useMemo(
    () => filterSyntaxEntries(query, resolvedEntries),
    [query, resolvedEntries],
  );
  const groupedEntries = useMemo(() => {
    const groups = new Map<ResolvedSyntaxEntry['group'], ResolvedSyntaxEntry[]>();
    for (const entry of visibleEntries) {
      const group = groups.get(entry.group) ?? [];
      group.push(entry);
      groups.set(entry.group, group);
    }
    return groups;
  }, [visibleEntries]);

  const copy = async (id: string, value: string) => {
    try {
      await writeClipboardText(value);
      setCopyFailed(false);
      setCopiedId(id);
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopiedId(undefined), 1_400);
    } catch {
      setCopiedId(undefined);
      setCopyFailed(true);
    }
  };

  return (
    <section
      aria-labelledby="source-tab-syntax"
      className="syntax-reference"
      id="motion-syntax-reference"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="syntax-reference-intro">
        <div>
          <span className="syntax-reference-mark" aria-hidden="true">
            <BookOpenText size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h3>Motion syntax</h3>
            <p>
              Motion lives in diagram.motion and targets Mermaid IDs. Insert appears when the
              current preview has a matching target.
            </p>
          </div>
        </div>
        <button className="syntax-open-motion" onClick={onOpenMotion} type="button">
          Open diagram.motion
        </button>
      </div>

      <label className="syntax-search">
        <Search aria-hidden="true" size={14} />
        <span className="sr-only">Search motion syntax</span>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search effects, timing, or targets"
          type="search"
          value={query}
        />
      </label>

      <div className="syntax-reference-scroll">
        {!query ? (
          <section className="syntax-example" aria-labelledby="syntax-example-title">
            <header>
              <div>
                <h4 id="syntax-example-title">Complete example</h4>
                <p>
                  Unprefixed cues run in sequence. Use <code>with</code> only when cues overlap.
                </p>
              </div>
              <button
                aria-label="Copy complete motion example"
                onClick={() => void copy('example', CANONICAL_MOTION_EXAMPLE)}
                type="button"
              >
                {copiedId === 'example' ? (
                  <Check aria-hidden="true" size={12} />
                ) : (
                  <Copy aria-hidden="true" size={12} />
                )}
                {copiedId === 'example' ? 'Copied' : 'Copy'}
              </button>
            </header>
            <pre>
              <code>{CANONICAL_MOTION_EXAMPLE}</code>
            </pre>
          </section>
        ) : null}

        {visibleEntries.length ? (
          [...groupedEntries.entries()].map(([group, groupEntries]) => (
            <section className="syntax-group" key={group}>
              <h4>{group}</h4>
              {groupEntries.map((entry) => (
                <article className="syntax-entry" key={entry.id}>
                  <div className="syntax-entry-heading">
                    <span>{entry.label}</span>
                    <div className="syntax-entry-actions">
                      {entry.insertSource ? (
                        <button
                          aria-label={`Insert ${entry.label.toLowerCase()} example in diagram.motion`}
                          onClick={() => {
                            if (entry.insertSource) onInsertMotion(entry.insertSource);
                          }}
                          type="button"
                        >
                          <Plus aria-hidden="true" size={12} /> Insert
                        </button>
                      ) : null}
                      <button
                        aria-label={`Copy ${entry.label.toLowerCase()} syntax`}
                        onClick={() => void copy(entry.id, entry.source)}
                        type="button"
                      >
                        {copiedId === entry.id ? (
                          <Check aria-hidden="true" size={12} />
                        ) : (
                          <Copy aria-hidden="true" size={12} />
                        )}
                        {copiedId === entry.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <code>{entry.source}</code>
                  <p>{entry.description}</p>
                </article>
              ))}
            </section>
          ))
        ) : (
          <p className="syntax-empty">No canonical syntax matches “{query}”.</p>
        )}
      </div>

      <footer className="syntax-reference-footer">
        <span aria-live="polite">
          {copyFailed ? 'Clipboard unavailable' : copiedId ? 'Copied to clipboard' : ''}
        </span>
        <a
          href="https://mermaid.js.org/intro/syntax-reference.html"
          rel="noreferrer"
          target="_blank"
        >
          Mermaid diagram syntax <ExternalLink aria-hidden="true" size={11} />
        </a>
      </footer>
    </section>
  );
}
