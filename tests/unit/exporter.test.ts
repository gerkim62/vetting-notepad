import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildExportPayload,
  validateImportPayload,
  exportConfiguration,
  buildDebugDiagnostics,
  exportDebugDiagnostics
} from '../../src/lib/exporter.js';

describe('Configuration Exporter & Importer', () => {
  const samplePayload = {
    types: [{ id: 'sim_swap', name: 'SIM Swap', required: [], optional: [] }],
    settings: { theme: 'dark', autoClear: 10 },
    savedComments: ['Verified'],
    activeTypeId: 'sim_swap',
    quickSmsTemplates: [{ id: 'sms_1', title: 'Test SMS', text: 'Hello' }],
    quickInteractionTemplates: [{ id: 'int_1', title: 'Test Int', text: 'Notes' }]
  };

  it('builds a standard export payload with metadata (Schema v2)', () => {
    const exported = buildExportPayload(samplePayload);
    expect(exported.app).toBe('vetting-notepad');
    expect(exported.version).toBe(2);
    expect(exported.exportedAt).toBeDefined();
    expect(exported.types.length).toBe(1);
    expect(exported.types[0].id).toBe('sim_swap');
    expect(exported.quickSmsTemplates?.length).toBe(1);
    expect(exported.quickInteractionTemplates?.length).toBe(1);
  });

  describe('Import Validation', () => {
    it('accepts valid export JSON data with templates', () => {
      const exported = buildExportPayload(samplePayload);
      const res = validateImportPayload(exported);
      expect(res.valid).toBe(true);
      expect(res.payload?.types.length).toBe(1);
      expect(res.payload?.quickSmsTemplates?.length).toBe(1);
      expect(res.payload?.quickSmsTemplates?.[0].id).toBe('sms_1');
    });

    it('accepts legacy v1 export files without templates (backward-compatible)', () => {
      const legacyPayload = {
        app: 'vetting-notepad',
        version: 1,
        appVersion: '1.0.0',
        exportedAt: new Date().toISOString(),
        types: [{ id: 'sim_swap', name: 'SIM Swap', required: [], optional: [] }],
        settings: { theme: 'light', autoClear: 0 },
        savedComments: [],
        activeTypeId: 'sim_swap'
      };
      const res = validateImportPayload(legacyPayload);
      expect(res.valid).toBe(true);
      expect(res.payload?.types.length).toBe(1);
      expect(res.payload?.quickSmsTemplates).toBeUndefined();
    });

    it('rejects invalid or corrupted JSON data', () => {
      const res1 = validateImportPayload(null);
      expect(res1.valid).toBe(false);

      const res2 = validateImportPayload({ app: 'other-tool' });
      expect(res2.valid).toBe(false);

      const res3 = validateImportPayload({ types: [] });
      expect(res3.valid).toBe(false);
    });
  });

  describe('Multi-tier Export Engine', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('uses chrome.downloads when available', async () => {
      const downloadMock = vi.fn((opts, cb) => cb && cb(123));
      globalThis.chrome = {
        downloads: {
          download: downloadMock
        }
      };

      const res = await exportConfiguration(buildExportPayload(samplePayload));
      expect(res.success).toBe(true);
      expect(res.method).toBe('chrome-downloads');
      expect(downloadMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to clipboard if chrome.downloads is unavailable and a.click throws or fails', async () => {
      delete globalThis.chrome;
      const writeTextMock = vi.fn().mockResolvedValue(true);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock
        }
      });

      const res = await exportConfiguration(buildExportPayload(samplePayload), { forceClipboard: true });
      expect(res.success).toBe(true);
      expect(res.method).toBe('clipboard');
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Debug Diagnostics Exporter', () => {
    const diagnosticContext = {
      version: '3.0.0',
      types: [{ id: 'sim_swap', name: 'SIM Swap', required: [{ id: 'id_num' }], optional: [] }],
      settings: { theme: 'dark', autoClear: 0 },
      activeTypeId: 'sim_swap',
      storageDump: { 'vpad.types': [], 'vpad.settings': {} },
      breakSchedule: { breaks: [{ name: 'Tea', start: '10:00', end: '10:15' }] },
      currentValues: {
        _comment: 'Customer called regarding PIN reset',
        id_num: '12345678',
        phone_num: '0722000000'
      },
      errors: ['Sample error log']
    };

    it('builds a diagnostic bundle with automated PII redaction', () => {
      const diag = buildDebugDiagnostics(diagnosticContext);
      expect(diag.app).toBe('vetting-notepad');
      expect(diag.type).toBe('debug-diagnostics');
      expect(diag.version).toBe('3.0.0');
      expect(diag.timestamp).toBeDefined();

      // Ensure customer values are redacted
      expect(diag.runtime.redactedCurrentFieldValues.id_num).toBe('[REDACTED len=8]');
      expect(diag.runtime.redactedCurrentFieldValues.phone_num).toBe('[REDACTED len=10]');
      expect(diag.runtime.redactedCurrentFieldValues._comment).toBe('[REDACTED len=35]');

      // Raw sensitive data MUST NOT appear anywhere in the values
      const json = JSON.stringify(diag);
      expect(json).not.toContain('12345678');
      expect(json).not.toContain('0722000000');
    });

    it('exports diagnostics with proper debug filename prefix', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(true);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock
        }
      });

      const diag = buildDebugDiagnostics(diagnosticContext);
      const res = await exportDebugDiagnostics(diag, { forceClipboard: true });
      expect(res.success).toBe(true);
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
  });
});
