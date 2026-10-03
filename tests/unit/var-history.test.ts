import { describe, it, expect } from 'vitest';
import {
  isVarRemembered,
  formatAccompanyingSubtext,
  getVarSuggestions,
  saveVarRecord,
  deleteVarRecord,
  migrateLegacyVars,
  isVarHighChurn,
  purgeVarFromHistory,
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

  describe('Frequency-Based Auto-Mute Fallback Heuristic', () => {
    it('auto-mutes a variable if it changes on 5 consecutive usages', () => {
      let history: VarRecord[] = [];
      let prefs: VarPreferences = { remember: {}, usageValues: {} };

      for (let i = 1; i <= 4; i++) {
        const s = saveVarRecord(history, { 'SESSION_ID': `ABC${i}` }, prefs);
        history = s.updatedHistory;
        prefs = s.updatedPrefs;
        expect(s.autoMutedVars).toEqual([]);
      }

      // 5th use with another unique value
      const s5 = saveVarRecord(history, { 'SESSION_ID': 'ABC5' }, prefs);
      expect(s5.autoMutedVars).toContain('SESSION_ID');
      expect(s5.updatedPrefs.remember['SESSION_ID']).toBe(false);
    });

    it('does not auto-mute if warning was ignored', () => {
      let history: VarRecord[] = [];
      let prefs: VarPreferences = {
        remember: {},
        usageValues: {},
        ignoredWarnings: { 'SESSION_ID': true }
      };

      for (let i = 1; i <= 5; i++) {
        const s = saveVarRecord(history, { 'SESSION_ID': `ABC${i}` }, prefs);
        history = s.updatedHistory;
        prefs = s.updatedPrefs;
      }

      expect(prefs.remember['SESSION_ID']).toBeUndefined();
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

  describe('Data-Driven High Churn Detection (isVarHighChurn)', () => {
    it('detects high churn when 4 distinct values exist across 4 uses (100% churn)', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'TXN CODE': '5', ORG: 'kcb' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { 'TXN CODE': '3', ORG: 'kcb' }, lastUsed: 2, useCount: 1 },
        { id: '3', values: { 'TXN CODE': '2', ORG: 'kcb' }, lastUsed: 3, useCount: 1 },
        { id: '4', values: { 'TXN CODE': '1', ORG: 'kcb' }, lastUsed: 4, useCount: 1 }
      ];

      expect(isVarHighChurn(history, 'TXN CODE')).toBe(true);
      // ORG has only 1 distinct value across 4 uses, so it is NOT high churn
      expect(isVarHighChurn(history, 'ORG')).toBe(false);
    });

    it('tolerates one accidental duplicate copy (e.g. 4 unique out of 5 uses = 80%)', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'REF': 'A1' }, lastUsed: 1, useCount: 2 }, // used twice
        { id: '2', values: { 'REF': 'A2' }, lastUsed: 2, useCount: 1 },
        { id: '3', values: { 'REF': 'A3' }, lastUsed: 3, useCount: 1 },
        { id: '4', values: { 'REF': 'A4' }, lastUsed: 4, useCount: 1 }
      ];

      expect(isVarHighChurn(history, 'REF')).toBe(true);
    });

    it('does not flag fields with an anchor/default value that dominates usage', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'CURRENCY CODE': 'KES' }, lastUsed: 1, useCount: 8 },
        { id: '2', values: { 'CURRENCY CODE': 'USD' }, lastUsed: 2, useCount: 2 },
        { id: '3', values: { 'CURRENCY CODE': 'EUR' }, lastUsed: 3, useCount: 1 }
      ];

      // KES was used 8 times (domination > 40% and count >= 3)
      expect(isVarHighChurn(history, 'CURRENCY CODE')).toBe(false);
    });

    it('evaluates 3 entries with recent consecutive usage check', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'TOKEN': 'T1' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { 'TOKEN': 'T2' }, lastUsed: 2, useCount: 1 },
        { id: '3', values: { 'TOKEN': 'T3' }, lastUsed: 3, useCount: 1 }
      ];

      const prefsWithConsecutive: VarPreferences = {
        remember: {},
        usageValues: { 'TOKEN': ['T1', 'T2', 'T3'] }
      };

      const prefsWithoutConsecutive: VarPreferences = {
        remember: {},
        usageValues: { 'TOKEN': ['T1', 'T1', 'T2'] }
      };

      expect(isVarHighChurn(history, 'TOKEN', prefsWithConsecutive)).toBe(true);
      expect(isVarHighChurn(history, 'TOKEN', prefsWithoutConsecutive)).toBe(false);
    });

    it('returns false if variable warning is ignored in preferences', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'TXN CODE': '1' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { 'TXN CODE': '2' }, lastUsed: 2, useCount: 1 },
        { id: '3', values: { 'TXN CODE': '3' }, lastUsed: 3, useCount: 1 },
        { id: '4', values: { 'TXN CODE': '4' }, lastUsed: 4, useCount: 1 }
      ];

      const prefs: VarPreferences = {
        remember: {},
        usageValues: {},
        ignoredWarnings: { 'TXN CODE': true }
      };

      expect(isVarHighChurn(history, 'TXN CODE', prefs)).toBe(false);
    });

    it('returns false if variable is already unpinned', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'TXN CODE': '1' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { 'TXN CODE': '2' }, lastUsed: 2, useCount: 1 },
        { id: '3', values: { 'TXN CODE': '3' }, lastUsed: 3, useCount: 1 },
        { id: '4', values: { 'TXN CODE': '4' }, lastUsed: 4, useCount: 1 }
      ];

      const prefs: VarPreferences = {
        remember: { 'TXN CODE': false },
        usageValues: {}
      };

      expect(isVarHighChurn(history, 'TXN CODE', prefs)).toBe(false);
    });
  });

  describe('History Variable Purging (purgeVarFromHistory)', () => {
    it('removes target variable while keeping accompanying variables intact', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'TXN CODE': '101', ORG: 'kcb', PHONE: '100' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { 'TXN CODE': '102', ORG: 'kcb', PHONE: '100' }, lastUsed: 2, useCount: 1 }
      ];

      const cleaned = purgeVarFromHistory(history, 'TXN CODE');
      expect(cleaned.length).toBe(2);
      expect(cleaned[0].values['TXN CODE']).toBeUndefined();
      expect(cleaned[0].values.ORG).toBe('kcb');
      expect(cleaned[0].values.PHONE).toBe('100');
    });

    it('removes records completely if they only contained the purged variable', () => {
      const history: VarRecord[] = [
        { id: '1', values: { 'TXN CODE': '101' }, lastUsed: 1, useCount: 1 },
        { id: '2', values: { 'TXN CODE': '102', ORG: 'kcb' }, lastUsed: 2, useCount: 1 }
      ];

      const cleaned = purgeVarFromHistory(history, 'TXN CODE');
      expect(cleaned.length).toBe(1);
      expect(cleaned[0].id).toBe('2');
      expect(cleaned[0].values).toEqual({ ORG: 'kcb' });
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
