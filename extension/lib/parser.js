/**
 * Vetting Text Parser & Reverse Re-population Engine
 * Parses standard clipboard vetting blocks back into type selection, values, statuses, and comments.
 */

function cleanLabel(rawLabel) {
  if (!rawLabel) return '';
  const parts = String(rawLabel).split('//');
  return parts[0].trim().toLowerCase();
}

/**
 * Checks whether the given text looks like a vetting clipboard block.
 * @param {string} rawText 
 * @param {Array} types 
 * @returns {boolean}
 */
export function isVettingClipboardText(rawText, types) {
  if (!rawText || typeof rawText !== 'string') return false;
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const firstLine = lines[0].toLowerCase();

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
      const key = cleanLabel(line.split(':')[0]);
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
 * @param {string} rawText 
 * @param {Array} types 
 * @param {string} [fallbackTypeId] 
 * @returns {{ typeId: string|null, comment: string, values: Record<string, string>, status: Record<string, string|null> }}
 */
export function parseVettingText(rawText, types, fallbackTypeId = null) {
  const result = {
    typeId: fallbackTypeId || (types[0] ? types[0].id : null),
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
  let matchedType = null;
  const firstLine = lines[0].toLowerCase();

  for (const t of types) {
    const copyTitle = (t.copyTitle || `${t.name} – Vetting`).toLowerCase();
    const typeName = t.name.toLowerCase();
    if (firstLine === copyTitle || firstLine.includes(typeName)) {
      matchedType = t;
      break;
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
    matchedType = types.find(t => t.id === fallbackTypeId) || types[0];
  } else {
    matchedType = types[0];
  }

  const allItems = [...(matchedType.required || []), ...(matchedType.optional || [])];

  // Helper to match a field by label string
  const findField = (keyStr) => {
    const cleanKey = cleanLabel(keyStr).replace(/[^a-z0-9]/g, ' ').trim();
    const keyTokens = cleanKey.split(/\s+/).filter(Boolean);

    // 1. Exact or prefix match
    let match = allItems.find(it => {
      const cl = cleanLabel(it.label).replace(/[^a-z0-9]/g, ' ').trim();
      return cl === cleanKey || cl.startsWith(cleanKey) || cleanKey.startsWith(cl);
    });
    if (match) return match;

    // 2. Token overlap score
    let bestField = null;
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
  // If first line was header, skip it
  if (lines.length > 0) {
    const l0 = lines[0].toLowerCase();
    const copyTitle = (matchedType.copyTitle || `${matchedType.name} – Vetting`).toLowerCase();
    if (l0 === copyTitle || l0.includes(matchedType.name.toLowerCase())) {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    // Check for referral / callback footer notes to skip
    if (line.startsWith('Referred to Retail') || line.startsWith('Failed vetting. Advised') || line.startsWith('Failed vetting again.')) {
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
    // e.g., "Calling Number: 0722123456, Till / Store Number: 123456"
    // Regex splits by comma followed by a Key: Value pattern
    const kvSegments = line.split(/,\s*(?=[^:]+:)/);

    for (const segment of kvSegments) {
      const match = segment.match(/^\s*([^:]+?)\s*:\s*(.*?)(?:\s*\((Passed|Failed)\))?\s*$/i);
      if (match) {
        const rawKey = match[1].trim();
        let rawVal = (match[2] || '').trim();
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
