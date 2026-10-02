/**
 * Vetting Notepad - Exporter & Importer Library
 * Supports robust multi-tier export for MV3 Chrome Extension side panels:
 * Tier 1: chrome.downloads API (with downloads permission)
 * Tier 2: programmatic Data URI <a> element download
 * Tier 3: Direct JSON copy to clipboard as seamless fallback
 */

import { sanitizeRedacted, getAppVersion } from './utils.js';

/**
 * Builds a standardized export payload with metadata.
 * @param {Object} data 
 * @returns {Object}
 */
export function buildExportPayload({ types = [], settings = {}, savedComments = [], activeTypeId = null, appVersion = null } = {}) {
  return {
    app: 'vetting-notepad',
    version: 1,
    appVersion: appVersion || getAppVersion(),
    exportedAt: new Date().toISOString(),
    types,
    settings,
    savedComments,
    activeTypeId
  };
}

/**
 * Validates whether an incoming payload is a valid Vetting Notepad export file.
 * @param {any} data 
 * @returns {{ valid: boolean, payload?: Object, error?: string }}
 */
export function validateImportPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Invalid JSON: Expected an object.' };
  }

  if (data.app !== 'vetting-notepad') {
    return { valid: false, error: 'Invalid schema: Not a Vetting Notepad backup file.' };
  }

  if (!Array.isArray(data.types) || data.types.length === 0) {
    return { valid: false, error: 'Invalid schema: Missing or empty types configuration.' };
  }

  return { valid: true, payload: data };
}

/**
 * Exports configuration payload using multi-tier fallback strategy.
 * @param {Object} payload 
 * @param {Object} [options]
 * @param {string} [options.filename]
 * @param {boolean} [options.forceClipboard]
 * @returns {Promise<{ success: boolean, method: string, filename?: string, error?: any }>}
 */
export async function exportConfiguration(payload, options = {}) {
  const jsonStr = JSON.stringify(payload, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = options.filename || `vetting-notepad-backup-${dateStr}.json`;

  if (options.forceClipboard) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonStr);
        return { success: true, method: 'clipboard' };
      }
    } catch (err) {
      return { success: false, method: 'clipboard', error: err };
    }
  }

  // Tier 1: chrome.downloads API
  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    try {
      const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(jsonStr)}`;
      const result = await new Promise((resolve) => {
        chrome.downloads.download({
          url: dataUri,
          filename: filename,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime?.lastError || !downloadId) {
            resolve({ success: false, error: chrome.runtime?.lastError });
          } else {
            resolve({ success: true, method: 'chrome-downloads', downloadId, filename });
          }
        });
      });

      if (result.success) {
        return result;
      }
    } catch {
      // Fall through to Tier 2/3
    }
  }

  // Tier 2: Anchor download with Data URI
  if (typeof document !== 'undefined') {
    try {
      const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(jsonStr)}`;
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { success: true, method: 'data-uri-anchor', filename };
    } catch {
      // Fall through to Tier 3
    }
  }

  // Tier 3: Direct Clipboard Fallback
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(jsonStr);
      return { success: true, method: 'clipboard' };
    } catch (err) {
      return { success: false, method: 'none', error: err };
    }
  }

  return { success: false, method: 'none', error: new Error('No viable export method available') };
}

/**
 * Builds a comprehensive, safe debug diagnostics bundle with automated PII redaction.
 * @param {Object} context 
 * @returns {Object}
 */
export function buildDebugDiagnostics({
  version = null,
  types = [],
  settings = {},
  activeTypeId = null,
  storageDump = {},
  breakSchedule = null,
  currentValues = {},
  errors = []
} = {}) {
  const safeValues = {};
  for (const [key, val] of Object.entries(currentValues)) {
    safeValues[key] = sanitizeRedacted(val);
  }

  const storageKeys = Object.keys(storageDump);
  const storageBytes = JSON.stringify(storageDump).length;

  return {
    app: 'vetting-notepad',
    type: 'debug-diagnostics',
    version: version || getAppVersion(),
    timestamp: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    system: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown',
      panelDimensions: typeof window !== 'undefined' ? {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio
      } : {}
    },
    extension: {
      activeTypeId,
      typesCount: types.length,
      typesSummary: types.map(t => ({
        id: t.id,
        name: t.name,
        requiredCount: t.required?.length || 0,
        optionalCount: t.optional?.length || 0
      })),
      settings: {
        theme: settings.theme,
        autoClear: settings.autoClear
      },
      breakNotifier: {
        configured: Boolean(breakSchedule && Object.keys(breakSchedule).length > 0),
        breakCount: Array.isArray(breakSchedule?.breaks) ? breakSchedule.breaks.length : 0
      }
    },
    storage: {
      keyCount: storageKeys.length,
      keys: storageKeys,
      approximateSizeBytes: storageBytes
    },
    runtime: {
      redactedCurrentFieldValues: safeValues,
      recentErrors: errors.slice(-10)
    }
  };
}

/**
 * Exports debug diagnostics payload using the multi-tier export engine.
 * @param {Object} diagnosticsPayload 
 * @param {Object} [options] 
 * @returns {Promise<{ success: boolean, method: string, filename?: string, error?: any }>}
 */
export async function exportDebugDiagnostics(diagnosticsPayload, options = {}) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = options.filename || `vetting-notepad-debug-${dateStr}.json`;
  return exportConfiguration(diagnosticsPayload, { ...options, filename });
}
