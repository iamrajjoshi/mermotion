export class DurationInputError extends Error {
  readonly code = 'CLI_INVALID_DURATION';

  constructor(value: string) {
    super(
      `Invalid duration "${value}". Use a non-negative value ending in ms or s, such as 250ms or 1.5s.`,
    );
    this.name = 'DurationInputError';
  }
}

export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(value.trim());
  if (!match) {
    throw new DurationInputError(value);
  }

  const numericValue = Number(match[1]);
  const milliseconds = match[2] === 's' ? numericValue * 1_000 : numericValue;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new DurationInputError(value);
  }

  return Object.is(milliseconds, -0) ? 0 : milliseconds;
}
