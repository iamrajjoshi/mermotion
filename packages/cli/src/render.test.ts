import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rendererSetupTimeoutMs = 10 * 60_000;
const renderTimeoutMs = 30_000;
const rendererCleanupTimeoutMs = 5_000;

const mocks = vi.hoisted(() => {
  const abort = vi.fn(async () => undefined);
  const childListeners = new Map<string, (...arguments_: unknown[]) => void>();
  const childKill = vi.fn(() => true);
  const childOnce = vi.fn((event: string, listener: (...arguments_: unknown[]) => void) => {
    childListeners.set(event, listener);
  });
  const closeWebSocket = vi.fn(async () => undefined);
  const child = { kill: childKill, once: childOnce };
  return {
    access: vi.fn(async () => undefined),
    abort,
    addInitScript: vi.fn(async () => undefined),
    browserClose: vi.fn(async () => undefined),
    childKill,
    childListeners,
    closeWebSocket,
    evaluate: vi.fn(async (): Promise<unknown> => ({
      svg: '<svg data-mermotion-cli-root=""></svg>',
      diagramType: 'flowchart-v2',
      targetCount: 1,
      durationMs: 0,
      diagnostics: [],
    })),
    launch: vi.fn(),
    newContext: vi.fn(),
    newPage: vi.fn(),
    route: vi.fn(
      async (
        _url: string,
        handler: (route: { abort: (errorCode: string) => Promise<void> }) => unknown,
      ) => {
        await handler({ abort });
      },
    ),
    routeWebSocket: vi.fn(
      async (
        _url: string,
        handler: (webSocket: {
          close: (options: { code: number; reason: string }) => Promise<void>;
        }) => unknown,
      ) => {
        await handler({ close: closeWebSocket });
      },
    ),
    setContent: vi.fn(async () => undefined),
    spawn: vi.fn(() => child),
  };
});

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  access: mocks.access,
}));

vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));

