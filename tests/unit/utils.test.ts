import { describe, it, expect, vi } from 'vitest';
import { escapeHtml, escapeRegExp, uid, debounce, sanitizeRedacted, getAppVersion } from '../../src/lib/utils.js';
import manifest from '../../src/manifest.json';

describe('Shared Utilities Module (utils.js)', () => {
  describe('escapeHtml', () => {
    it('escapes special HTML characters', () => {
      const input = '<div class="alert" data-val=\'test\'>Fish & Chips</div>';
      const output = escapeHtml(input);
      expect(output).toBe('&lt;div class=&quot;alert&quot; data-val=&#39;test&#39;&gt;Fish &amp; Chips&lt;/div&gt;');
    });

    it('returns empty string for null or undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('converts numbers to string and preserves clean characters', () => {
      expect(escapeHtml(12345)).toBe('12345');
      expect(escapeHtml(0)).toBe('0');
    });
  });

  describe('escapeRegExp', () => {
    it('escapes special regex metacharacters', () => {
      const str = 'Calling Number [Active IN] (2x)? *+$^';
      const escaped = escapeRegExp(str);
      expect(escaped).toBe('Calling Number \\[Active IN\\] \\(2x\\)\\? \\*\\+\\$\\^');
      const re = new RegExp(escaped);
      expect(re.test(str)).toBe(true);
    });

    it('returns empty string for null, undefined, or empty string', () => {
      expect(escapeRegExp(null)).toBe('');
      expect(escapeRegExp(undefined)).toBe('');
      expect(escapeRegExp('')).toBe('');
    });
  });

  describe('uid', () => {
    it('generates a string with requested length', () => {
      const id1 = uid(6);
      expect(id1.length).toBe(6);
      const id2 = uid(10);
      expect(id2.length).toBe(10);
    });

    it('generates distinct IDs on successive invocations', () => {
      const a = uid(8);
      const b = uid(8);
      expect(a).not.toBe(b);
    });
  });

  describe('debounce', () => {
    it('debounces rapid calls into a single invocation', async () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 150);

      debounced('call 1');
      debounced('call 2');
      debounced('call 3');

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(149);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call 3');

      vi.useRealTimers();
    });
  });

  describe('sanitizeRedacted', () => {
    it('masks sensitive customer data while showing length indicator', () => {
      expect(sanitizeRedacted('0722123456')).toBe('[REDACTED len=10]');
      expect(sanitizeRedacted('28394821')).toBe('[REDACTED len=8]');
      expect(sanitizeRedacted('John Doe')).toBe('[REDACTED len=8]');
    });

    it('returns empty string for blank, null, or undefined values', () => {
      expect(sanitizeRedacted('')).toBe('');
      expect(sanitizeRedacted('   ')).toBe('');
      expect(sanitizeRedacted(null)).toBe('');
      expect(sanitizeRedacted(undefined)).toBe('');
    });
  });

  describe('getAppVersion', () => {
    it('retrieves the version dynamically matching manifest.json', () => {
      const ver = getAppVersion();
      expect(ver).toBe(manifest.version);
      expect(ver).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('reads from chrome.runtime.getManifest when available', () => {
      const original = (globalThis as any).chrome?.runtime?.getManifest;
      try {
        (globalThis as any).chrome.runtime.getManifest = vi.fn(() => ({ version: '9.9.9' }));
        expect(getAppVersion()).toBe('9.9.9');
      } finally {
        (globalThis as any).chrome.runtime.getManifest = original;
      }
    });
  });
});
