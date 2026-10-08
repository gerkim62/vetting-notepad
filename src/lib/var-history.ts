/**
 * Variable History & Autocomplete Engine
 * Manages shared variable directories, multi-field autofill suggestions,
 * LRU history retention, and non-intrusive transient field detection.
 */

import { uid } from './utils.js';

export interface VarRecord {
  id: string;
  values: Record<string, string>;
  lastUsed: number;
  useCount: number;
}

export interface VarPreferences {
  remember: Record<string, boolean>;
  usageValues: Record<string, string[]>;
  ignoredWarnings?: Record<string, boolean>;
}

export interface VarSuggestionItem {
  recordId: string;
  primaryValue: string;
  accompanying: Record<string, string>;
  subtext: string;
}

/**
 * Checks whether a variable is marked to be remembered.
 * Explicit user preference takes priority. If unpinnedVars is provided from config,
 * matching variables default to unpinned (false). Otherwise, fields default to true
 * with zero hardcoded keyword heuristics.
 */
export function isVarRemembered(
  varName: string,
  prefs?: VarPreferences | null,
  unpinnedVars?: string[]
): boolean {
  if (!varName) return false;
  const key = varName.trim();
  if (prefs?.remember && typeof prefs.remember[key] === 'boolean') {
    return prefs.remember[key];
  }
  if (unpinnedVars && Array.isArray(unpinnedVars)) {
    const keyUpper = key.toUpperCase();
    if (unpinnedVars.some(u => typeof u === 'string' && u.trim().toUpperCase() === keyUpper)) {
      return false;
    }
  }
  return true;
}

/**
 * Formats accompanying variable values into a concise, readable subtext string.
 */
export function formatAccompanyingSubtext(accompanying: Record<string, string>): string {
  const entries = Object.entries(accompanying).filter(([, val]) => val && val.trim().length > 0);
  if (entries.length === 0) return '';
  return entries.map(([, val]) => val.trim()).join(' • ');
}

/**
 * Retrieves autocomplete suggestions for a given variable field based on past history.
 */
export function getVarSuggestions(
  history: VarRecord[],
  varName: string,
  query: string,
  prefs?: VarPreferences | null,
  unpinnedVars?: string[]
): VarSuggestionItem[] {
  if (!varName || !Array.isArray(history)) return [];
  const key = varName.trim();
  const q = (query || '').trim().toLowerCase();

  const candidates: VarSuggestionItem[] = [];
  const seenCombos = new Set<string>();

  for (const record of history) {
    if (!record || !record.values) continue;
    const primary = record.values[key];
    if (!primary || typeof primary !== 'string') continue;

    const trimmedPrimary = primary.trim();
    if (!trimmedPrimary) continue;

    const lowerPrimary = trimmedPrimary.toLowerCase();
    if (q && !lowerPrimary.includes(q)) continue;

    // Accompanying values from the record (all preserved for autofill)
    const accompanying: Record<string, string> = {};
    const subtextVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.values)) {
      if (k.trim() !== key && v && typeof v === 'string') {
        const trimmedVal = v.trim();
        accompanying[k.trim()] = trimmedVal;
        if (isVarRemembered(k, prefs, unpinnedVars)) {
          subtextVars[k.trim()] = trimmedVal;
        }
      }
    }

    const subtext = formatAccompanyingSubtext(subtextVars);
    const comboKey = `${trimmedPrimary}:::${subtext}`;
    if (seenCombos.has(comboKey)) continue;
    seenCombos.add(comboKey);

    candidates.push({
      recordId: record.id,
      primaryValue: trimmedPrimary,
      accompanying,
      subtext
    });
  }

  // Sort candidates: exact match first, prefix match second, then recent usage
  candidates.sort((a, b) => {
    if (!q) return 0;
    const aLower = a.primaryValue.toLowerCase();
    const bLower = b.primaryValue.toLowerCase();

    const aExact = aLower === q;
    const bExact = bLower === q;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aPrefix = aLower.startsWith(q);
    const bPrefix = bLower.startsWith(q);
    if (aPrefix && !bPrefix) return -1;
    if (!aPrefix && bPrefix) return 1;

    return 0;
  });

  return candidates;
}

/**
 * Evaluates whether a variable exhibits high churn (one-time values that change on almost every use)
 * using data-driven distribution analysis (zero keyword regex guessing).
 */
