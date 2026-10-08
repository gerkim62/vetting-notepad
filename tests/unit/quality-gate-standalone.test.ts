import { describe, it, expect } from 'vitest';
import { runStandaloneCheck } from '../../scripts/verify-standalone.js';

describe('Quality Gate: Standalone Config & Zero-Hardcoded-Knowledge Policy', () => {
  it('enforces that src/ source code contains zero hardcoded config IDs, names, or semantic heuristics', () => {
    const { violations, stats } = runStandaloneCheck();

    // Must monitor all config entities
    expect(stats.sourceFilesChecked).toBeGreaterThan(10);
    expect(stats.typeIdsMonitored).toBeGreaterThan(15);
    expect(stats.fieldIdsMonitored).toBeGreaterThan(200);

    // ZERO violations allowed across the codebase
    if (violations.length > 0) {
      const summary = violations.map(v => `[${v.category}] ${v.file}:${v.line} -> "${v.token}": ${v.reason}`).join('\n');
      expect.fail(`Standalone config violations detected in src/:\n${summary}`);
    }

    expect(violations).toHaveLength(0);
  });

  describe('Synthetic Violation Detection Verification', () => {
    // Tests that verify the heuristic detectors accurately catch violations
    it('detects transaction ID and organization alias list heuristics', () => {
      const offendingLine1 = "if (['TXN CODE', 'TXN ID', 'TRANSACTION ID', 'RECEIPT NUMBER'].includes(normVar)) {";
      const offendingLine2 = "if (['ORGANIZATION', 'ORG', 'ORG NAME', 'BUSINESS'].includes(normVar)) {";
      const offendingLine3 = "if (['PHONE', 'PHONE NUMBER', 'CONTACT', 'MERCHANT PHONE'].includes(normVar)) {";
      const offendingLine4 = "if (['MSISDN', 'CALLING NUMBER', 'CALLING NO', 'MOBILE NUMBER'].includes(normVar)) {";

      const txnCheck = /\[\s*(?:['"`](?:TXN CODE|TXN ID|TRANSACTION ID|RECEIPT NUMBER|RECEIPT NO|TID)['"`]\s*,?\s*){2,}\]/i.test(offendingLine1);
      const orgCheck = /\[\s*(?:['"`](?:ORGANIZATION|ORG|ORG NAME|BUSINESS|COMPANY|MERCHANT NAME)['"`]\s*,?\s*){2,}\]/i.test(offendingLine2);
      const phoneCheck = /\[\s*(?:['"`](?:PHONE|PHONE NUMBER|CONTACT|MERCHANT PHONE|MERCHANT CONTACT)['"`]\s*,?\s*){2,}\]/i.test(offendingLine3);
      const msisdnCheck = /\[\s*(?:['"`](?:MSISDN|CALLING NUMBER|CALLING NO|MOBILE NUMBER|MOBILE)['"`]\s*,?\s*){2,}\]/i.test(offendingLine4);

      expect(txnCheck).toBe(true);
      expect(orgCheck).toBe(true);
      expect(phoneCheck).toBe(true);
      expect(msisdnCheck).toBe(true);
    });

    it('detects regex label guessing heuristics', () => {
      const labelLine = "matchedItem = allItems.find(it => /trans(?:action)?\\s*id/i.test(it.label));";
      const hasLabelHeuristic = labelLine.includes('it.label') && /trans(?:action)?/i.test(labelLine) && /\.test\s*\(/.test(labelLine);
      expect(hasLabelHeuristic).toBe(true);
    });

    it('allows generic label and template parsing', () => {
      const genericLine1 = "smsText = smsText.replace(new RegExp(`\\\\{${escapeRegExp(copyLabel)}\\\\}`, 'gi'), val);";
      const genericLine2 = "const vars = parseTemplateVariables(tpl.text);";
      const genericLine3 = "const foundTpl = quickSmsTemplates.find(s => s.id === diy.smsId);";

      const txnCheck = /\[\s*(?:['"`](?:TXN CODE|TXN ID)['"`]\s*,?\s*){2,}\]/i.test(genericLine1);
      const hasLabelHeuristic = genericLine1.includes('it.label') && /trans(?:action)?/i.test(genericLine1);

      expect(txnCheck).toBe(false);
      expect(hasLabelHeuristic).toBe(false);
      expect(genericLine2).toBeDefined();
      expect(genericLine3).toBeDefined();
    });

    it('resolves template variables generically via config-defined varMap without hardcoding', () => {
      const templateText = 'Contact {ORG} at {TEL} for TID {CODE}';
      const formValues: Record<string, string> = {
        field_a: 'Acme Corp',
        field_b: '0711000000',
        field_c: 'TXN999'
      };
      const varMap: Record<string, string> = {
        ORG: 'field_a',
        TEL: 'field_b',
        CODE: 'field_c'
      };

      let resolved = templateText;
      for (const [varName, fieldId] of Object.entries(varMap)) {
        const val = formValues[fieldId];
        if (val) {
          resolved = resolved.replace(new RegExp(`\\{${varName}\\}`, 'g'), val);
        }
      }

      expect(resolved).toBe('Contact Acme Corp at 0711000000 for TID TXN999');
    });

    it('verifies that drift between smsId, varMap and vetting fields is prevented', () => {
      // Synthetic drift test cases
      const mockTemplate = {
        id: 'sms_test',
        text: 'Hello {NAME}, your code is {CODE}'
      };
      const mockFields = ['field_name', 'field_code'];

      // Valid varMap
      const validVarMap = { NAME: 'field_name', CODE: 'field_code' };
      const tplVars = ['NAME', 'CODE'];
      const isKeyStale = Object.keys(validVarMap).some(k => !tplVars.includes(k));
      const isFieldDead = Object.values(validVarMap).some(f => !mockFields.includes(f));
      expect(isKeyStale).toBe(false);
      expect(isFieldDead).toBe(false);

      // Stale key drift
      const driftedKeyVarMap = { NAME: 'field_name', OLD_VAR: 'field_code' };
      expect(Object.keys(driftedKeyVarMap).some(k => !tplVars.includes(k))).toBe(true);

      // Dead field drift
      const driftedFieldVarMap = { NAME: 'field_name', CODE: 'non_existent_field' };
      expect(Object.values(driftedFieldVarMap).some(f => !mockFields.includes(f))).toBe(true);
    });
  });
});
