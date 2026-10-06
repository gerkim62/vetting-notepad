import { describe, it, expect } from 'vitest';
import type { VettingType, VettingField, QuickSmsTemplate } from '../../src/types/index.js';

describe('Config UI Editor Comprehensive Model & State Operations', () => {
  it('supports editing top-level VettingType schema properties without manual JSON edits', () => {
    const vt: VettingType = {
      id: 'custom_type',
      name: 'Custom Vetting',
      required: [],
      optional: [],
      minSecondary: 2
    };

    // 1. Copy Title (Note Header)
    vt.copyTitle = 'SIM Swap (Postpay) – Siebel Notes';
    expect(vt.copyTitle).toBe('SIM Swap (Postpay) – Siebel Notes');

    // 2. Article (SAKA Standard Document)
    vt.article = 'SSCB-0042';
    expect(vt.article).toBe('SSCB-0042');

    // 3. Preset Comments list
    vt.comments = ['Verified via biometric store visit', 'Customer advised on Hakikisha'];
    expect(vt.comments).toHaveLength(2);
    expect(vt.comments[0]).toBe('Verified via biometric store visit');

    // Add and remove comments
    vt.comments.push('Call escalated to Tier 2');
    expect(vt.comments).toHaveLength(3);
    vt.comments.splice(1, 1);
    expect(vt.comments).toEqual(['Verified via biometric store visit', 'Call escalated to Tier 2']);
  });

  it('supports field-level role, compactChip, attachTo, and groupLabel configuration', () => {
    const parentField: VettingField = {
      id: 'field_msisdn',
      label: 'MSISDN // Calling',
      role: 'identifier'
    };

    const childChip: VettingField = {
      id: 'field_roaming',
      label: 'Roaming Status',
      role: 'action',
      compactChip: true,
      attachTo: 'field_msisdn'
    };

    expect(parentField.role).toBe('identifier');
    expect(childChip.role).toBe('action');
    expect(childChip.compactChip).toBe(true);
    expect(childChip.attachTo).toBe('field_msisdn');

    // Unchecking compact chip removes attachment parent
    childChip.compactChip = undefined;
    delete childChip.attachTo;
    expect(childChip.compactChip).toBeUndefined();
    expect(childChip.attachTo).toBeUndefined();
  });

  it('synchronizes groupLabel across tied pair members and clears on untie', () => {
    const field1: VettingField = { id: 'fdn1', label: 'FDN 1 // Number', role: 'secondary' };
    const field2: VettingField = { id: 'fdn2', label: 'FDN 2 // Number', role: 'secondary' };
    const list = [field1, field2];

    // Tying items
    const grpId = 'grp_test_123';
    field1.group = grpId;
    field2.group = grpId;
    const autoLabel = `${field1.label.split('//')[0].trim()} & ${field2.label.split('//')[0].trim()}`;
    field1.groupLabel = autoLabel;
    field2.groupLabel = autoLabel;

    expect(field1.groupLabel).toBe('FDN 1 & FDN 2');
    expect(field2.groupLabel).toBe('FDN 1 & FDN 2');

    // Synchronize custom groupLabel edit across group
    const customLabel = 'Frequent Dialed Numbers (1 & 2)';
    list.forEach(x => {
      if (x.group === grpId) x.groupLabel = customLabel;
    });
    expect(field1.groupLabel).toBe('Frequent Dialed Numbers (1 & 2)');
    expect(field2.groupLabel).toBe('Frequent Dialed Numbers (1 & 2)');

    // Untying pair
    list.forEach(x => {
      if (x.group === grpId) {
        delete x.group;
        delete x.groupLabel;
      }
    });
    expect(field1.group).toBeUndefined();
    expect(field1.groupLabel).toBeUndefined();
    expect(field2.group).toBeUndefined();
    expect(field2.groupLabel).toBeUndefined();
  });

  it('correctly filters and persists unpinnedVars for templates', () => {
    const tpl: QuickSmsTemplate = {
      id: 'sms_custom',
      title: 'PUK Release',
      text: 'Jambo, your PUK for {MSISDN} is {PUK}. Valid for request {REQ_ID}.'
    };

    // Parse variables regex
    const regex = /\{([^{}]+)\}/g;
    const parsed: string[] = [];
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(tpl.text)) !== null) {
      const v = match[1].trim();
      if (v && !parsed.includes(v)) parsed.push(v);
    }
    expect(parsed).toEqual(['MSISDN', 'PUK', 'REQ_ID']);

    // Mark REQ_ID and PUK as unpinned (transient)
    const unpinnedSet = new Set(['PUK', 'REQ_ID']);
    const finalUnpinned = parsed.filter(v => unpinnedSet.has(v.toUpperCase()));
    tpl.unpinnedVars = finalUnpinned;

    expect(tpl.unpinnedVars).toEqual(['PUK', 'REQ_ID']);

    // Template edited, variable removed from text: only remaining variables persist
    tpl.text = 'Jambo, your PUK for {MSISDN} is {PUK}.';
    const parsed2: string[] = [];
    while ((match = regex.exec(tpl.text)) !== null) {
      const v = match[1].trim();
      if (v && !parsed2.includes(v)) parsed2.push(v);
    }
    const finalUnpinned2 = parsed2.filter(v => unpinnedSet.has(v.toUpperCase()));
    tpl.unpinnedVars = finalUnpinned2.length > 0 ? finalUnpinned2 : undefined;

    expect(tpl.unpinnedVars).toEqual(['PUK']);
  });
});