import { prepareRenderer, renderDiagram } from './render.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('renderer process isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.childListeners.clear();
    mocks.browserClose.mockResolvedValue(undefined);
    mocks.evaluate.mockResolvedValue({
      svg: '<svg data-mermotion-cli-root=""></svg>',
      diagramType: 'flowchart-v2',
      targetCount: 1,
      durationMs: 0,
      diagnostics: [],
    });
    mocks.newPage.mockResolvedValue({
      evaluate: mocks.evaluate,
      setContent: mocks.setContent,
    });
    mocks.newContext.mockResolvedValue({
      addInitScript: mocks.addInitScript,
      newPage: mocks.newPage,
      route: mocks.route,
      routeWebSocket: mocks.routeWebSocket,
    });
    mocks.launch.mockResolvedValue({
      close: mocks.browserClose,
      newContext: mocks.newContext,
    });
  });

  it('kills renderer setup and returns a stable diagnostic when installation times out', async () => {
    vi.useFakeTimers();

    const setup = prepareRenderer().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(rendererSetupTimeoutMs);

    expect(await setup).toMatchObject({
      code: 'CLI_RENDERER_SETUP_TIMEOUT',
      exitCode: 3,
      message: 'Mermotion renderer setup timed out. Check network access, then retry.',
    });
    expect(mocks.childKill).toHaveBeenCalledOnce();
    expect(mocks.childKill).toHaveBeenCalledWith('SIGKILL');
  });

  it('blocks request and WebSocket channels before processing source in a CSP realm', async () => {
    await renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    });

    expect(mocks.launch).toHaveBeenCalledWith({
      chromiumSandbox: true,
      headless: true,
      timeout: renderTimeoutMs,
    });
    expect(mocks.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(mocks.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(mocks.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ serviceWorkers: 'block' }),
    );
    expect(mocks.addInitScript).toHaveBeenCalledWith({
      path: expect.stringMatching(/renderer\.js$/),
    });
    expect(mocks.access).toHaveBeenCalledOnce();
    expect(mocks.access).toHaveBeenCalledWith(
      expect.stringMatching(/\/dist\/browser\/renderer\.js$/),
    );
    expect(mocks.setContent).toHaveBeenCalledWith(
      expect.stringMatching(/default-src 'none'.*connect-src 'none'.*worker-src 'none'/s),
    );
    expect(mocks.route.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.newPage.mock.invocationCallOrder[0]!,
    );
    expect(mocks.routeWebSocket.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.newPage.mock.invocationCallOrder[0]!,
    );
    expect(mocks.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.newPage.mock.invocationCallOrder[0]!,
    );

    expect(mocks.abort).toHaveBeenCalledWith('blockedbyclient');

    expect(mocks.closeWebSocket).toHaveBeenCalledWith({
      code: 1008,
      reason: 'Network access is disabled.',
    });
  });

  it('reports one missing bundled renderer path before starting Chromium', async () => {
    mocks.access.mockRejectedValueOnce(new Error('missing'));

    await expect(
      renderDiagram({
        mermaidSource: 'flowchart LR\n  A --> B\n',
        timeMs: 0,
        format: 'svg',
      }),
    ).rejects.toMatchObject({
      code: 'CLI_RENDER_BUNDLE_MISSING',
      exitCode: 2,
    });
    expect(mocks.access).toHaveBeenCalledOnce();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it('renders every GIF frame in one isolated browser evaluation', async () => {
    const bytes = new Uint8Array([71, 73, 70, 56, 57, 97]);
    mocks.evaluate.mockResolvedValueOnce({
      animation: { frameCount: 4, height: 540, playbackMs: 620, width: 960 },
      bytes,
      diagramType: 'flowchart-v2',
      targetCount: 4,
      durationMs: 120,
      diagnostics: [],
    });

    const result = await renderDiagram({
      endPauseMs: 500,
      format: 'gif',
      mermaidSource: 'flowchart LR\n  A --> B\n',
      motionSource: 'motionDiagram-v1\n  pulse B for 120ms\n',
      repeat: 0,
    });

    expect(result).toEqual({
      animation: { frameCount: 4, height: 540, playbackMs: 620, width: 960 },
      bytes,
      diagramType: 'flowchart-v2',
      targetCount: 4,
      durationMs: 120,
      diagnostics: [],
    });
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(mocks.newContext).toHaveBeenCalledOnce();
    expect(mocks.newPage).toHaveBeenCalledOnce();
    expect(mocks.evaluate).toHaveBeenCalledOnce();
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      endPauseMs: 500,
      mermaidSource: 'flowchart LR\n  A --> B\n',
      motionSource: 'motionDiagram-v1\n  pulse B for 120ms\n',
      repeat: 0,
    });
  });

  it('closes Chromium and returns a stable diagnostic when rendering times out', async () => {
    vi.useFakeTimers();
    const evaluationStarted = new Promise<void>((resolve) => {
      mocks.evaluate.mockImplementationOnce(() => {
        resolve();
        return new Promise<never>(() => undefined);
      });
    });

    const rendering = renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    }).catch((error: unknown) => error);
    await evaluationStarted;
    await vi.advanceTimersByTimeAsync(renderTimeoutMs);

    expect(await rendering).toMatchObject({
      code: 'CLI_RENDER_TIMEOUT',
      exitCode: 3,
      message: 'Mermotion rendering timed out. Simplify the diagram or motion source, then retry.',
    });
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it('bounds renderer cleanup and returns a stable timeout diagnostic', async () => {
    vi.useFakeTimers();
    const cleanupStarted = new Promise<void>((resolve) => {
      mocks.browserClose.mockImplementationOnce(() => {
        resolve();
        return new Promise<never>(() => undefined);
      });
    });

    const rendering = renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    }).catch((error: unknown) => error);
    await cleanupStarted;
    await vi.advanceTimersByTimeAsync(rendererCleanupTimeoutMs);

    expect(await rendering).toMatchObject({
      code: 'CLI_RENDERER_CLEANUP_TIMEOUT',
      exitCode: 3,
      message: 'Mermotion could not stop its local renderer in time. Retry the command.',
    });
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it('keeps renderer cleanup failures behind a stable diagnostic', async () => {
    mocks.browserClose.mockRejectedValueOnce(
      new Error('browser.close: playwright protocol details and a local filesystem path'),
    );

    const failure = renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    });

    await expect(failure).rejects.toMatchObject({
      code: 'CLI_RENDERER_CLEANUP_FAILED',
      exitCode: 3,
      message: 'Mermotion could not stop its local renderer. Retry the command.',
    });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringMatching(/playwright|browser\.close|filesystem/i),
    });
  });

  it('reports missing renderer setup without exposing the driver command', async () => {
    mocks.launch.mockRejectedValueOnce(
      new Error("browserType.launch: Executable doesn't exist at /missing/chromium"),
    );

    const failure = renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    });

    await expect(failure).rejects.toMatchObject({
      code: 'CLI_RENDERER_NOT_READY',
      exitCode: 2,
      message: expect.stringContaining('mermotion setup'),
    });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringMatching(/playwright/i),
    });
  });

  it('keeps other renderer startup failures behind a stable diagnostic', async () => {
    mocks.launch.mockRejectedValueOnce(
      new Error(
        'browserType.launch: Host system is missing dependencies. Run playwright install-deps.',
      ),
    );

    const failure = renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    });

    await expect(failure).rejects.toMatchObject({
      code: 'CLI_RENDERER_START_FAILED',
      exitCode: 3,
    });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringMatching(/playwright/i),
    });
  });

  it('keeps in-page failures behind a stable Mermotion diagnostic', async () => {
    mocks.evaluate.mockRejectedValueOnce(
      new Error('page.evaluate: playwright protocol details and a local filesystem path'),
    );

    const failure = renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      timeMs: 0,
      format: 'svg',
    });

    await expect(failure).rejects.toMatchObject({
      code: 'CLI_RENDER_FAILED',
      exitCode: 3,
      message:
        'Mermotion could not render this diagram. Check the Mermaid and motion source, then retry.',
    });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringMatching(/playwright|page\.evaluate|filesystem/i),
    });
  });
});
