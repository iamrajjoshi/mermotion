import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AnimationRenderResult,
  BrowserFrameRequest,
  BrowserFrameResult,
  BrowserGifRequest,
  BrowserGifResult,
  BrowserRendererApi,
  BrowserRenderMetadata,
} from './browser-contract.js';

export type RenderFormat = 'gif' | 'png' | 'svg';

interface FrameRenderRequest extends BrowserFrameRequest {
  format: 'png' | 'svg';
}

interface GifRenderRequest extends BrowserGifRequest {
  format: 'gif';
}

export type RenderRequest = FrameRenderRequest | GifRenderRequest;

export interface RenderResult extends BrowserRenderMetadata {
  animation?: AnimationRenderResult | null;
  bytes: Uint8Array;
}

export class RenderRuntimeError extends Error {
  readonly code: string;
  readonly exitCode: 2 | 3;

  constructor(code: string, message: string, exitCode: 2 | 3, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RenderRuntimeError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

const bundledRendererPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'browser',
  'renderer.js',
);

const rendererSetupTimeoutMs = 10 * 60_000;
const renderTimeoutMs = 30_000;
const gifRenderTimeoutMs = 2 * 60_000;
const rendererCleanupTimeoutMs = 5_000;

const renderDocument = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; connect-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"
    >
    <style>html,body{margin:0;padding:0;background:transparent}body{display:inline-block}</style>
  </head>
  <body></body>
</html>`;

function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // The stable timeout diagnostic is more useful than a secondary cleanup failure.
      }
      reject(timeoutError());
    }, timeoutMs);

    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function findRendererBundle(): Promise<string> {
  try {
    await access(bundledRendererPath);
    return bundledRendererPath;
  } catch {
    throw new RenderRuntimeError(
      'CLI_RENDER_BUNDLE_MISSING',
      'The Mermotion browser renderer is missing. Reinstall Mermotion or run its build before rendering.',
      2,
    );
  }
}

function rendererLaunchError(error: unknown): RenderRuntimeError {
  const message = error instanceof Error ? error.message : String(error);
  if (/executable.*(?:doesn['’]t exist|not found)|browser.*not found/i.test(message)) {
    return new RenderRuntimeError(
      'CLI_RENDERER_NOT_READY',
      'Mermotion rendering is not set up. Run "mermotion setup" (or "pnpm mermotion setup" from the source checkout) and retry.',
      2,
      { cause: error },
    );
  }
  return new RenderRuntimeError(
    'CLI_RENDERER_START_FAILED',
    'Mermotion could not start local rendering. Check local system requirements and permissions, then retry.',
    3,
    { cause: error },
  );
}

export async function prepareRenderer(): Promise<void> {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve('playwright/package.json');
    const installerPath = path.join(path.dirname(packagePath), 'cli.js');
    const child = spawn(process.execPath, [installerPath, 'install', 'chromium'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const completion = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolve();
        else
          reject(new Error(`Renderer setup exited with ${code ?? signal ?? 'an unknown status'}.`));
      });
    });
    await withDeadline(
      completion,
      rendererSetupTimeoutMs,
      () =>
        new RenderRuntimeError(
          'CLI_RENDERER_SETUP_TIMEOUT',
          'Mermotion renderer setup timed out. Check network access, then retry.',
          3,
        ),
      () => {
        child.kill('SIGKILL');
      },
    );
  } catch (error) {
    if (error instanceof RenderRuntimeError) throw error;
    throw new RenderRuntimeError(
      'CLI_RENDERER_SETUP_FAILED',
      'Mermotion could not prepare local rendering. Check network access and filesystem permissions, then retry.',
      3,
      { cause: error },
    );
  }
}

async function loadRenderer() {
  try {
    return (await import('playwright')).chromium;
  } catch (error) {
    throw new RenderRuntimeError(
      'CLI_RENDERER_UNAVAILABLE',
      'The Mermotion local renderer is unavailable. Reinstall Mermotion and retry.',
      3,
      { cause: error },
    );
  }
}

export async function renderDiagram(request: RenderRequest): Promise<RenderResult> {
  const rendererBundlePath = await findRendererBundle();

  const chromium = await loadRenderer();
  let browser;
  try {
    browser = await chromium.launch({
      chromiumSandbox: true,
      headless: true,
      timeout: renderTimeoutMs,
    });
  } catch (error) {
    throw rendererLaunchError(error);
  }

  let browserClosePromise: Promise<void> | undefined;
  const startBrowserClose = (): Promise<void> => {
    if (browserClosePromise) return browserClosePromise;
    try {
      browserClosePromise = browser.close();
    } catch (error) {
      browserClosePromise = Promise.reject(error);
    }
    return browserClosePromise;
  };

  const finishBrowserClose = async (): Promise<void> => {
    try {
      await withDeadline(
        startBrowserClose(),
        rendererCleanupTimeoutMs,
        () =>
          new RenderRuntimeError(
            'CLI_RENDERER_CLEANUP_TIMEOUT',
            'Mermotion could not stop its local renderer in time. Retry the command.',
            3,
          ),
        () => undefined,
      );
    } catch (error) {
      if (error instanceof RenderRuntimeError) throw error;
      throw new RenderRuntimeError(
        'CLI_RENDERER_CLEANUP_FAILED',
        'Mermotion could not stop its local renderer. Retry the command.',
        3,
        { cause: error },
      );
    }
  };

  let renderOutcome: { ok: true; result: RenderResult } | { error: RenderRuntimeError; ok: false };
  try {
    const render = async (): Promise<RenderResult> => {
      const context = await browser.newContext({
        colorScheme: 'light',
        deviceScaleFactor: 1,
        serviceWorkers: 'block',
        viewport: { width: 1_600, height: 1_200 },
      });
      await context.route('**/*', (route) => route.abort('blockedbyclient'));
      await context.routeWebSocket('**/*', (webSocket) =>
        webSocket.close({ code: 1008, reason: 'Network access is disabled.' }),
      );
      // Install trusted code before the CSP-protected document exists. The renderer processes user
      // source only after the document has denied connections, workers, frames, and active content.
      await context.addInitScript({ path: rendererBundlePath });
      const page = await context.newPage();
      await page.setContent(renderDocument);
      if (request.format === 'gif') {
        const result = await page.evaluate(
          async (input: BrowserGifRequest): Promise<BrowserGifResult> => {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            const realm = globalThis as typeof globalThis & BrowserRendererApi;
            return realm.mermotionRenderGif(input);
          },
          {
            endPauseMs: request.endPauseMs,
            mermaidSource: request.mermaidSource,
            ...(request.motionSource === undefined ? {} : { motionSource: request.motionSource }),
            repeat: request.repeat,
          },
        );

        return {
          animation: result.animation,
          bytes: result.bytes,
          diagramType: result.diagramType,
          targetCount: result.targetCount,
          durationMs: result.durationMs,
          diagnostics: result.diagnostics,
        };
      }

      const result = await page.evaluate(
        async (input: BrowserFrameRequest): Promise<BrowserFrameResult> => {
          // The bundle defines this one private entry point inside the page realm.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          const realm = globalThis as typeof globalThis & BrowserRendererApi;
          return realm.mermotionRenderFrame(input);
        },
        {
          mermaidSource: request.mermaidSource,
          ...(request.motionSource === undefined ? {} : { motionSource: request.motionSource }),
          timeMs: request.timeMs,
        },
      );

      const bytes =
        request.format === 'png'
          ? await page.locator('svg[data-mermotion-cli-root]').screenshot({
              animations: 'disabled',
              omitBackground: true,
              type: 'png',
            })
          : new TextEncoder().encode(`${result.svg}\n`);

      return {
        bytes,
        diagramType: result.diagramType,
        targetCount: result.targetCount,
        durationMs: result.durationMs,
        diagnostics: result.diagnostics,
      };
    };

    renderOutcome = {
      ok: true,
      result: await withDeadline(
        render(),
        request.format === 'gif' ? gifRenderTimeoutMs : renderTimeoutMs,
        () =>
          new RenderRuntimeError(
            'CLI_RENDER_TIMEOUT',
            'Mermotion rendering timed out. Simplify the diagram or motion source, then retry.',
            3,
          ),
        () => {
          void startBrowserClose().catch(() => undefined);
        },
      ),
    };
  } catch (error) {
    renderOutcome = {
      error:
        error instanceof RenderRuntimeError
          ? error
          : new RenderRuntimeError(
              'CLI_RENDER_FAILED',
              'Mermotion could not render this diagram. Check the Mermaid and motion source, then retry.',
              3,
              { cause: error },
            ),
      ok: false,
    };
  }

  let cleanupFailure: RenderRuntimeError | undefined;
  try {
    await finishBrowserClose();
  } catch (error) {
    cleanupFailure =
      error instanceof RenderRuntimeError
        ? error
        : new RenderRuntimeError(
            'CLI_RENDERER_CLEANUP_FAILED',
            'Mermotion could not stop its local renderer. Retry the command.',
            3,
            { cause: error },
          );
  }

  if (!renderOutcome.ok) throw renderOutcome.error;
  if (cleanupFailure) throw cleanupFailure;
  return renderOutcome.result;
}
