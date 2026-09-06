import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { SceneWorkspace } from '../scenes';

interface PresentationViewProps {
  children: ReactNode;
  isPlaying: boolean;
  onClose: () => void;
  onNext: () => void;
  onPlayToggle: () => void;
  onPrevious: () => void;
  onSelect: (sceneId: string) => void;
  workspace: SceneWorkspace;
}

export function PresentationView({
  children,
  isPlaying,
  onClose,
  onNext,
  onPlayToggle,
  onPrevious,
  onSelect,
  workspace,
}: PresentationViewProps) {
  const activeIndex = workspace.scenes.findIndex(({ id }) => id === workspace.activeSceneId);
  const activeScene = workspace.scenes[activeIndex]!;

  return (
    <div className="presentation-shell">
      <header className="presentation-header">
        <button className="presentation-exit" onClick={onClose} type="button">
          <X aria-hidden="true" size={15} /> Exit
        </button>
        <div className="presentation-identity" aria-live="polite">
          <span>
            {String(activeIndex + 1).padStart(2, '0')} /{' '}
            {String(workspace.scenes.length).padStart(2, '0')}
          </span>
          <strong>{activeScene.name}</strong>
        </div>
        <nav className="presentation-controls" aria-label="Presentation controls">
          <button
            aria-label="Previous scene"
            disabled={activeIndex <= 0}
            onClick={onPrevious}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={15} />
            <span>Previous</span>
          </button>
          <button
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            className="presentation-play"
            onClick={onPlayToggle}
            type="button"
          >
            {isPlaying ? (
              <Pause aria-hidden="true" fill="currentColor" size={13} />
            ) : (
              <Play aria-hidden="true" fill="currentColor" size={13} />
            )}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            aria-label="Next scene"
            disabled={activeIndex >= workspace.scenes.length - 1}
            onClick={onNext}
            type="button"
          >
            <span>Next</span>
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </nav>
      </header>
      <main className="presentation-stage">{children}</main>
      <nav className="presentation-scenes" aria-label="Presentation scenes">
        {workspace.scenes.map((scene, index) => (
          <button
            aria-current={scene.id === workspace.activeSceneId ? 'step' : undefined}
            key={scene.id}
            onClick={() => onSelect(scene.id)}
            type="button"
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {scene.name}
          </button>
        ))}
      </nav>
    </div>
  );
}
