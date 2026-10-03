import { describe, it, expect } from 'vitest';
import defaultConfig from '../../src/safaricom-vetting-config.json';
import { buildExportPayload, validateImportPayload } from '../../src/lib/exporter.js';
import { QuickSmsTemplate, VettingDiyAction, VettingType } from '../../src/types/index.js';

describe('Data Normalization & Drift Elimination', () => {
  const types = defaultConfig.types as VettingType[];
  const reversalType = types.find(t => t.id === 'reversal');

  it('ensures VettingDiyAction in config strictly uses smsId without inlined smsText', () => {
    expect(reversalType).toBeDefined();
    expect(reversalType?.diyActions).toBeDefined();
    expect(reversalType?.diyActions?.length).toBeGreaterThan(0);

    for (const t of types) {
      if (Array.isArray(t.diyActions)) {
        for (const diy of t.diyActions) {
          expect(diy.id).toBeDefined();
          expect(diy.label).toBeDefined();
          expect(diy.adviceText).toBeDefined();
          // smsText must NOT exist on any config DIY action
          expect((diy as any).smsText).toBeUndefined();
          // smsId must be a valid identifier string if present
          if (diy.smsId) {
            expect(typeof diy.smsId).toBe('string');
            expect(diy.smsId.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('dynamically resolves SMS text from quickSmsTemplates via smsId (zero data drift)', () => {
    const mockQuickSms: QuickSmsTemplate[] = [
      {
        id: 'sms_hakikisha',
        title: 'Hakikisha Verification Advice',
        text: 'Original SMS text'
      }
    ];

    const hakikishaDiy = reversalType?.diyActions?.find(d => d.id === 'diy_hakikisha');
    expect(hakikishaDiy).toBeDefined();
    expect(hakikishaDiy?.smsId).toBe('sms_hakikisha');

    // Initial resolution
    let resolvedText = mockQuickSms.find(s => s.id === hakikishaDiy?.smsId)?.text;
    expect(resolvedText).toBe('Original SMS text');

    // Agent edits template in Quick SMS manager
    const tpl = mockQuickSms.find(s => s.id === 'sms_hakikisha')!;
    tpl.text = 'Updated SMS text with new *334# instructions';

    // DIY resolution immediately reflects updated template without modifying VettingType
    resolvedText = mockQuickSms.find(s => s.id === hakikishaDiy?.smsId)?.text;
    expect(resolvedText).toBe('Updated SMS text with new *334# instructions');
  });

  it('handles detached or unlinked DIY actions gracefully without errors', () => {
    const mockQuickSms: QuickSmsTemplate[] = [
      { id: 'sms_other', title: 'Other SMS', text: 'Some text' }
    ];

    const unlinkedDiy: VettingDiyAction = {
      id: 'diy_no_sms',
      label: 'Manual Action',
      adviceText: 'Guided customer manually',
      smsId: undefined
    };

    const resolved = unlinkedDiy.smsId ? mockQuickSms.find(s => s.id === unlinkedDiy.smsId)?.text : undefined;
    expect(resolved).toBeUndefined();
  });

  it('preserves Quick SMS templates and DIY links across Schema v2 Export & Import', () => {
    const sampleSms: QuickSmsTemplate[] = [
      { id: 'sms_hakikisha', title: 'Hakikisha', text: 'Confirm recipient name' },
      { id: 'sms_custom_1', title: 'Custom Quick SMS', text: 'Hello customer' }
    ];

    const payload = buildExportPayload({
      types,
      settings: { theme: 'dark', autoClear: 0 },
      savedComments: ['Verified'],
      activeTypeId: 'reversal',
      quickSmsTemplates: sampleSms,
      quickInteractionTemplates: [{ id: 'int_1', title: 'Follow-up', text: 'Follow up in 2h' }]
    });

    expect(payload.version).toBe(2);
    expect(payload.quickSmsTemplates).toHaveLength(2);
    expect(payload.quickInteractionTemplates).toHaveLength(1);

    // Validate import payload
    const validation = validateImportPayload(payload);
    expect(validation.valid).toBe(true);
    expect(validation.payload?.version).toBe(2);
    expect(validation.payload?.quickSmsTemplates).toHaveLength(2);
    expect(validation.payload?.quickSmsTemplates?.[0].id).toBe('sms_hakikisha');

    // Verify linked DIY action in imported types matches the imported template
    const importedReversal = validation.payload?.types.find(t => t.id === 'reversal');
    const importedDiy = importedReversal?.diyActions?.find(d => d.id === 'diy_hakikisha');
    expect(importedDiy?.smsId).toBe('sms_hakikisha');
    const matchedSms = validation.payload?.quickSmsTemplates?.find(s => s.id === importedDiy?.smsId);
    expect(matchedSms?.text).toBe('Confirm recipient name');
  });

  it('maintains backward compatibility with Schema v1 import files', () => {
    const v1Payload = {
      app: 'vetting-notepad',
      version: 1,
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      types: [{ id: 'reversal', name: 'Reversal', required: [], optional: [] }],
      settings: { theme: 'auto', autoClear: 0 },
      savedComments: [],
      activeTypeId: 'reversal'
    };

    const res = validateImportPayload(v1Payload);
    expect(res.valid).toBe(true);
    expect(res.payload?.types).toHaveLength(1);
    expect(res.payload?.quickSmsTemplates).toBeUndefined();
  });
});
