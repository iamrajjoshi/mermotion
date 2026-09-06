export const DEMO_DURATION_MS = 4_800;

export function clampTime(timeMs: number, durationMs: number): number {
  if (!Number.isFinite(timeMs) || durationMs <= 0) return 0;
  return Math.min(Math.max(timeMs, 0), durationMs);
}

export function formatTimecode(timeMs: number): string {
  const clamped = Math.max(0, Math.round(timeMs));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const centiseconds = Math.floor((clamped % 1_000) / 10);

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export function timeToPercent(timeMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (clampTime(timeMs, durationMs) / durationMs) * 100;
}
