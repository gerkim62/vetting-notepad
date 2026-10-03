/**
 * Vetting Notepad - Unified Lucide Icon Provider
 * Replaces hardcoded SVGs and emojis with crisp, consistent Lucide icons.
 */

import { icons, createIcons } from 'lucide';
import { logger } from './logger.js';

export type LucideIconName = keyof typeof icons;

export interface IconAttrs {
  size?: number;
  class?: string;
  strokeWidth?: number;
  title?: string;
}

/**
 * Returns an SVG HTML string for the requested Lucide icon.
 */
export function renderIcon(
  name: LucideIconName,
  attrs: IconAttrs = {}
): string {
  const icon = icons[name];
  if (!icon) return '';

  const size = attrs.size ?? 14;
  const strokeWidth = attrs.strokeWidth ?? 2;
  const titleAttr = attrs.title ? `<title>${attrs.title}</title>` : '';
  const className = attrs.class
    ? `lucide lucide-${name.toLowerCase()} ${attrs.class}`
    : `lucide lucide-${name.toLowerCase()}`;

  const children = icon
    .map(([tag, elAttrs]) => {
      const attrStr = Object.entries(elAttrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}></${tag}>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}">${titleAttr}${children}</svg>`;
}

/**
 * Scans the DOM tree for elements with [data-lucide] and replaces them with Lucide SVGs.
 */
export function initIcons(root?: HTMLElement): void {
  if (typeof document === 'undefined') return;
  try {
    createIcons({
      icons,
      nameAttr: 'data-lucide',
      attrs: {
        'stroke-width': '2'
      },
      root: root ?? document.body
    });
  } catch (err) {
    logger.captureError('icons', err, { action: 'initIcons' });
  }
}
