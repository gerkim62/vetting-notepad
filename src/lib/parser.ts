/**
 * Vetting Text Parser & Reverse Re-population Engine
 * Parses standard clipboard vetting blocks back into type selection, values, statuses, and comments.
 */

import { VettingType, VettingField } from '../types/index.js';

export interface ParsedVettingResult {
  typeId: string | null;
  comment: string;
  values: Record<string, string>;
  status: Record<string, string | null>;
}

function cleanLabel(rawLabel?: string | null): string {
  if (!rawLabel) return '';
  const parts = String(rawLabel).split('//');
  const part0 = parts[0];
  return (part0 ?? '').trim().toLowerCase();
}

/**
 * Checks whether the given text looks like a vetting clipboard block.
 */
export function isVettingClipboardText(rawText: string | null | undefined, types: VettingType[]): boolean {
  if (!rawText || typeof rawText !== 'string') return false;
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const firstLine = (lines[0] ?? '').toLowerCase();

  // Check header match
  for (const t of types) {
    const copyTitle = (t.copyTitle || `${t.name} – Vetting`).toLowerCase();
    const typeName = t.name.toLowerCase();
    if (firstLine === copyTitle || firstLine.includes(typeName) || firstLine.includes('– vetting') || firstLine.includes('- vetting')) {
      return true;
    }
  }

  // Count key-value line matches against known field labels
  let matchedFields = 0;
  for (const line of lines) {
    if (line.includes(':')) {
      const parts = line.split(':');
      const key = cleanLabel(parts[0]);
      for (const t of types) {
        const allItems = [...(t.required || []), ...(t.optional || [])];
        if (allItems.some(it => cleanLabel(it.label) === key || cleanLabel(it.label).includes(key) || key.includes(cleanLabel(it.label)))) {
          matchedFields++;
          break;
        }
      }
    }
  }

  return matchedFields >= 2;
}

/**
 * Parses raw vetting text into typeId, comment, values, and status.
 */
