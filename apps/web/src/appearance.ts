export type HexColor = `#${string}`;

export const shellPaletteNames = ['Graphite', 'Blueprint', 'Paper', 'Midnight'] as const;
export type ShellPaletteName = (typeof shellPaletteNames)[number];

export const shellPaletteFields = [
  'workspace',
  'surface',
  'raised',
  'canvas',
  'ink',
  'muted',
  'rule',
  'header',
  'headerInk',
  'transport',
  'accent',
  'warning',
  'danger',
] as const;
export type ShellPaletteField = (typeof shellPaletteFields)[number];

export interface ShellPalette extends Record<ShellPaletteField, HexColor> {
  name: ShellPaletteName;
}

export interface AppearancePreference {
  shellPreset: ShellPaletteName;
  shellOverrides?: Partial<Record<ShellPaletteField, HexColor>>;
}

export const shellPalettes: Readonly<Record<ShellPaletteName, ShellPalette>> = {
  Graphite: {
    name: 'Graphite',
    workspace: '#15171c',
    surface: '#1d2027',
    raised: '#272b34',
    canvas: '#f4f6f8',
    ink: '#f2f4f7',
    muted: '#9ca4b2',
    rule: '#383e49',
    header: '#101217',
    headerInk: '#f7f8fa',
    transport: '#ff5470',
    accent: '#5b8cff',
    warning: '#e4a951',
    danger: '#ef6a72',
  },
  Blueprint: {
    name: 'Blueprint',
    workspace: '#0c1b30',
    surface: '#102640',
    raised: '#18314f',
    canvas: '#eaf2ff',
    ink: '#f1f6ff',
    muted: '#93add0',
    rule: '#294a70',
    header: '#081525',
    headerInk: '#f5f8ff',
    transport: '#ff6480',
    accent: '#61a0ff',
    warning: '#f4c35a',
    danger: '#ff7d83',
  },
  Paper: {
    name: 'Paper',
    workspace: '#e7eaee',
    surface: '#f7f8fa',
    raised: '#edf0f4',
    canvas: '#ffffff',
    ink: '#20242c',
    muted: '#68707d',
    rule: '#c7ccd4',
    header: '#262b34',
    headerInk: '#f8f9fb',
    transport: '#d9365f',
    accent: '#3567e8',
    warning: '#a36a00',
    danger: '#c33e4a',
  },
  Midnight: {
    name: 'Midnight',
    workspace: '#090b12',
    surface: '#10141e',
    raised: '#171d29',
    canvas: '#121825',
    ink: '#ecf1fa',
    muted: '#8490a3',
    rule: '#252e3d',
    header: '#060810',
    headerInk: '#f7f9fd',
    transport: '#ff5d87',
    accent: '#b392ff',
    warning: '#ffbf69',
    danger: '#ff6b8a',
  },
};

export const defaultAppearancePreference: AppearancePreference = {
  shellPreset: 'Graphite',
};

export const mermaidPaletteKeys = [
  'primaryColor',
  'primaryTextColor',
  'primaryBorderColor',
  'lineColor',
  'secondaryColor',
  'tertiaryColor',
  'background',
] as const;
export type MermaidPaletteKey = (typeof mermaidPaletteKeys)[number];

export interface MermaidDiagramPalette extends Record<MermaidPaletteKey, HexColor> {}

export const defaultMermaidDiagramPalette: MermaidDiagramPalette = {
  primaryColor: '#f7f8fc',
  primaryTextColor: '#252934',
  primaryBorderColor: '#8790a6',
  lineColor: '#687086',
  secondaryColor: '#e8ebff',
  tertiaryColor: '#eef0f6',
  background: '#f3f5f8',
};

export function normalizeHexColor(value: string | undefined): HexColor | undefined {
  const match = value?.trim().match(/^#?([\da-f]{6})$/i);
  const hex = match?.[1];
  return hex ? `#${hex.toLowerCase()}` : undefined;
}

export function isHexColor(value: string | undefined): value is HexColor {
  return /^#[\da-f]{6}$/i.test(value ?? '');
}

export function isShellPaletteName(value: string | undefined): value is ShellPaletteName {
  return shellPaletteNames.some((name) => name === value);
}

export function resolveShellPalette(
  preference: Partial<AppearancePreference> | undefined,
): ShellPalette {
  const name = isShellPaletteName(preference?.shellPreset)
    ? preference.shellPreset
    : defaultAppearancePreference.shellPreset;
  const preset = shellPalettes[name];
  const resolved: ShellPalette = { ...preset };

  for (const field of shellPaletteFields) {
    const override = normalizeHexColor(preference?.shellOverrides?.[field]);
    if (override) resolved[field] = override;
  }

  return resolved;
}

function colorChannels(color: HexColor): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function blendColors(from: HexColor, to: HexColor, amount: number): HexColor {
  const source = colorChannels(from);
  const destination = colorChannels(to);
  const channel = (index: number) =>
    Math.round(source[index]! + (destination[index]! - source[index]!) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function linearChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function isDark(color: HexColor): boolean {
  const [red, green, blue] = colorChannels(color).map((channel) => channel / 255);
  return (
    linearChannel(red!) * 0.2126 + linearChannel(green!) * 0.7152 + linearChannel(blue!) * 0.0722 <
    0.38
  );
}

function relativeLuminance(color: HexColor): number {
  const [red, green, blue] = colorChannels(color).map((channel) => linearChannel(channel / 255));
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

function contrastRatio(first: HexColor, second: HexColor): number {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brightest + 0.05) / (darkest + 0.05);
}

function contrastInk(background: HexColor): HexColor {
  const darkInk: HexColor = '#101217';
  const lightInk: HexColor = '#ffffff';
  return contrastRatio(darkInk, background) >= contrastRatio(lightInk, background)
    ? darkInk
    : lightInk;
}

export function shellPaletteCssVariables(palette: ShellPalette): Record<string, string> {
  const dark = isDark(palette.surface);
  const brightTarget: HexColor = dark ? '#ffffff' : '#000000';
  const washAmount = dark ? 0.2 : 0.12;

  return {
    '--graphite': palette.workspace,
    '--panel': palette.surface,
    '--raised': palette.raised,
    '--deep': palette.header,
    '--rule': palette.rule,
    '--rule-strong': blendColors(palette.rule, palette.ink, 0.28),
    '--ink': palette.ink,
    '--muted': palette.muted,
    '--faint': blendColors(palette.muted, palette.workspace, 0.28),
    '--motion': palette.accent,
    '--motion-bright': blendColors(palette.accent, brightTarget, 0.18),
    '--motion-wash': blendColors(palette.surface, palette.accent, washAmount),
    '--amber': palette.warning,
    '--amber-wash': blendColors(palette.surface, palette.warning, washAmount),
    '--coral': palette.danger,
    '--coral-wash': blendColors(palette.surface, palette.danger, washAmount),
    '--header': palette.header,
    '--header-ink': palette.headerInk,
    '--header-muted': blendColors(palette.headerInk, palette.header, 0.38),
    '--transport': palette.transport,
    '--transport-ink': contrastInk(palette.transport),
    '--canvas': palette.canvas,
  };
}

export function resolveMermaidPalette(
  palette: Partial<MermaidDiagramPalette>,
  fallback: MermaidDiagramPalette = defaultMermaidDiagramPalette,
): MermaidDiagramPalette {
  const resolved = { ...fallback };
  for (const key of mermaidPaletteKeys) {
    const color = normalizeHexColor(palette[key]);
    if (color) resolved[key] = color;
  }
  return resolved;
}

export { readMermaidPalette, writeMermaidPalette } from './theme';
