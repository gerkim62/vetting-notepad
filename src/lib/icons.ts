/**
 * Vetting Notepad - Unified Lucide Icon Provider
 * Tree-shaken, crisp, consistent Lucide icons.
 */

import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Bookmark,
  BookmarkX,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  Clipboard,
  ClipboardPaste,
  Clock,
  Coffee,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  HelpCircle,
  Info,
  Keyboard,
  Link,
  Menu,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Upload,
  Utensils,
  X,
  Zap,
  createIcons,
  type IconNode
} from 'lucide';
import { logger } from './logger.js';

export const SUPPORTED_ICONS: Record<string, IconNode> = {
  AlertCircle,
  AlertTriangle,
  Ban,
  Bookmark,
  BookmarkX,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  Clipboard,
  ClipboardPaste,
  Clock,
  Coffee,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  HelpCircle,
  Info,
  Keyboard,
  Link,
  Menu,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Upload,
  Utensils,
  X,
  Zap,
  // kebab-case mappings for data-lucide attributes or kebab-case calls
  'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle,
  'ban': Ban,
  'bookmark': Bookmark,
  'bookmark-x': BookmarkX,
  'bug': Bug,
  'check': Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'clipboard': Clipboard,
  'clipboard-paste': ClipboardPaste,
  'clock': Clock,
  'coffee': Coffee,
  'copy': Copy,
  'download': Download,
  'external-link': ExternalLink,
  'eye': Eye,
  'file-text': FileText,
  'flag': Flag,
  'help-circle': HelpCircle,
  'info': Info,
  'keyboard': Keyboard,
  'link': Link,
  'menu': Menu,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  'pencil': Pencil,
  'phone': Phone,
  'pin': Pin,
  'pin-off': PinOff,
  'plus': Plus,
  'rotate-ccw': RotateCcw,
  'search': Search,
  'settings': Settings,
  'trash-2': Trash2,
  'upload': Upload,
  'utensils': Utensils,
  'x': X,
  'zap': Zap
};

export type LucideIconName = keyof typeof SUPPORTED_ICONS | string;

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
  const icon = SUPPORTED_ICONS[name];
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
      icons: SUPPORTED_ICONS,
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
