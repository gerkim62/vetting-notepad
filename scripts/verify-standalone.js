#!/usr/bin/env node

/**
 * Quality Gate: Standalone Config & Zero-Hardcoded-Knowledge Enforcement
 * 
 * Enforces Repository Rule:
 * "THE CODE MUST KNOW 0 ABOUT OUR SPECIFIC JSON CONFIG IDS OR NAMES LET CONFIG BE FULLY STANDALONE"
 * 
 * Scans all source files in `src/` to guarantee that:
 * 1. Zero specific config Type IDs (e.g., 'paybill_reversal', 'swap', 'startkey') are hardcoded in code.
 * 2. Zero specific config Field IDs (e.g., 'pbr_orgname', 'sk_rule_24h_txn') are hardcoded in code.
 * 3. Zero specific config DIY Action IDs (e.g., 'diy_paybill_merchant_sms') are hardcoded in code.
 * 4. Zero specific config Vetting Type Names (e.g., 'Paybill Reversal', 'SIM Upgrade') are hardcoded in code.
 * 5. Zero specific SAKA article codes (e.g., 'LPPP-0014', 'VMDA-0001') are hardcoded in code.
 * 6. Zero heuristic / semantic field-guessing arrays or regexes trying to map form fields by hardcoded labels.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');

/**
 * @typedef {Object} Violation
 * @property {string} file
 * @property {number} line
 * @property {string} category
 * @property {string} token
 * @property {string} lineText
 * @property {string} reason
 */

function findConfigFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findConfigFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name.includes('config')) {
      results.push(fullPath);
    }
  }
  return results;
}

function findSourceFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.json')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