export function isVarHighChurn(
  history: VarRecord[],
  varName: string,
  prefs?: VarPreferences | null,
  unpinnedVars?: string[]
): boolean {
  if (!varName || !isVarRemembered(varName, prefs, unpinnedVars)) return false;
  const key = varName.trim();
  if (prefs?.ignoredWarnings && prefs.ignoredWarnings[key]) return false;
  if (!Array.isArray(history) || history.length === 0) return false;

  const recordsWithVar = history.filter(
    r => r?.values?.[key] && typeof r.values[key] === 'string' && r.values[key].trim().length > 0
  );
  if (recordsWithVar.length < 3) return false;

  const valueCounts = new Map<string, number>();
  let totalUsage = 0;

  for (const r of recordsWithVar) {
    const val = r.values[key].trim().toLowerCase();
    const count = Math.max(1, r.useCount || 1);
    valueCounts.set(val, (valueCounts.get(val) || 0) + count);
    totalUsage += count;
  }

  const uniqueCount = valueCounts.size;
  if (uniqueCount < 3) return false;

  const churnRatio = uniqueCount / totalUsage;

  let maxCount = 0;
  for (const count of valueCounts.values()) {
    if (count > maxCount) maxCount = count;
  }
  const topDominance = maxCount / totalUsage;

  // Reusable fields naturally have an anchor/default value that was reused 3+ times or dominates >= 40%
  const hasSettledAnchor = maxCount >= 3;
  if (hasSettledAnchor || topDominance > 0.40) return false;

  const rawRecent: unknown = prefs?.usageValues?.[key];
  let recent: string[] = [];
  if (Array.isArray(rawRecent)) {
    recent = rawRecent.filter((item): item is string => typeof item === 'string');
  } else if (typeof rawRecent === 'string') {
    const trimmed = rawRecent.trim();
    if (trimmed) recent = [trimmed];
  }
  const recentUnique = new Set(recent.map(s => s.trim().toLowerCase())).size;
  const isRecentConsecutiveChurn = recent.length >= 3 && recentUnique === recent.length;

  if (uniqueCount === 3) {
    return churnRatio >= 0.85 && isRecentConsecutiveChurn;
  }

  return churnRatio >= 0.80;
}

/**
 * Resolves initial/saved values for template variables based on history and preferences.
 * - Explicit prefill values take highest priority.
 * - Remembered/pinned variables pre-fill from the most recent matching record in history.
 * - Unpinned/transient variables (e.g. TXN CODE, PUK) default to empty string unless prefilled.
 */
export function resolveInitialTemplateVars(
  vars: string[],
  history: VarRecord[],
  prefs?: VarPreferences | null,
  unpinnedVars?: string[],
  prefills?: Record<string, string> | null
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(vars)) return result;

  // Find the most recent record that has values for any remembered variable in this template
  const matchingRecord = Array.isArray(history)
    ? history.find(r =>
        r?.values &&
        vars.some(v => isVarRemembered(v, prefs, unpinnedVars) && typeof r.values[v.trim()] === 'string' && r.values[v.trim()].trim().length > 0)
      )
    : undefined;

  for (const rawVar of vars) {
    if (!rawVar) continue;
    const key = rawVar.trim();

    // 1. Explicit prefill (e.g. from current transaction / vetting inputs)
    if (prefills && typeof prefills[key] === 'string' && prefills[key].trim().length > 0) {
      result[key] = prefills[key].trim();
      continue;
    }

    // 2. Remembered/pinned fields prefill from history
    if (isVarRemembered(key, prefs, unpinnedVars)) {
      if (matchingRecord?.values?.[key] && typeof matchingRecord.values[key] === 'string' && matchingRecord.values[key].trim().length > 0) {
        result[key] = matchingRecord.values[key].trim();
      } else {
        const fallback = Array.isArray(history)
          ? history.find(r => r?.values?.[key] && typeof r.values[key] === 'string' && r.values[key].trim().length > 0)
          : undefined;
        result[key] = fallback?.values?.[key]?.trim() || '';
      }
    } else {
      // 3. Unpinned / transient fields start blank
      result[key] = '';
    }
  }

  return result;
}

/**
 * Purges a specific variable from all records in history.
 * If removing this variable leaves a record with zero variables, the record is removed entirely.
 */
export function purgeVarFromHistory(history: VarRecord[], varName: string): VarRecord[] {
  if (!Array.isArray(history) || !varName) return history || [];
  const key = varName.trim();

  const updated: VarRecord[] = [];
  for (const record of history) {
    if (!record || !record.values) continue;
    if (record.values[key] !== undefined) {
      const remainingValues = { ...record.values };
      delete remainingValues[key];
      if (Object.keys(remainingValues).length > 0) {
        updated.push({
          ...record,
          values: remainingValues
        });
      }
    } else {
      updated.push(record);
    }
  }

  return updated;
}

/**
 * Saves or updates variable records in history upon copying.
 * Evaluates usage frequency to detect transient variables that change on every use.
 */
