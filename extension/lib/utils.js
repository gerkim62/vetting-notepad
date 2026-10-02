/**
 * Core Shared Utilities
 * Centralized utility helpers to eliminate duplicate implementations across modules.
 * Reuses vendored DOMPurify for standard HTML sanitization and dynamic manifest versioning.
 */

import DOMPurify from '../vendor/dompurify/purify.es.mjs';

function getPurifier() {
  if (DOMPurify && DOMPurify.sanitize) return DOMPurify;
  if (typeof DOMPurify === 'function') {
    return DOMPurify(typeof window !== 'undefined' ? window : undefined);
  }
  return null;
}

/**
 * Retrieves the dynamic extension version from the Chrome manifest without hardcoding.
 * @returns {string} Version string from manifest.json or fallback.
 */
export function getAppVersion() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest && manifest.version) return manifest.version;
    } catch {}
  }
  return '2.0.0';
}

/**
 * Sanitizes rich HTML markup using the vendored DOMPurify library.
 * @param {*} dirty - Unsafe HTML string.
 * @returns {string} Safe HTML string.
 */
export function sanitizeHtml(dirty) {
  if (dirty == null) return '';
  const purifier = getPurifier();
  if (purifier && purifier.sanitize) {
    return purifier.sanitize(String(dirty));
  }
  return escapeHtml(dirty);
}

/**
 * Escapes HTML special characters to prevent XSS in text and attributes.
 * @param {*} str - Input to escape.
 * @returns {string} HTML-escaped string.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a random alphanumeric unique ID.
 * @param {number} [len=6] - Desired string length.
 * @returns {string} Unique identifier.
 */
export function uid(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

/**
 * Creates a debounced function that delays invoking fn until after wait milliseconds.
 * @param {Function} fn - Function to debounce.
 * @param {number} [wait=200] - Delay in milliseconds.
 * @returns {Function} Debounced function.
 */
export function debounce(fn, wait = 200) {
  let timeout = null;
  return function (...args) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Safely redacts sensitive customer PII for debug exports while preserving length info.
 * @param {*} val - Value to redact.
 * @returns {string} Redacted placeholder string.
 */
export function sanitizeRedacted(val) {
  if (val == null) return '';
  const s = String(val).trim();
  if (s.length === 0) return '';
  return `[REDACTED len=${s.length}]`;
}
