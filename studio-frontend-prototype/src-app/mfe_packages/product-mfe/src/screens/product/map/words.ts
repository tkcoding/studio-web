/** What the map's parts share: glyphs, hues, drag types and the words' keys. */

import type { MapNode } from '../../../model/product-map';
import type { useMapTranslations } from '../../../i18n';

export type Text = ReturnType<typeof useMapTranslations>['t'];

export type MapLook = 'subsystems' | 'compact';

export const DRAG_MFE = 'application/x-pmap-mfe';
export const DRAG_GEAR = 'application/x-pmap-gear';
export const LOOK_KEY = 'studio.productMap.look';

/** A node's kind at a glance, before its name. */
export const KIND_GLYPH: Record<MapNode['detail']['kind'], string> = {
  shell: '▭',
  mfe: '▣',
  gear: '⚙',
  plugin: '⧉',
  'missing-gear': '⚠',
  technology: '⛁',
  database: '▤',
};

/** A node's kind in words. */
export const kindWord = (t: Text, kind: MapNode['detail']['kind']): string => t(`kind_${kind.replace('-', '_')}`);

/** A node's state in words; empty for `ok`. */
export const stateWord = (t: Text, state: MapNode['state']): string => (state === 'ok' ? '' : t(`state_${state}`));

/** Well-apart hues; a group keeps its own across renders and projects. */
const HUES = [212, 152, 268, 28, 336, 188, 88, 300, 4, 124, 240, 48];
export function hueOf(group: string): number {
  let h = 0;
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** The screens a micro-frontend's node says it shows (its "Shows …" fact). */
export function screensOf(n: MapNode): string[] {
  const shows = n.detail.facts.find((f) => f.startsWith('Shows '));
  return shows ? shows.replace(/^Shows /, '').replace(/\.$/, '').split(', ') : [];
}
