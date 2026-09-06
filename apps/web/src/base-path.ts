export function normalizeBasePath(configuredPath: string | undefined): string {
  const path = configuredPath?.trim().replace(/^\/+|\/+$/g, '');
  return path ? `/${path}/` : '/';
}