export function saveVarRecord(
  history: VarRecord[],
  currentValues: Record<string, string>,
  prefs: VarPreferences = { remember: {}, usageValues: {} },
  maxEntries = 100,
  unpinnedVars?: string[]
): { updatedHistory: VarRecord[]; updatedPrefs: VarPreferences; autoMutedVars: string[] } {
  const updatedPrefs: VarPreferences = {
    remember: { ...(prefs.remember || {}) },
    usageValues: { ...(prefs.usageValues || {}) },
    ignoredWarnings: { ...(prefs.ignoredWarnings || {}) }
  };
  const autoMutedVars: string[] = [];

  const rememberedValues: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(currentValues || {})) {
    const k = rawKey.trim();
    const v = typeof rawVal === 'string' ? rawVal.trim() : '';
    if (!v) continue;

    // Track usage values for frequency heuristic
    const rawPrev: unknown = updatedPrefs.usageValues[k];
    let prevValues: string[] = [];
    if (Array.isArray(rawPrev)) {
      prevValues = rawPrev.filter((item): item is string => typeof item === 'string');
    } else if (typeof rawPrev === 'string') {
      const trimmed = rawPrev.trim();
      if (trimmed) prevValues = [trimmed];
    }
    prevValues.push(v);
    if (prevValues.length > 5) prevValues.shift();
    updatedPrefs.usageValues[k] = prevValues;

    // Safety fallback: Check if variable changed on 5 consecutive uses without explicit override or dismissed warning
    const isExplicit = updatedPrefs.remember[k] !== undefined;
    const isIgnored = Boolean(updatedPrefs.ignoredWarnings && updatedPrefs.ignoredWarnings[k]);
    if (!isExplicit && !isIgnored && prevValues.length >= 5) {
      const uniqueCount = new Set(prevValues).size;
      if (uniqueCount === prevValues.length) {
        // Automatically mute this field
        updatedPrefs.remember[k] = false;
        autoMutedVars.push(k);
      }
    }

    if (isVarRemembered(k, updatedPrefs, unpinnedVars)) {
      rememberedValues[k] = v;
    }
  }

  // If there are no remembered values, return unchanged history
  if (Object.keys(rememberedValues).length === 0) {
    return {
      updatedHistory: history || [],
      updatedPrefs,
      autoMutedVars
    };
  }

  let updatedHistory = Array.isArray(history) ? [...history] : [];

  // Look for existing record with the exact same remembered key-values
  const existingIdx = updatedHistory.findIndex(rec => {
    if (!rec || !rec.values) return false;
    const keysA = Object.keys(rec.values).filter(k => isVarRemembered(k, updatedPrefs, unpinnedVars));
    const keysB = Object.keys(rememberedValues);
    if (keysA.length !== keysB.length) return false;
    return keysB.every(k => rec.values[k] === rememberedValues[k]);
  });

  const now = Date.now();

  if (existingIdx >= 0) {
    const existing = updatedHistory[existingIdx];
    const updatedRec: VarRecord = {
      ...existing,
      values: { ...existing.values, ...rememberedValues },
      lastUsed: now,
      useCount: (existing.useCount || 1) + 1
    };
    updatedHistory.splice(existingIdx, 1);
    updatedHistory.unshift(updatedRec);
  } else {
    const newRec: VarRecord = {
      id: uid(8),
      values: rememberedValues,
      lastUsed: now,
      useCount: 1
    };
    updatedHistory.unshift(newRec);
  }

  // Enforce LRU cap
  if (updatedHistory.length > maxEntries) {
    updatedHistory = updatedHistory.slice(0, maxEntries);
  }

  return {
    updatedHistory,
    updatedPrefs,
    autoMutedVars
  };
}

/**
 * Deletes a specific record from history by ID.
 */
export function deleteVarRecord(history: VarRecord[], recordId: string): VarRecord[] {
  if (!Array.isArray(history) || !recordId) return history || [];
  return history.filter(r => r && r.id !== recordId);
}

/**
 * Migrates legacy flat key-value pairs (`vpad.remembered_vars`) into modern VarRecord list.
 */
export function migrateLegacyVars(legacyVars: Record<string, unknown>): VarRecord[] {
  if (!legacyVars || typeof legacyVars !== 'object') return [];
  const cleanValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(legacyVars)) {
    if (typeof v === 'string' && v.trim()) {
      cleanValues[k.trim()] = v.trim();
    }
  }

  if (Object.keys(cleanValues).length === 0) return [];

  return [
    {
      id: uid(8),
      values: cleanValues,
      lastUsed: Date.now(),
      useCount: 1
    }
  ];
}
