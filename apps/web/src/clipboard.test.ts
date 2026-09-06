import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeClipboardText } from './clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('clipboard writes', () => {
  it('uses the standard asynchronous Clipboard API', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(writeClipboardText('motionDiagram-v1')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('motionDiagram-v1');
  });

  it('fails clearly when clipboard access is unavailable', async () => {
    vi.stubGlobal('navigator', {});

    await expect(writeClipboardText('motionDiagram-v1')).rejects.toThrow(
      'Clipboard access is unavailable.',
    );
  });
});