export function parseVettingText(rawText: string | null | undefined, types: VettingType[], fallbackTypeId: string | null = null): ParsedVettingResult {
  const defaultTypeId = fallbackTypeId ?? (types[0] ? types[0].id : null);
  const result: ParsedVettingResult = {
    typeId: defaultTypeId,
    comment: '',
    values: {},
    status: {}
  };

  if (!rawText || typeof rawText !== 'string' || !Array.isArray(types) || types.length === 0) {
    return result;
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return result;

  // 1. Detect Type
  let matchedType: VettingType | null = null;
  const firstLine = (lines[0] ?? '').toLowerCase();

  // Legacy header aliases for existing saved interactions & tests
  if (firstLine.includes('m-pesa & airtime reversal')) {
    matchedType = types.find(t => t.id === 'reversal') || null;
  } else if (firstLine.includes('agent calling (personal number)')) {
    matchedType = types.find(t => t.id === 'agent_personal') || null;
  } else if (firstLine.includes('till notification msisdn replacement') || firstLine.includes('till notification sim swap')) {
    matchedType = types.find(t => t.id === 'till_notif_replacement') || null;
  }

  if (!matchedType) {
    // Sort by name length descending so longer/more specific names match first (e.g. 'Airtime Reversal' vs 'Reversal')
    const sortedTypes = [...types].sort((a, b) => b.name.length - a.name.length);
    for (const t of sortedTypes) {
      const copyTitle = (t.copyTitle || `${t.name} – Vetting`).toLowerCase();
      const typeName = t.name.toLowerCase();
      if (firstLine === copyTitle || firstLine.startsWith(`${typeName}:`) || firstLine.startsWith(`${typeName} –`) || firstLine.startsWith(`${typeName} -`) || firstLine.includes(typeName)) {
        matchedType = t;
        break;
      }
    }
  }

  // If first line wasn't an exact title match, search all lines for title match
  if (!matchedType) {
    for (const line of lines) {
      const l = line.toLowerCase();
      for (const t of types) {
        const copyTitle = (t.copyTitle || `${t.name} – Vetting`).toLowerCase();
        if (l === copyTitle) {
          matchedType = t;
          break;
        }
      }
      if (matchedType) break;
    }
  }

  // If still not matched, score types by matching field labels
  if (!matchedType) {
    let bestScore = 0;
    for (const t of types) {
      const allItems = [...(t.required || []), ...(t.optional || [])];
      let score = 0;
      for (const line of lines) {
        if (line.includes(':')) {
          const parts = line.split(':');
          const key = cleanLabel(parts[0]);
          if (allItems.some(it => cleanLabel(it.label) === key || cleanLabel(it.label).includes(key))) {
            score++;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        matchedType = t;
      }
    }
  }

  if (matchedType) {
    result.typeId = matchedType.id;
  } else if (fallbackTypeId) {
    matchedType = types.find(t => t.id === fallbackTypeId) ?? (types[0] ?? null);
  } else {
    matchedType = types[0] ?? null;
  }

  if (!matchedType) return result;

  const allItems = [...(matchedType.required || []), ...(matchedType.optional || [])];

  // Helper to match a field by label string
  const findField = (keyStr: string): VettingField | null => {
    const cleanKey = cleanLabel(keyStr).replace(/[^a-z0-9]/g, ' ').trim();
    const keyTokens = cleanKey.split(/\s+/).filter(Boolean);

    // 1. Exact or prefix match
    const match = allItems.find(it => {
      const cl = cleanLabel(it.label).replace(/[^a-z0-9]/g, ' ').trim();
      return cl === cleanKey || cl.startsWith(cleanKey) || cleanKey.startsWith(cl);
    });
    if (match) return match;

    // 2. Token overlap score
    let bestField: VettingField | null = null;
    let maxOverlap = 0;
    for (const it of allItems) {
      const cl = cleanLabel(it.label).replace(/[^a-z0-9]/g, ' ').trim();
      const fieldTokens = cl.split(/\s+/).filter(Boolean);
      let overlap = 0;
      for (const tok of keyTokens) {
        if (fieldTokens.includes(tok)) overlap++;
      }
      if (overlap > maxOverlap && overlap >= 1) {
        maxOverlap = overlap;
        bestField = it;
      }
    }
    return bestField;
  };

  // 2. Parse lines
  let startIndex = 0;
  // If first line was header, check for embedded advice/comment
  if (lines.length > 0) {
    const l0 = lines[0] ?? '';
    const l0Lower = l0.toLowerCase();
    const copyTitle = (matchedType.copyTitle || `${matchedType.name} – Vetting`).toLowerCase();
    const typeName = matchedType.name.toLowerCase();
    if (l0Lower === copyTitle || l0Lower.includes(typeName)) {
      startIndex = 1;
      const colonIdx = l0.indexOf(':');
      if (colonIdx !== -1) {
        const potentialComment = l0.slice(colonIdx + 1).trim();
        // If not empty and not just the type name/vetting
        if (potentialComment && !potentialComment.toLowerCase().includes('– vetting')) {
          result.comment = potentialComment;
        }
      }
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineLower = line.toLowerCase();

    // Check for Siebel summary lines or referral / callback footer notes to skip
    if (
      lineLower.startsWith('vetting: passed') ||
      lineLower.startsWith('vetting: failed') ||
      lineLower.startsWith('advised:') ||
      line.startsWith('Referred to Retail') ||
      line.startsWith('Failed vetting. Advised') ||
      line.startsWith('Failed vetting again.')
    ) {
      continue;
    }

    if (!line.includes(':')) {
      // Unlabeled line -> Treat as comment if no comment set yet
      if (!result.comment) {
        result.comment = line;
      } else {
        result.comment += '\n' + line;
      }
      continue;
    }

    // Split potentially comma-separated fields on the line
    const kvSegments = line.split(/,\s*(?=[^:]+:)/);

    for (const segment of kvSegments) {
      const match = segment.match(/^\s*([^:]+?)\s*:\s*(.*?)(?:\s*\((Passed|Failed)\))?\s*$/i);
      if (match) {
        const rawKey = (match[1] ?? '').trim();
        let rawVal = (match[2] ?? '').trim();
        const rawStatus = match[3] ? match[3].toLowerCase() : null;

        const field = findField(rawKey);
        if (field) {
          if (rawVal.toLowerCase() === 'failed' && rawStatus === 'failed') {
            rawVal = '';
          }
          result.values[field.id] = rawVal;
          if (rawStatus === 'failed') {
            result.status[field.id] = 'failed';
          } else if (rawStatus === 'passed') {
            result.status[field.id] = null;
          }
        }
      }
    }
  }

  return result;
}

/* ==========================================================================
   Smart M-PESA Transaction Statement Parser (View360-style)
   ========================================================================== */

export interface MpesaTxnItem {
  tid: string;
  dateTime: string;
  type: string;
  otherParty: string;
  recipientNumber: string;
  recipientName: string;
  status: string;
  currency: string;
  amount: string;
  formattedCompact: string;
}

export interface ParsedMpesaResult {
  [key: string]: unknown;
  msisdn?: string;
  customerName?: string;
  transactions: MpesaTxnItem[];
  txn1?: string;
  txn2?: string;
  tid?: string;
  amount?: string;
  dateTime?: string;
  recipient?: string;
  recipientNumber?: string;
  recipientName?: string;
  type?: string;
}

/**
 * Parses raw copied M-PESA transaction extracts into structured details.
 */
export function parseMpesaTxnText(rawText: string | null | undefined): ParsedMpesaResult | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const tidRegex = /^(?:(?:receipt\s*(?:no\.?|id)?|txn\s*(?:id|no\.?)?|transaction\s*id)[:\s-]*)?([A-Z0-9]{10})$/i;
  const dateTimeRegex = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?$/;
  const amountRegex = /^-?\d+(?:,\d{3})*(?:\.\d{1,2})?$/;
  const currencyRegex = /^(?:KES|KSH|USD)$/i;
  const statusRegex = /^(?:Completed|Failed|Reversed|Cancelled|Pending)$/i;

  const tidIndices: { index: number; tid: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(tidRegex);
    if (match) {
      if (
        (i + 1 < lines.length && dateTimeRegex.test(lines[i + 1])) ||
        (i + 2 < lines.length && dateTimeRegex.test(lines[i + 2]))
      ) {
        tidIndices.push({ index: i, tid: match[1].toUpperCase() });
      }
    }
  }

  if (tidIndices.length === 0) {
    return null;
  }

  let headerPhone = '';
  let headerName = '';

  const firstTidIdx = tidIndices[0].index;
  const headerLines = lines.slice(0, firstTidIdx);
  for (const hLine of headerLines) {
    const phoneMatch = hLine.match(/^(?:one|\+?254|0)?([17]\d{8})$/i);
    if (phoneMatch) {
      headerPhone = '0' + phoneMatch[1];
      continue;
    }
    if (/^[A-Za-z\s]{2,40}$/.test(hLine) && !currencyRegex.test(hLine) && !statusRegex.test(hLine)) {
      if (!headerName) headerName = hLine;
    }
  }

  const transactions: MpesaTxnItem[] = [];

  for (let t = 0; t < tidIndices.length; t++) {
    const startIdx = tidIndices[t].index;
    const endIdx = t + 1 < tidIndices.length ? tidIndices[t + 1].index : lines.length;
    const block = lines.slice(startIdx, endIdx);

    const tid = tidIndices[t].tid;
    let dateTime = '';
    let type = '';
    let otherParty = '';
    let status = '';
    let currency = 'KES';
    let rawAmount = '';

    for (let j = 1; j < block.length; j++) {
      const line = block[j];
      const combinedAmountMatch = line.match(/^(?:KES|KSH)\s*(-?\d+(?:,\d{3})*(?:\.\d{1,2})?)$/i) ||
                                  line.match(/^(-?\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:KES|KSH)$/i);

      if (!dateTime && dateTimeRegex.test(line)) {
        dateTime = line;
      } else if (currencyRegex.test(line)) {
        currency = line.toUpperCase();
      } else if (statusRegex.test(line)) {
        status = line;
      } else if (combinedAmountMatch) {
        rawAmount = combinedAmountMatch[1];
      } else if (amountRegex.test(line.replace(/,/g, ''))) {
        rawAmount = line;
      } else if (!type && !line.includes('****') && !/^\d/.test(line)) {
        type = line;
      } else if (!otherParty) {
        otherParty = line;
      }
    }

    let recipientName = otherParty;
    let recipientNumber = otherParty;
    if (otherParty.includes('-')) {
      const parts = otherParty.split('-');
      recipientNumber = parts[0].trim().replace(/^\+?254([17]\d)/, '0$1');
      const candidate = parts.slice(1).join('-').trim();
      if (candidate) recipientName = candidate;
    } else {
      recipientNumber = otherParty.replace(/^\+?254([17]\d)/, '0$1');
    }

    const cleanAmount = (rawAmount || '').replace(/^[-\s]+/, '').replace(/,/g, '').trim();
    const formattedCompact = `${tid} | ${dateTime} | ${recipientName || otherParty} | ${cleanAmount}`;

    transactions.push({
      tid,
      dateTime,
      type,
      otherParty,
      recipientNumber,
      recipientName,
      status,
      currency,
      amount: cleanAmount,
      formattedCompact
    });
  }

  const txn1 = transactions[0]?.formattedCompact || '';
  const txn2 = transactions[1]?.formattedCompact || '';
  const firstTxn = transactions[0];

  return {
    msisdn: headerPhone || undefined,
    customerName: headerName || undefined,
    transactions,
    txn1,
    txn2,
    tid: firstTxn?.tid,
    amount: firstTxn?.amount,
    dateTime: firstTxn?.dateTime,
    recipient: firstTxn?.otherParty,
    recipientNumber: firstTxn?.recipientNumber,
    recipientName: firstTxn?.recipientName,
    type: firstTxn?.type
  };
}

/**
 * Resolves the appropriate value from a parsed M-PESA statement for a given vetting field.
 * Strictly config-driven via item.mpesaTxn (identical to item.v360) — zero guessing.
 * Returns null if no explicit mpesaTxn mapping exists on the field.
 */
export function resolveMpesaPastedFieldValue(
  item: VettingField | null | undefined,
  parsedMpesa: ParsedMpesaResult | null | undefined
): string | null {
  if (!item || !parsedMpesa || !item.mpesaTxn) return null;
  const val = parsedMpesa[item.mpesaTxn];
  return typeof val === 'string' && val.length > 0 ? val : null;
}


