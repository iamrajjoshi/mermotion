/* oxlint-disable typescript/no-unsafe-type-assertion -- DOM-shaped test doubles isolate the API without a browser runtime. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderPreviewInFrame } from './preview-renderer-api';
import { previewRendererDocument } from './preview-renderer-document';

type MessageListener = (event: MessageEvent<unknown>) => void;

function installWindowHarness() {
  const listeners = new Set<MessageListener>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: MessageListener) => {
      if (type === 'message') listeners.add(listener);
    },
    clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
    removeEventListener: (type: string, listener: MessageListener) => {
      if (type === 'message') listeners.delete(listener);
    },
    setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout),
  });
  return {
    dispatch(event: MessageEvent<unknown>) {
      for (const listener of listeners) listener(event);
    },
    listeners,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preview renderer recovery', () => {
  it('restarts one poisoned realm and lets a later render finish', async () => {
    vi.useFakeTimers();
    const messages = installWindowHarness();
    const postMessage = vi.fn();
    const rendererWindow = { postMessage } as unknown as Window;
    const loadListeners = new Set<() => void>();
    let rendererDocument = previewRendererDocument;
    let restartCount = 0;
    const iframe = {
      addEventListener(type: string, listener: () => void) {
        if (type === 'load') loadListeners.add(listener);
      },
      contentWindow: rendererWindow,
      get srcdoc() {
        return rendererDocument;
      },
      set srcdoc(value: string) {
        rendererDocument = value;
        restartCount += 1;
      },
      sandbox: 'allow-scripts',
    } as unknown as HTMLIFrameElement;

    const firstFailure = renderPreviewInFrame(iframe, {
      id: 'stuck-first',
      source: 'flowchart LR\n  A --> B\n',
    }).catch((error: unknown) => error);
    const queuedFailure = renderPreviewInFrame(iframe, {
      id: 'queued-second',
      source: 'flowchart LR\n  A --> B\n',
    }).catch((error: unknown) => error);

    expect(postMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await firstFailure).toMatchObject({
      message: 'The isolated Mermaid renderer timed out.',
    });
    expect(await queuedFailure).toMatchObject({
      message: 'The isolated Mermaid renderer timed out.',
    });
    expect(restartCount).toBe(1);
    expect(rendererDocument).not.toBe(previewRendererDocument);
    expect(rendererDocument).toContain("default-src 'none'");
    expect(rendererDocument).toContain("connect-src 'none'");
    expect(iframe.sandbox).toBe('allow-scripts');
    expect(messages.listeners.size).toBe(0);

    for (const listener of loadListeners) listener();
    loadListeners.clear();
    await expect(
      renderPreviewInFrame(iframe, {
        id: 'automatic-retry',
        source: 'flowchart LR\n  A --> B\n',
      }),
    ).rejects.toThrow('The isolated Mermaid renderer timed out.');
    expect(postMessage).toHaveBeenCalledTimes(2);

    const recovered = renderPreviewInFrame(iframe, {
      id: 'recovered-third',
      source: 'flowchart LR\n  A --> B\n',
    });
    const request = postMessage.mock.calls.at(-1)?.[0] as { requestId?: unknown } | undefined;
    expect(request).toBeDefined();
    expect(typeof request?.requestId).toBe('string');
    messages.dispatch({
      data: {
        channel: 'mermotion.preview.v1',
        kind: 'render-result',
        requestId: request?.requestId,
        result: { diagramType: 'flowchart-v2', svg: '<svg />' },
      },
      origin: 'null',
      source: rendererWindow,
    } as MessageEvent<unknown>);

    await expect(recovered).resolves.toEqual({
      diagramType: 'flowchart-v2',
      svg: '<svg />',
    });
    expect(messages.listeners.size).toBe(0);
  });
});