export function runStandaloneCheck() {
  const configFiles = findConfigFiles(srcDir);
  if (configFiles.length === 0) {
    console.warn('⚠️ No config JSON files found in src/');
    return { violations: [], stats: {} };
  }

  const typeIds = new Set();
  const typeNames = new Set();
  const fieldIds = new Set();
  const diyActionIds = new Set();
  const articleCodes = new Set();

  for (const cfgFile of configFiles) {
    const raw = fs.readFileSync(cfgFile, 'utf8');
    const cfg = JSON.parse(raw);

    if (Array.isArray(cfg.types)) {
      for (const t of cfg.types) {
        if (t.id && typeof t.id === 'string') typeIds.add(t.id.trim());
        if (t.name && typeof t.name === 'string') {
          const trimmedName = t.name.trim();
          // Exclude overly generic single-word names if any (e.g. "General")
          if (trimmedName.length > 5 && trimmedName.toLowerCase() !== 'general') {
            typeNames.add(trimmedName);
          }
        }
        if (t.article && typeof t.article === 'string') {
          const matches = t.article.match(/[A-Z]{3,4}-\d{4}/g);
          if (matches) {
            for (const m of matches) articleCodes.add(m);
          }
        }

        const allFields = [...(t.required || []), ...(t.optional || [])];
        for (const f of allFields) {
          if (f.id && typeof f.id === 'string') fieldIds.add(f.id.trim());
          if (f.info && typeof f.info === 'string') {
            const matches = f.info.match(/[A-Z]{3,4}-\d{4}/g);
            if (matches) {
              for (const m of matches) articleCodes.add(m);
            }
          }
        }

        if (Array.isArray(t.diyActions)) {
          for (const d of t.diyActions) {
            if (d.id && typeof d.id === 'string') diyActionIds.add(d.id.trim());
          }
        }
      }
    }
  }

  const sourceFiles = findSourceFiles(srcDir);
  const violations = [];

  // Patterns for forbidden semantic heuristics (field guessing arrays / label regexes)
  const semanticHeuristicPatterns = [
    {
      check: (line) => /\[\s*(?:['"`](?:TXN CODE|TXN ID|TRANSACTION ID|RECEIPT NUMBER|RECEIPT NO|TID)['"`]\s*,?\s*){2,}\]/i.test(line),
      reason: 'Hardcoded transaction ID alias list. Templates must bind polymorphically or via user inputs without semantic heuristics.'
    },
    {
      check: (line) => /\[\s*(?:['"`](?:ORGANIZATION|ORG|ORG NAME|BUSINESS|COMPANY|MERCHANT NAME)['"`]\s*,?\s*){2,}\]/i.test(line),
      reason: 'Hardcoded organization alias list. Code must not guess field semantics.'
    },
    {
      check: (line) => /\[\s*(?:['"`](?:PHONE|PHONE NUMBER|CONTACT|MERCHANT PHONE|MERCHANT CONTACT)['"`]\s*,?\s*){2,}\]/i.test(line),
      reason: 'Hardcoded phone alias list. Code must not guess field semantics.'
    },
    {
      check: (line) => /\[\s*(?:['"`](?:MSISDN|CALLING NUMBER|CALLING NO|MOBILE NUMBER|MOBILE)['"`]\s*,?\s*){2,}\]/i.test(line),
      reason: 'Hardcoded MSISDN alias list. Code must not guess field semantics.'
    },
    {
      check: (line) => /\[\s*(?:['"`](?:CUSTOMER NAME|NAME|SENDER NAME)['"`]\s*,?\s*){2,}\]/i.test(line),
      reason: 'Hardcoded customer name alias list. Code must not guess field semantics.'
    },
    {
      check: (line) => line.includes('it.label') && /trans(?:action)?/i.test(line) && /\.test\s*\(/.test(line),
      reason: 'Label regex heuristic guessing transaction ID. Template variable substitution must rely strictly on exact label replacement.'
    },
    {
      check: (line) => line.includes('it.label') && /org(?:anization)?/i.test(line) && /\.test\s*\(/.test(line),
      reason: 'Label regex heuristic guessing organization name. Field matching must be generic.'
    },
    {
      check: (line) => line.includes('it.label') && /merchant/i.test(line) && /\.test\s*\(/.test(line),
      reason: 'Label regex heuristic guessing merchant contact. Field matching must be generic.'
    },
    {
      check: (line) => /(?:find|filter)\s*\([^)]*it\.mpesaTxn\s*===[^)]*(?:receiptNumber|orgName|customerName)/.test(line),
      reason: 'Searching vetting fields by mpesaTxn for template filling. Templates must use clean copyLabel or user inputs.'
    }
  ];

  // Precompiled unified regexes for high-performance scanning
  const typeIdRegex = typeIds.size > 0 ? new RegExp(`['"\`^/](${[...typeIds].map(escapeRegex).join('|')})['"\`$/]`) : null;
  const fieldIdRegex = fieldIds.size > 0 ? new RegExp(`['"\`^/](${[...fieldIds].map(escapeRegex).join('|')})['"\`$/]`) : null;
  const diyActionIdRegex = diyActionIds.size > 0 ? new RegExp(`['"\`^/](${[...diyActionIds].map(escapeRegex).join('|')})['"\`$/]`) : null;
  const typeNameRegex = typeNames.size > 0 ? new RegExp(`['"\`](${[...typeNames].map(escapeRegex).join('|')})['"\`]`) : null;
  const articleRegex = articleCodes.size > 0 ? new RegExp(`['"\`\\b](${[...articleCodes].map(escapeRegex).join('|')})['"\`\\b]`) : null;

  for (const srcFile of sourceFiles) {
    const relPath = path.relative(rootDir, srcFile);
    const content = fs.readFileSync(srcFile, 'utf8');
    const lines = content.split(/\r?\n/);

    let inBlockComment = false;

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const trimmed = line.trim();

      // Comment handling
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        return;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        return;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return;
      }

      // Check 1: Hardcoded Type IDs
      if (typeIdRegex) {
        const m = line.match(typeIdRegex);
        if (m) {
          violations.push({
            file: relPath,
            line: lineNum,
            category: 'CONFIG_TYPE_ID',
            token: m[1],
            lineText: trimmed,
            reason: `Vetting Type ID '${m[1]}' is hardcoded. Code must interact with vetting types generically via schema.`
          });
        }
      }

      // Check 2: Hardcoded Field IDs
      if (fieldIdRegex) {
        const m = line.match(fieldIdRegex);
        if (m) {
          violations.push({
            file: relPath,
            line: lineNum,
            category: 'CONFIG_FIELD_ID',
            token: m[1],
            lineText: trimmed,
            reason: `Vetting Field ID '${m[1]}' is hardcoded. Code must not reference specific field IDs.`
          });
        }
      }

      // Check 3: Hardcoded DIY Action IDs
      if (diyActionIdRegex) {
        const m = line.match(diyActionIdRegex);
        if (m) {
          violations.push({
            file: relPath,
            line: lineNum,
            category: 'CONFIG_DIY_ACTION_ID',
            token: m[1],
            lineText: trimmed,
            reason: `DIY Action ID '${m[1]}' is hardcoded. DIY actions must be handled generically from the type definition.`
          });
        }
      }

      // Check 4: Hardcoded Vetting Type Names
      if (typeNameRegex) {
        const m = line.match(typeNameRegex);
        if (m) {
          violations.push({
            file: relPath,
            line: lineNum,
            category: 'CONFIG_TYPE_NAME',
            token: m[1],
            lineText: trimmed,
            reason: `Vetting Type Name '${m[1]}' is hardcoded. Display names must be loaded dynamically from config.`
          });
        }
      }

      // Check 5: Hardcoded SAKA Articles
      if (articleRegex) {
        const m = line.match(articleRegex);
        if (m) {
          violations.push({
            file: relPath,
            line: lineNum,
            category: 'CONFIG_ARTICLE_CODE',
            token: m[1],
            lineText: trimmed,
            reason: `SAKA Article code '${m[1]}' is hardcoded. Articles belong strictly inside config metadata.`
          });
        }
      }

      // Check 6: Semantic Field-Guessing Heuristics (e.g. the removed block from L1854-L1881)
      if (!relPath.includes('src/lib/parser.ts')) {
        for (const heuristic of semanticHeuristicPatterns) {
          if (heuristic.check(line)) {
            violations.push({
              file: relPath,
              line: lineNum,
              category: 'SEMANTIC_FIELD_GUESSING',
              token: trimmed.slice(0, 50),
              lineText: trimmed,
              reason: heuristic.reason
            });
          }
        }
      }
    });
  }

  // Check 7: Config Schema Integrity & Drift Detection (smsId & varMap validation)
  for (const cfgFile of configFiles) {
    const raw = fs.readFileSync(cfgFile, 'utf8');
    const cfg = JSON.parse(raw);
    const relCfgPath = path.relative(rootDir, cfgFile);

    const availableTpls = new Map();
    if (Array.isArray(cfg.quickSmsTemplates)) {
      for (const tpl of cfg.quickSmsTemplates) {
        if (tpl.id) availableTpls.set(tpl.id, tpl);
      }
    }

    if (Array.isArray(cfg.types)) {
      for (const t of cfg.types) {
        if (!Array.isArray(t.diyActions)) continue;
        const allFieldIds = new Set([...(t.required || []), ...(t.optional || [])].map(f => f.id));

        for (const diy of t.diyActions) {
          if (!diy.smsId) continue;

          // Check A: Verify smsId resolves to a known template
          const tpl = availableTpls.get(diy.smsId);
          if (availableTpls.size > 0 && !tpl) {
            violations.push({
              file: relCfgPath,
              line: 1,
              category: 'DRIFT_ORPHAN_SMS_ID',
              token: diy.smsId,
              lineText: `DIY action '${diy.id}' (${diy.label}) in type '${t.id}' links to non-existent smsId '${diy.smsId}'`,
              reason: `DIY action links to an unresolvable SMS template ID. Co-locate or fix template ID in quickSmsTemplates.`
            });
            continue;
          }

          if (diy.varMap && typeof diy.varMap === 'object') {
            const tplVars = tpl
              ? (tpl.text.match(/\{([^{}]+)\}/g) || []).map(v => v.slice(1, -1).trim())
              : [];

            for (const [varName, targetField] of Object.entries(diy.varMap)) {
              // Check B: Verify varMap key actually exists in template text
              if (tpl && !tplVars.includes(varName)) {
                violations.push({
                  file: relCfgPath,
                  line: 1,
                  category: 'DRIFT_STALE_VARMAP_KEY',
                  token: varName,
                  lineText: `DIY action '${diy.id}' varMap defines key '${varName}' which does not exist in template '${diy.smsId}'`,
                  reason: `Template text does not contain '{${varName}}'. Variable mapping is stale or drifted.`
                });
              }

              // Check C: Verify targetField exists in the vetting type
              if (!allFieldIds.has(targetField)) {
                violations.push({
                  file: relCfgPath,
                  line: 1,
                  category: 'DRIFT_DEAD_VARMAP_FIELD',
                  token: targetField,
                  lineText: `DIY action '${diy.id}' varMap targets field '${targetField}' which does not exist in type '${t.id}'`,
                  reason: `Vetting type '${t.id}' has no field with ID '${targetField}'. Field mapping is dead or drifted.`
                });
              }
            }
          }
        }
      }
    }
  }

  const stats = {
    sourceFilesChecked: sourceFiles.length,
    configFilesScanned: configFiles.length,
    typeIdsMonitored: typeIds.size,
    typeNamesMonitored: typeNames.size,
    fieldIdsMonitored: fieldIds.size,
    diyActionIdsMonitored: diyActionIds.size,
    articleCodesMonitored: articleCodes.size
  };

  return { violations, stats };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CLI Execution Entry Point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('\n🔍 [Quality Gate] Verifying Standalone Config Isolation & Zero Hardcoded Entity Knowledge...');
  const { violations, stats } = runStandaloneCheck();

  console.log(`   • Scanned ${stats.sourceFilesChecked} source files across ${stats.configFilesScanned} config file(s)`);
  console.log(`   • Monitored entities: ${stats.typeIdsMonitored} Types, ${stats.fieldIdsMonitored} Fields, ${stats.diyActionIdsMonitored} DIY Actions, ${stats.typeNamesMonitored} Names, ${stats.articleCodesMonitored} Articles\n`);

  if (violations.length === 0) {
    console.log('✅ [Quality Gate PASSED]: 0 hardcoded config IDs, names, or semantic field heuristics found.');
    console.log('   Config is 100% standalone and isolated.\n');
    process.exit(0);
  } else {
    console.error(`❌ [Quality Gate FAILED]: Found ${violations.length} hardcoded config violation(s)!\n`);
    for (const v of violations) {
      console.error(`   [${v.category}] ${v.file}:${v.line}`);
      console.error(`   Offending Token: "${v.token}"`);
      console.error(`   Code:            ${v.lineText}`);
      console.error(`   Remediation:     ${v.reason}\n`);
    }
    process.exit(1);
  }
}
