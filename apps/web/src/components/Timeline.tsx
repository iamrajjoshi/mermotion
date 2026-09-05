import { Pause, Play, RotateCcw } from 'lucide-react';

import type { CueSummary } from '../cues';
import { formatTimecode, timeToPercent } from '../time';

interface TimelineProps {
  cues: CueSummary[];
  durationMs: number;
  isPlaying: boolean;
  selectedCueId: string | undefined;
  timeMs: number;
  onPlayToggle: () => void;
  onRestart: () => void;
  onSeek: (timeMs: number) => void;
  onSelectCue: (cue: CueSummary) => void;
}

const cueRows: Record<CueSummary['type'], number> = {
  highlight: 0,
  unhighlight: 0,
  reveal: 0,
  hide: 0,
  move: 1,
  trace: 2,
  pulse: 2,
  removeMarker: 2,
};

export function Timeline({
  cues,
  durationMs,
  isPlaying,
  selectedCueId,
  timeMs,
  onPlayToggle,
  onRestart,
  onSeek,
  onSelectCue,
}: TimelineProps) {
  const rulerMarks = Array.from({ length: 5 }, (_, index) => (durationMs / 4) * index);

  return (
    <section className="timeline-region" aria-label="Motion timeline">
      <header className="timeline-heading">
        <div className="timeline-transport">
          <button
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            className="play-button"
            data-tooltip={isPlaying ? 'Pause  Space' : 'Play  Space'}
            onClick={onPlayToggle}
            type="button"
          >
            {isPlaying ? (
              <Pause aria-hidden="true" fill="currentColor" size={14} />
            ) : (
              <Play aria-hidden="true" fill="currentColor" size={14} />
            )}
          </button>
          <button
            aria-label="Restart animation"
            className="icon-button"
            data-tooltip="Restart  R"
            onClick={onRestart}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} />
          </button>
          <output className="timecode" aria-label="Current time">
            {formatTimecode(timeMs)}
          </output>
        </div>
        <div className="timeline-title">
          <h2>Timeline</h2>
          <span data-testid="cue-count">{cues.length} cues</span>
        </div>
        <span className="timeline-duration" data-testid="timeline-duration">
          {formatTimecode(durationMs)}
        </span>
      </header>
      <div className="timeline-body">
        <div className="track-labels" aria-hidden="true">
          <span>
            <i className="lane-key lane-state" /> State
          </span>
          <span>
            <i className="lane-key lane-route" /> Route
          </span>
          <span>
            <i className="lane-key lane-signal" /> Signal
          </span>
        </div>
        <div className="ruler-shell">
          <div className="ruler-labels" aria-hidden="true">
            {rulerMarks.map((mark) => (
              <span key={mark} style={{ left: `${timeToPercent(mark, durationMs)}%` }}>
                {formatTimecode(mark).slice(3)}
              </span>
            ))}
          </div>
          <div className="cue-tracks">
            {cues.map((cue) => {
              const left = timeToPercent(cue.startMs, durationMs);
              const width = Math.max(timeToPercent(cue.durationMs, durationMs), 3.5);
              const selected = selectedCueId === cue.id;
              return (
                <button
                  aria-label={`${cue.type} ${cue.label}, starts ${formatTimecode(cue.startMs)}`}
                  aria-pressed={selected}
                  className={`cue-block cue-${cue.type} ${selected ? 'is-selected' : ''}`}
                  key={cue.id}
                  onClick={() => onSelectCue(cue)}
                  style={{
                    left: `${left}%`,
                    top: `${cueRows[cue.type] * 40 + 8}px`,
                    width: `${Math.min(width, 100 - left)}%`,
                  }}
                  title={`${cue.type} ${cue.label}`}
                  type="button"
                >
                  <span>{cue.type}</span>
                  <strong>{cue.label}</strong>
                </button>
              );
            })}
            <div
              aria-hidden="true"
              className="playhead"
              style={{ left: `${timeToPercent(timeMs, durationMs)}%` }}
            >
              <span />
            </div>
            <input
              aria-label="Seek animation"
              className="timeline-scrubber"
              max={durationMs}
              min={0}
              onChange={(event) => onSeek(Number(event.target.value))}
              step={10}
              type="range"
              value={Math.round(timeMs)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
