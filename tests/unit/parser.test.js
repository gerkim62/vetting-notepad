import { describe, it, expect } from 'vitest';
import { parseVettingText, isVettingClipboardText } from '../../extension/lib/parser.js';
import config from '../../extension/safaricom-vetting-config.json';

describe('Vetting Text Parser', () => {
  const types = config.types;

  it('detects vetting clipboard text header', () => {
    const text = `SIM Swap (Enhanced Vetting) – Vetting\nFull Name: John Doe (Passed)\nID Number: 12345678 (Passed)`;
    expect(isVettingClipboardText(text, types)).toBe(true);
  });

  it('returns false for arbitrary non-vetting text', () => {
    const text = `Hello, this is a random shopping list:\nMilk\nEggs\nBread`;
    expect(isVettingClipboardText(text, types)).toBe(false);
  });

  it('parses type, comment, fields, and statuses accurately', () => {
    const raw = `General Enquiry – Vetting
Customer called regarding bundle balance. Query resolved.
Full Name: Jane Doe
National ID / Document: 28394821`;

    const res = parseVettingText(raw, types);
    expect(res.typeId).toBe('general');
    expect(res.comment).toBe('Customer called regarding bundle balance. Query resolved.');
    expect(Object.keys(res.values).length).toBeGreaterThan(0);

    const geType = types.find(t => t.id === 'general');
    const allFields = [...geType.required, ...geType.optional];
    const fullNameField = allFields.find(f => f.label.includes('Full Name'));
    expect(res.values[fullNameField.id]).toBe('Jane Doe');
  });

  it('parses (Passed) and (Failed) statuses properly', () => {
    const raw = `General Enquiry – Vetting
Full Name: Jane Doe (Passed)
National ID / Document: Failed (Failed)`;

    const res = parseVettingText(raw, types);
    const geType = types.find(t => t.id === 'general');
    const allFields = [...geType.required, ...geType.optional];
    const idField = allFields.find(f => f.label.includes('ID'));
    expect(res.status[idField.id]).toBe('failed');
  });

  it('parses comma-separated group fields', () => {
    const raw = `Agent Calling (Personal Number) – Call Centre Vetting
Calling Number: 0722123456, Till / Store Number: 123456`;

    const res = parseVettingText(raw, types);
    expect(res.typeId).toBe('agent_personal');
    const apType = types.find(t => t.id === 'agent_personal');
    const callingField = apType.required.find(f => f.id === 'ap_callingno');
    const tillField = apType.required.find(f => f.id === 'ap_tillno');
    expect(res.values[callingField.id]).toBe('0722123456');
    expect(res.values[tillField.id]).toBe('123456');
  });
});
