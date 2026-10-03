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
}

export interface VarSuggestionItem {
  recordId: string;
  primaryValue: string;
  accompanying: Record<string, string>;
  subtext: string;
}

/**
 * Checks whether a variable is marked to be remembered.
 * Explicit user preference takes priority. Unconfigured fields default to true
 * (no blind guessing by name). Frequently changing fields are handled dynamically.
 */
export function isVarRemembered(varName: string, prefs?: VarPreferences | null): boolean {
  if (!varName) return false;
  const key = varName.trim();
  if (prefs?.remember && typeof prefs.remember[key] === 'boolean') {
    return prefs.remember[key];
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
  prefs?: VarPreferences | null
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

    // Filter accompanying values to only those that are remembered
    const accompanying: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.values)) {
      if (k.trim() !== key && v && typeof v === 'string' && isVarRemembered(k, prefs)) {
        accompanying[k.trim()] = v.trim();
      }
    }

    const subtext = formatAccompanyingSubtext(accompanying);
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
 * Saves or updates variable records in history upon copying.
 * Evaluates usage frequency to detect transient variables that change on every use.
 */
export function saveVarRecord(
  history: VarRecord[],
  currentValues: Record<string, string>,
  prefs: VarPreferences = { remember: {}, usageValues: {} },
  maxEntries = 100
): { updatedHistory: VarRecord[]; updatedPrefs: VarPreferences; autoMutedVars: string[] } {
  const updatedPrefs: VarPreferences = {
    remember: { ...(prefs.remember || {}) },
    usageValues: { ...(prefs.usageValues || {}) }
  };
  const autoMutedVars: string[] = [];

  const rememberedValues: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(currentValues || {})) {
    const k = rawKey.trim();
    const v = typeof rawVal === 'string' ? rawVal.trim() : '';
    if (!v) continue;

    // Track usage values for frequency heuristic
    const prevValues = updatedPrefs.usageValues[k] ? [...updatedPrefs.usageValues[k]] : [];
    prevValues.push(v);
    if (prevValues.length > 5) prevValues.shift();
    updatedPrefs.usageValues[k] = prevValues;

    // Check if variable changed on every single use (at least 3 unique values)
    const isExplicit = updatedPrefs.remember[k] !== undefined;
    if (!isExplicit && prevValues.length >= 3) {
      const uniqueCount = new Set(prevValues).size;
      if (uniqueCount === prevValues.length) {
        // Automatically mute this field
        updatedPrefs.remember[k] = false;
        autoMutedVars.push(k);
      }
    }

    if (isVarRemembered(k, updatedPrefs)) {
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
    const keysA = Object.keys(rec.values).filter(k => isVarRemembered(k, updatedPrefs));
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
