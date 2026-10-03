import { describe, it, expect } from 'vitest';
import {
  isVarRemembered,
  formatAccompanyingSubtext,
  getVarSuggestions,
  saveVarRecord,
  deleteVarRecord,
  migrateLegacyVars,
  VarRecord,
  VarPreferences
} from '../../src/lib/var-history.js';

describe('Variable History & Autocomplete Engine', () => {
  describe('Transient & Remembered Fields', () => {
    it('defaults all unconfigured fields to remembered (no blind keyword guessing)', () => {
      expect(isVarRemembered('TXN CODE')).toBe(true);
      expect(isVarRemembered('ORGANIZATION')).toBe(true);
      expect(isVarRemembered('Phone Number')).toBe(true);
      expect(isVarRemembered('Any Random Var')).toBe(true);
    });

    it('prioritizes explicit user preferences and muted states', () => {
      const prefs: VarPreferences = {
        remember: {
          'TXN CODE': false, // muted dynamically or toggled by user
          'ORGANIZATION': true
        },
        usageValues: {}
      };

      expect(isVarRemembered('TXN CODE', prefs)).toBe(false);
      expect(isVarRemembered('ORGANIZATION', prefs)).toBe(true);
      expect(isVarRemembered('Phone Number', prefs)).toBe(true); // unconfigured defaults to true
    });
  });

  describe('Accompanying Subtext Formatter', () => {
    it('formats single and multiple accompanying values', () => {
      expect(formatAccompanyingSubtext({ 'Phone Number': '0722000000' })).toBe('0722000000');
      expect(formatAccompanyingSubtext({ 'Phone Number': '0722000000', 'Till': '123456' })).toBe(
        '0722000000 • 123456'
      );
      expect(formatAccompanyingSubtext({})).toBe('');
    });
  });

  describe('Autocomplete Suggestions & Ranking', () => {
    const history: VarRecord[] = [
      {
        id: 'rec-1',
        values: {
          ORGANIZATION: 'Safaricom Care',
          'Phone Number': '100',
          'TXN CODE': 'TXN111'
        },
        lastUsed: 1000,
        useCount: 1
      },
      {
        id: 'rec-2',
        values: {
          ORGANIZATION: 'Safaricom Home',
          'Phone Number': '400',
          'TXN CODE': 'TXN222'
        },
        lastUsed: 2000,
        useCount: 2
      },
      {
        id: 'rec-3',
        values: {
          ORGANIZATION: 'Airtel Kenya',
          'Phone Number': '100'
        },
        lastUsed: 3000,
        useCount: 3
      }
    ];

    it('filters suggestions by case-insensitive query', () => {
      const results = getVarSuggestions(history, 'ORGANIZATION', 'saf');
      expect(results.length).toBe(2);
      expect(results.map(r => r.primaryValue)).toContain('Safaricom Care');
      expect(results.map(r => r.primaryValue)).toContain('Safaricom Home');
    });

    it('excludes transient fields from accompanying subtext', () => {
      const prefs: VarPreferences = {
        remember: { 'TXN CODE': false },
        usageValues: {}
      };
      const results = getVarSuggestions(history, 'ORGANIZATION', 'Care', prefs);
      expect(results.length).toBe(1);
      expect(results[0].primaryValue).toBe('Safaricom Care');
      // TXN CODE is muted, so accompanying only has Phone Number
      expect(results[0].accompanying).toEqual({ 'Phone Number': '100' });
      expect(results[0].subtext).toBe('100');
    });

    it('ranks exact matches first, then prefix matches', () => {
      const extraHistory: VarRecord[] = [
        {
          id: 'rec-sub',
          values: { ORGANIZATION: 'The Equity Bank' },
          lastUsed: 100,
          useCount: 1
        },
        {
          id: 'rec-exact',
          values: { ORGANIZATION: 'Equity' },
          lastUsed: 200,
          useCount: 1
        },
        {
          id: 'rec-pref',
          values: { ORGANIZATION: 'Equity Bank' },
          lastUsed: 300,
          useCount: 1
        }
      ];

      const results = getVarSuggestions(extraHistory, 'ORGANIZATION', 'equity');
      expect(results[0].primaryValue).toBe('Equity'); // exact match
      expect(results[1].primaryValue).toBe('Equity Bank'); // prefix match
      expect(results[2].primaryValue).toBe('The Equity Bank'); // substring match
    });
  });

  describe('Record Persistence & LRU Eviction', () => {
    it('creates new records and enforces maxEntries LRU cap', () => {
      let history: VarRecord[] = [];
      const prefs: VarPreferences = { remember: {}, usageValues: {} };

      const res1 = saveVarRecord(history, { ORGANIZATION: 'Org A', 'Phone Number': '111' }, prefs, 2);
      history = res1.updatedHistory;
      expect(history.length).toBe(1);
      expect(history[0].values.ORGANIZATION).toBe('Org A');

      const res2 = saveVarRecord(history, { ORGANIZATION: 'Org B', 'Phone Number': '222' }, prefs, 2);
      history = res2.updatedHistory;
      expect(history.length).toBe(2);
      expect(history[0].values.ORGANIZATION).toBe('Org B');

      const res3 = saveVarRecord(history, { ORGANIZATION: 'Org C', 'Phone Number': '333' }, prefs, 2);
      history = res3.updatedHistory;
      expect(history.length).toBe(2);
      expect(history[0].values.ORGANIZATION).toBe('Org C');
      expect(history[1].values.ORGANIZATION).toBe('Org B');
      // Org A evicted due to LRU limit of 2
    });

    it('deduplicates identical records and updates lastUsed timestamp', () => {
      const prefs: VarPreferences = { remember: {}, usageValues: {} };
      const { updatedHistory: h1 } = saveVarRecord(
        [],
        { ORGANIZATION: 'Equity', 'Phone Number': '0763000000' },
        prefs
      );
      expect(h1.length).toBe(1);
      expect(h1[0].useCount).toBe(1);

      const { updatedHistory: h2 } = saveVarRecord(
        h1,
        { ORGANIZATION: 'Equity', 'Phone Number': '0763000000' },
        prefs
      );
      expect(h2.length).toBe(1);
      expect(h2[0].useCount).toBe(2);
    });
  });

  describe('Frequency-Based Auto-Mute Heuristic', () => {
    it('auto-mutes a variable if it changes on 3 consecutive usages', () => {
      let history: VarRecord[] = [];
      let prefs: VarPreferences = { remember: {}, usageValues: {} };

      // 1st use
      const s1 = saveVarRecord(history, { 'SESSION_ID': 'ABC1' }, prefs);
      history = s1.updatedHistory;
      prefs = s1.updatedPrefs;
      expect(s1.autoMutedVars).toEqual([]);

      // 2nd use
      const s2 = saveVarRecord(history, { 'SESSION_ID': 'ABC2' }, prefs);
      history = s2.updatedHistory;
      prefs = s2.updatedPrefs;
      expect(s2.autoMutedVars).toEqual([]);

      // 3rd use with another unique value
      const s3 = saveVarRecord(history, { 'SESSION_ID': 'ABC3' }, prefs);
      history = s3.updatedHistory;
      prefs = s3.updatedPrefs;
      expect(s3.autoMutedVars).toContain('SESSION_ID');
      expect(prefs.remember['SESSION_ID']).toBe(false);
    });

    it('does not auto-mute if values are repeated', () => {
      let history: VarRecord[] = [];
      let prefs: VarPreferences = { remember: {}, usageValues: {} };

      const s1 = saveVarRecord(history, { 'AGENT': 'Alice' }, prefs);
      history = s1.updatedHistory;
      prefs = s1.updatedPrefs;

      const s2 = saveVarRecord(history, { 'AGENT': 'Bob' }, prefs);
      history = s2.updatedHistory;
      prefs = s2.updatedPrefs;

      const s3 = saveVarRecord(history, { 'AGENT': 'Alice' }, prefs);
      history = s3.updatedHistory;
      prefs = s3.updatedPrefs;

      expect(s3.autoMutedVars).toEqual([]);
      expect(prefs.remember['AGENT']).toBeUndefined();
    });
  });

  describe('Record Deletion & Legacy Migration', () => {
    it('deletes records by ID', () => {
      const records: VarRecord[] = [
        { id: '1', values: { A: '1' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { A: '2' }, lastUsed: 2, useCount: 1 }
      ];
      const remaining = deleteVarRecord(records, '1');
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe('2');
    });

    it('migrates legacy flat key-value pairs', () => {
      const legacy = {
        ORGANIZATION: 'Safaricom',
        'Phone Number': '0722000000'
      };
      const migrated = migrateLegacyVars(legacy);
      expect(migrated.length).toBe(1);
      expect(migrated[0].values).toEqual(legacy);
      expect(migrated[0].useCount).toBe(1);
    });

    it('handles empty legacy variables gracefully', () => {
      expect(migrateLegacyVars({})).toEqual([]);
    });
  });
});
