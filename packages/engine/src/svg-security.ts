const FETCHING_ELEMENTS = new Set([
  'audio',
  'base',
  'embed',
  'iframe',
  'link',
  'meta',
  'object',
  'script',
  'source',
  'track',
  'video',
]);

const SVG_ANIMATION_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'discard',
  'set',
]);

const NAVIGATION_CONTAINERS = new Set(['form']);

const URL_ATTRIBUTES = new Set([
  'action',
  'archive',
  'background',
  'cite',
  'codebase',
  'data',
  'formaction',
  'href',
  'longdesc',
  'manifest',
  'ping',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'xlink:href',
]);

const CSS_REFERENCE_ATTRIBUTES = new Set([
  'clip-path',
  'color-profile',
  'cursor',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
]);

const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+[\s\S]*?;/gi;
const INLINE_RASTER_IMAGE_PATTERN =
  /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i;
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function isLocalFragment(value: string): boolean {
  return value.trim().startsWith('#');
}

function scrubCss(css: string): string {
  return css
    .replace(CSS_IMPORT_PATTERN, '')
    .replace(CSS_URL_PATTERN, (match, doubleQuoted, singleQuoted, unquoted) => {
      const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? '').trim();
      return isLocalFragment(value) ? match : 'none';
    });
}

function scrubStyleAttribute(css: string): string {
  const probe = document.createElement('span');
  probe.setAttribute('style', css);
  for (const property of probe.style) {
    const value = probe.style.getPropertyValue(property);
    const sanitized = scrubCss(value);
    if (sanitized === value) continue;
    if (sanitized.includes('none')) probe.style.removeProperty(property);
    else probe.style.setProperty(property, sanitized, probe.style.getPropertyPriority(property));
  }
  return probe.style.cssText;
}

function scrubStyleSheet(css: string): string {
  if (typeof CSSStyleSheet === 'undefined') return scrubCss(css);
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return Array.from(sheet.cssRules, (rule) => scrubCss(rule.cssText)).join('\n');
  } catch {
    return scrubCss(css);
  }
}

function scrubPresentationAttribute(name: string, value: string): string | undefined {
  const probe = document.createElement('span');
  probe.style.setProperty(name, value);
  const normalized = probe.style.getPropertyValue(name);
  if (!normalized) return value;
  const sanitized = scrubCss(normalized);
  return sanitized.includes('none') ? undefined : sanitized;
}

function allowsUrlAttribute(element: Element, name: string, value: string): boolean {
  if ((name === 'href' || name === 'xlink:href') && isLocalFragment(value)) return true;
  return (
    element.localName.toLowerCase() === 'image' &&
    (name === 'href' || name === 'xlink:href') &&
    INLINE_RASTER_IMAGE_PATTERN.test(value.trim())
  );
}

/** Keep image nodes measurable without letting Mermaid's live render pass load their URL. */
export function neutralizeMermaidImageSources(source: string): string {
  return source.replace(
    /(\bimg\s*:\s*)(["'])(.*?)\2/gi,
    (statement, prefix: string, quote: string, value: string) =>
      INLINE_RASTER_IMAGE_PATTERN.test(value.trim())
        ? statement
        : `${prefix}${quote}${TRANSPARENT_PIXEL}${quote}`,
  );
}

/**
 * Remove fetch, navigation, script, and animation surfaces before rendered SVG leaves its isolated
 * browser realm. Internal fragment references and inline raster images remain available so Mermaid
 * markers and explicitly embedded image data keep rendering.
 */
export function neutralizeSvgNetworkResources(markup: string): string {
  const inertDocument = document.createElement('template');
  inertDocument.innerHTML = markup;
  const root = inertDocument.content.querySelector('svg');
  if (!root) throw new Error('Mermaid did not return an SVG document.');

  for (const element of [root, ...root.querySelectorAll('*')]) {
    const localName = element.localName.toLowerCase();
    if (FETCHING_ELEMENTS.has(localName) || SVG_ANIMATION_ELEMENTS.has(localName)) {
      element.remove();
      continue;
    }

    if (NAVIGATION_CONTAINERS.has(localName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    if (localName === 'style') {
      element.textContent = scrubStyleSheet(element.textContent ?? '');
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttributeNode(attribute);
        continue;
      }
      if (name === 'style') {
        element.setAttribute(attribute.name, scrubStyleAttribute(attribute.value));
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !allowsUrlAttribute(element, name, attribute.value)) {
        element.removeAttributeNode(attribute);
        element.setAttribute('data-mermotion-resource-blocked', '');
        continue;
      }
      if (CSS_REFERENCE_ATTRIBUTES.has(name)) {
        const sanitized = scrubPresentationAttribute(name, attribute.value);
        if (sanitized === undefined) element.removeAttributeNode(attribute);
        else if (sanitized !== attribute.value) element.setAttribute(attribute.name, sanitized);
      }
    }
  }

  return root.outerHTML;
}
