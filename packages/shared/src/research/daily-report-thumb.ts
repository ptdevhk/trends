/**
 * Deterministic inline SVG thumbnails for DailyReportPack cards.
 *
 * No external image fetch — v1 stores a `data:image/svg+xml` URI in `imageUrl`.
 * Aesthetic: light industrial paper (cool slate + copper accent).
 */

import type { OpportunityKind } from './daily-report-pack.js';

export type ThumbKind = OpportunityKind | 'story';

export type DailyReportThumbInput = {
  title: string;
  kind: ThumbKind;
  /** Prefer first 1–2 chips as overlay glyphs. */
  chips?: string[];
};

/** Kind → light paper palette (bg, ink, accent, chip fill). */
const PALETTE: Record<
  ThumbKind,
  { bg: string; ink: string; accent: string; chip: string; chipInk: string }
> = {
  商机: {
    bg: '#e8eef5',
    ink: '#1a2332',
    accent: '#2f6fed',
    chip: '#d0dceb',
    chipInk: '#2a3a4d',
  },
  转机: {
    bg: '#e8f2eb',
    ink: '#1a2a20',
    accent: '#1a8f5a',
    chip: '#d0e5d8',
    chipInk: '#2a3d30',
  },
  动态: {
    bg: '#f2ebe4',
    ink: '#2a2218',
    accent: '#c45c26',
    chip: '#e8ddd0',
    chipInk: '#4a3a28',
  },
  story: {
    bg: '#e6ebf0',
    ink: '#1a222c',
    accent: '#5c6b7a',
    chip: '#d5dde5',
    chipInk: '#3a4a5a',
  },
};

/** Stable 32-bit hash for subtle per-title variation (stripe offset). */
export function hashThumbSeed(s: string): number {
  let h = 2166136261;
  const t = s.normalize('NFKC');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Short glyph for chip overlay (CJK keep ≤4, Latin ≤6). */
export function chipGlyph(chip: string, max = 4): string {
  const t = chip.normalize('NFKC').trim();
  if (!t) return '';
  const chars = [...t];
  if (chars.length <= max) return t;
  return `${chars.slice(0, max - 1).join('')}…`;
}

/** Short label glyph for the plate title (CJK keep ≤6, Latin ≤10). */
function plateGlyph(chip: string, max = 6): string {
  const t = chip.normalize('NFKC').trim();
  if (!t) return '行业';
  const chars = [...t];
  if (chars.length <= max) return t;
  return `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Raw SVG markup (no data-URI wrapper). Deterministic for the same inputs.
 */
export function buildDailyReportThumbSvg(input: DailyReportThumbInput): string {
  const pal = PALETTE[input.kind] ?? PALETTE.story;
  const seed = hashThumbSeed(`${input.kind}|${input.title}`);
  const stripeX = 40 + (seed % 80);
  const kindLabel = input.kind === 'story' ? '热点' : input.kind;
  const chips = (input.chips ?? [])
    .map((c) => chipGlyph(c))
    .filter(Boolean)
    .slice(0, 2);

  // Branded plate: overline with kind + a bold keyword/title glyph so a
  // card without a real photo still reads as an industry signal, not a blank.
  const titleGlyph = plateGlyph(input.title);
  const titleY = 90;
  const titleX = 16;
  const titleW = Math.min(150, titleGlyph.length * 17 + 16);

  const chipBlocks = chips
    .map((g, i) => {
      const x = 16 + i * 78;
      return `<rect x="${x}" y="118" width="70" height="22" rx="3" fill="${pal.chip}"/><text x="${x + 35}" y="133" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="${pal.chipInk}">${escapeXml(g)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160" role="img" aria-label="${escapeXml(kindLabel)}">
<rect width="320" height="160" fill="${pal.bg}"/>
<rect x="${stripeX}" y="0" width="28" height="160" fill="${pal.accent}" opacity="0.18"/>
<rect x="${stripeX + 40}" y="0" width="6" height="160" fill="${pal.accent}" opacity="0.35"/>
<text x="16" y="36" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" letter-spacing="0.12em" fill="${pal.accent}">${escapeXml(kindLabel)}</text>
<line x1="16" y1="48" x2="120" y2="48" stroke="${pal.accent}" stroke-width="1" opacity="0.5"/>
<rect x="${titleX}" y="64" width="${titleW}" height="30" rx="4" fill="${pal.accent}" opacity="0.12"/>
<text x="${titleX + 8}" y="${titleY}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="15" font-weight="600" fill="${pal.ink}">${escapeXml(titleGlyph)}</text>
${chipBlocks}
</svg>`.replace(/\n/g, '');
}

/** `data:image/svg+xml` URI suitable for `imageUrl` / `<img src>`. */
export function buildDailyReportThumbDataUri(input: DailyReportThumbInput): string {
  const svg = buildDailyReportThumbSvg(input);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
