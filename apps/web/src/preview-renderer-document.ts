import rendererRuntimeUrl from './preview-renderer-runtime.ts?worker&url';

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/**
 * A srcdoc frame without allow-same-origin has an opaque origin. Vite emits the worker entry as a
 * classic IIFE for production; its development-only ES module is served to the `null` origin.
 */
const scriptType = import.meta.env.DEV ? ' type="module"' : '';

export function createPreviewRendererDocument(): string {
  const scriptNonce = crypto.randomUUID().replaceAll('-', '');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
    <title>Mermotion preview renderer</title>
  </head>
  <body>
    <script${scriptType} nonce="${scriptNonce}" src="${escapeAttribute(rendererRuntimeUrl)}"></script>
  </body>
</html>`;
}

export const previewRendererDocument = createPreviewRendererDocument();
