import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildExportPayload,
  validateImportPayload,
  exportConfiguration
} from '../../extension/lib/exporter.js';

describe('Configuration Exporter & Importer', () => {
  const samplePayload = {
    types: [{ id: 'sim_swap', name: 'SIM Swap', required: [], optional: [] }],
    settings: { theme: 'dark', autoClear: 10 },
    savedComments: ['Verified'],
    activeTypeId: 'sim_swap'
  };

  it('builds a standard export payload with metadata', () => {
    const exported = buildExportPayload(samplePayload);
    expect(exported.app).toBe('vetting-notepad');
    expect(exported.version).toBe(1);
    expect(exported.exportedAt).toBeDefined();
    expect(exported.types.length).toBe(1);
    expect(exported.types[0].id).toBe('sim_swap');
  });

  describe('Import Validation', () => {
    it('accepts valid export JSON data', () => {
      const exported = buildExportPayload(samplePayload);
      const res = validateImportPayload(exported);
      expect(res.valid).toBe(true);
      expect(res.payload.types.length).toBe(1);
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
});
