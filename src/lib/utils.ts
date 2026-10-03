/**
 * Core Shared Utilities
 * Centralized utility helpers to eliminate duplicate implementations across modules.
 * Direct npm DOMPurify import without vendoring.
 */

import DOMPurify from 'dompurify';
import { logger } from './logger.js';

/**
 * Retrieves the dynamic extension version from the Chrome manifest without hardcoding.
 */
export function getAppVersion(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) return manifest.version;
    } catch (err) {
      logger.captureError('utils', err, { action: 'getAppVersion' });
    }
  }
  return '2.0.0';
}

/**
 * Escapes HTML special characters to prevent XSS in text and attributes.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes rich HTML markup using direct npm DOMPurify.
 */
export function sanitizeHtml(dirty: unknown): string {
  if (dirty === null || dirty === undefined) return '';
  if (DOMPurify?.sanitize) {
    return DOMPurify.sanitize(String(dirty));
  }
  return escapeHtml(dirty);
}

/**
 * Generates a random alphanumeric unique ID.
 */
export function uid(len = 6): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

/**
 * Creates a debounced function that delays invoking fn until after wait milliseconds.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 200): (...args: A) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (...args: A): void {
    if (timeout !== null) clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn(...args);
    }, wait);
  };
}

/**
 * Safely redacts sensitive customer PII for debug exports while preserving length info.
 */
export function sanitizeRedacted(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s.length === 0) return '';
  return `[REDACTED len=${s.length}]`;
}
