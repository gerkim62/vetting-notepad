/**
 * Vetting Notepad - Exporter & Importer Library
 * Supports robust multi-tier export for MV3 Chrome Extension side panels:
 * Tier 1: chrome.downloads API (with downloads permission)
 * Tier 2: programmatic Data URI <a> element download
 * Tier 3: Direct JSON copy to clipboard as seamless fallback
 */

import { sanitizeRedacted, getAppVersion } from './utils.js';
import { logger } from './logger.js';
import { VettingType, AppSettings, ExportPayload } from '../types/index.js';

export interface BuildExportOptions {
  types?: VettingType[];
  settings?: Partial<AppSettings>;
  savedComments?: string[];
  activeTypeId?: string | null;
  appVersion?: string | null;
}

export interface ExportResult {
  success: boolean;
  method: string;
  filename?: string;
  downloadId?: number;
  error?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  payload?: ExportPayload;
  error?: string;
}

export interface DiagnosticsContext {
  version?: string | null;
  types?: VettingType[];
  settings?: Partial<AppSettings>;
  activeTypeId?: string | null;
  storageDump?: Record<string, unknown>;
  breakSchedule?: Record<string, unknown> | null;
  currentValues?: Record<string, unknown>;
  errors?: unknown[];
  logs?: unknown[];
}

/**
 * Builds a standardized export payload with metadata.
 */
export function buildExportPayload({
  types = [],
  settings = {},
  savedComments = [],
  activeTypeId = null,
  appVersion = null
}: BuildExportOptions = {}): ExportPayload {
  const completeSettings: AppSettings = {
    theme: settings.theme ?? 'auto',
    autoClear: settings.autoClear ?? 0
  };

  return {
    app: 'vetting-notepad',
    version: 1,
    appVersion: appVersion ?? getAppVersion(),
    exportedAt: new Date().toISOString(),
    types,
    settings: completeSettings,
    savedComments,
    activeTypeId
  };
}

/**
 * Validates whether an incoming payload is a valid Vetting Notepad export file.
 */
export function validateImportPayload(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Invalid JSON: Expected an object.' };
  }

  const record: Record<string, unknown> = { ...data };

  if (record.app !== 'vetting-notepad') {
    return { valid: false, error: 'Invalid schema: Not a Vetting Notepad backup file.' };
  }

  if (!Array.isArray(record.types) || record.types.length === 0) {
    return { valid: false, error: 'Invalid schema: Missing or empty types configuration.' };
  }

  const rawSettings = typeof record.settings === 'object' && record.settings !== null ? record.settings : {};
  const settingsRecord: Record<string, unknown> = { ...rawSettings };

  const parsedPayload: ExportPayload = {
    app: 'vetting-notepad',
    version: typeof record.version === 'number' ? record.version : 1,
    appVersion: typeof record.appVersion === 'string' ? record.appVersion : getAppVersion(),
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : new Date().toISOString(),
    types: Array.isArray(record.types) ? record.types.filter((t): t is VettingType => typeof t === 'object' && t !== null && 'id' in t && 'name' in t) : [],
    settings: {
      theme: typeof settingsRecord.theme === 'string' ? settingsRecord.theme : 'auto',
      autoClear: typeof settingsRecord.autoClear === 'number' ? settingsRecord.autoClear : 0
    },
    savedComments: Array.isArray(record.savedComments) ? record.savedComments.filter((c): c is string => typeof c === 'string') : [],
    activeTypeId: typeof record.activeTypeId === 'string' ? record.activeTypeId : null
  };

  return { valid: true, payload: parsedPayload };
}

/**
 * Exports configuration payload using multi-tier fallback strategy.
 */
export async function exportConfiguration(
  payload: unknown,
  options: { filename?: string; forceClipboard?: boolean } = {}
): Promise<ExportResult> {
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
      logger.captureError('exporter', err, { action: 'forceClipboardExport' });
      return { success: false, method: 'clipboard', error: err };
    }
  }

  // Tier 1: chrome.downloads API
  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    try {
      const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(jsonStr)}`;
      const result = await new Promise<ExportResult>((resolve) => {
        chrome.downloads.download({
          url: dataUri,
          filename: filename,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime?.lastError || !downloadId) {
            resolve({ success: false, method: 'chrome-downloads', error: chrome.runtime?.lastError });
          } else {
            resolve({ success: true, method: 'chrome-downloads', downloadId, filename });
          }
        });
      });

      if (result.success) {
        return result;
      }
    } catch (err) {
      // Fall through to Tier 2/3
      logger.warn('exporter', 'Tier 1 chrome.downloads failed, falling back to anchor download', { err });
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
    } catch (err) {
      // Fall through to Tier 3
      logger.warn('exporter', 'Tier 2 anchor download failed, falling back to clipboard', { err });
    }
  }

  // Tier 3: Direct Clipboard Fallback
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(jsonStr);
      return { success: true, method: 'clipboard' };
    } catch (err) {
      logger.captureError('exporter', err, { action: 'tier3ClipboardFallback' });
      return { success: false, method: 'none', error: err };
    }
  }

  return { success: false, method: 'none', error: new Error('No viable export method available') };
}

/**
 * Builds a comprehensive, safe debug diagnostics bundle with automated PII redaction.
 */
export function buildDebugDiagnostics({
  version = null,
  types = [],
  settings = {},
  activeTypeId = null,
  storageDump = {},
  breakSchedule = null,
  currentValues = {},
  errors = logger.getErrors(),
  logs = logger.getLogs()
}: DiagnosticsContext = {}): Record<string, unknown> {
  const safeValues: Record<string, string> = {};
  for (const [key, val] of Object.entries(currentValues)) {
    safeValues[key] = sanitizeRedacted(val);
  }

  const storageKeys = Object.keys(storageDump);
  const storageBytes = JSON.stringify(storageDump).length;

  let platformStr = 'Unknown';
  if (typeof navigator !== 'undefined' && 'platform' in navigator && typeof navigator.platform === 'string') {
    platformStr = navigator.platform;
  }

  return {
    app: 'vetting-notepad',
    type: 'debug-diagnostics',
    version: version || getAppVersion(),
    timestamp: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    system: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      platform: platformStr,
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
        configured: Boolean(breakSchedule && Object.keys(breakSchedule).length > 0)
      }
    },
    storage: {
      keyCount: storageKeys.length,
      keys: storageKeys,
      approximateSizeBytes: storageBytes
    },
    runtime: {
      redactedCurrentFieldValues: safeValues,
      recentErrors: errors.slice(-50),
      recentLogs: logs.slice(-100)
    }
  };
}

/**
 * Exports debug diagnostics payload using the multi-tier export engine.
 */
export async function exportDebugDiagnostics(
  diagnosticsPayload: unknown,
  options: { filename?: string; forceClipboard?: boolean } = {}
): Promise<ExportResult> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = options.filename || `vetting-notepad-debug-${dateStr}.json`;
  return exportConfiguration(diagnosticsPayload, { ...options, filename });
}
