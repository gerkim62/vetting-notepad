import { describe, it, expect } from 'vitest';
import { parseVettingText, isVettingClipboardText, parseMpesaTxnText, resolveMpesaPastedFieldValue } from '../../src/lib/parser.js';
import config from '../../src/safaricom-vetting-config.json';

const types = config.types;

describe('Vetting Text Parser', () => {

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
    expect(geType).toBeDefined();
    if (!geType) return;
    const allFields = [...geType.required, ...geType.optional];
    const fullNameField = allFields.find(f => f.label.includes('Full Name'));
    expect(fullNameField).toBeDefined();
    if (!fullNameField) return;
    expect(res.values[fullNameField.id]).toBe('Jane Doe');
  });

  it('parses (Passed) and (Failed) statuses properly', () => {
    const raw = `General Enquiry – Vetting
Full Name: Jane Doe (Passed)
National ID / Document: Failed (Failed)`;

    const res = parseVettingText(raw, types);
    const geType = types.find(t => t.id === 'general');
    expect(geType).toBeDefined();
    if (!geType) return;
    const allFields = [...geType.required, ...geType.optional];
    const idField = allFields.find(f => f.label.includes('ID'));
    expect(idField).toBeDefined();
    if (!idField) return;
    expect(res.status[idField.id]).toBe('failed');
  });

  it('parses comma-separated group fields', () => {
    const raw = `Agent Calling (Personal Number) – Call Centre Vetting
Calling Number: 0722123456, Till / Store Number: 123456`;

    const res = parseVettingText(raw, types);
    expect(res.typeId).toBe('agent_personal');
    const apType = types.find(t => t.id === 'agent_personal');
    expect(apType).toBeDefined();
    if (!apType) return;
    const callingField = apType.required.find(f => f.id === 'ap_callingno');
    const tillField = apType.required.find(f => f.id === 'ap_tillno');
    expect(callingField).toBeDefined();
    expect(tillField).toBeDefined();
    if (!callingField || !tillField) return;
    expect(res.values[callingField.id]).toBe('0722123456');
    expect(res.values[tillField.id]).toBe('123456');
  });
});

describe('Smart M-PESA Transaction Statement Parser', () => {
  it('parses multi-transaction extract with phone and customer name correctly', () => {
    const raw = `one791649226
Stephen


UJ1E29HKJW
01/10/2026 10:26:25
Customer Payment to Pochi
25411****402 - FRANCSAM OKELLO
Completed
KES
-300.00

UJ1E29H946
01/10/2026 09:55:19
Customer Payment to Pochi
011****957 - Millicent **** Mbiri
Completed
KES
-30.00`;

    const res = parseMpesaTxnText(raw);
    expect(res).not.toBeNull();
    if (!res) return;

    expect(res.msisdn).toBe('0791649226');
    expect(res.customerName).toBe('Stephen');
    expect(res.transactions.length).toBe(2);

    expect(res.tid).toBe('UJ1E29HKJW');
    expect(res.dateTime).toBe('01/10/2026 10:26:25');
    expect(res.type).toBe('Customer Payment to Pochi');
    expect(res.amount).toBe('300.00');
    expect(res.recipient).toBe('25411****402 - FRANCSAM OKELLO');
    expect(res.recipientName).toBe('FRANCSAM OKELLO');

    expect(res.txn1).toBe('UJ1E29HKJW | 01/10/2026 10:26:25 | FRANCSAM OKELLO | 300.00');
    expect(res.txn2).toBe('UJ1E29H946 | 01/10/2026 09:55:19 | Millicent **** Mbiri | 30.00');
  });

  it('parses single transaction extract without header', () => {
    const raw = `TB87910234
15/09/2026 14:10:00
Pay Bill
247247 - EQUITY BANK
Completed
KES
1500.00`;

    const res = parseMpesaTxnText(raw);
    expect(res).not.toBeNull();
    if (!res) return;

    expect(res.transactions.length).toBe(1);
    expect(res.tid).toBe('TB87910234');
    expect(res.dateTime).toBe('15/09/2026 14:10:00');
    expect(res.amount).toBe('1500.00');
    expect(res.recipientName).toBe('EQUITY BANK');
    expect(res.txn1).toBe('TB87910234 | 15/09/2026 14:10:00 | EQUITY BANK | 1500.00');
  });

  it('returns null for arbitrary non-mpesa text', () => {
    expect(parseMpesaTxnText('Hello world\nThis is just some random text')).toBeNull();
  });

  it('correctly maps fields strictly via item.mpesaTxn and excludes unmapped fields', () => {
    const raw = `one791649226
Stephen

UJ1E29HKJW
01/10/2026 10:26:25
Customer Payment to Pochi
25411****402 - FRANCSAM OKELLO
Completed
KES
-300.00`;

    const parsed = parseMpesaTxnText(raw);
    expect(parsed).not.toBeNull();

    // 1. Recipient field with explicit mpesaTxn: 'recipient'
    const revRecipientField = { id: 'rev_recipient', label: 'Recipient Number / Till', mpesaTxn: 'recipient' };
    expect(resolveMpesaPastedFieldValue(revRecipientField, parsed)).toBe('25411****402 - FRANCSAM OKELLO');

    // 2. Recipient Airtime Bal field with NO mpesaTxn mapping MUST return null (zero guessing)
    const revAirtimeBalField = { id: 'rev_recipient_airtime', label: 'Recipient Airtime Bal' };
    expect(resolveMpesaPastedFieldValue(revAirtimeBalField, parsed)).toBeNull();

    // 3. Amount field with mpesaTxn: 'amount'
    const revAmountField = { id: 'rev_amount', label: 'Amount', mpesaTxn: 'amount' };
    expect(resolveMpesaPastedFieldValue(revAmountField, parsed)).toBe('300.00');

    // 4. M-PESA Balance field without mpesaTxn MUST return null
    const mpesaBalField = { id: 'sw_mpesa_bal', label: 'M-PESA Balance // SAKA Margins' };
    expect(resolveMpesaPastedFieldValue(mpesaBalField, parsed)).toBeNull();

    // 5. Transaction ID field with mpesaTxn: 'tid'
    const tidField = { id: 'rev_tid', label: 'Transaction ID', mpesaTxn: 'tid' };
    expect(resolveMpesaPastedFieldValue(tidField, parsed)).toBe('UJ1E29HKJW');

    // 6. Calling Number field with mpesaTxn: 'msisdn'
    const callnoField = { id: 'rev_callno', label: 'Calling Number', mpesaTxn: 'msisdn' };
    expect(resolveMpesaPastedFieldValue(callnoField, parsed)).toBe('0791649226');

    // 7. Verify config defaults directly from safaricom-vetting-config.json
    const reversalType = types.find(t => t.id === 'reversal');
    expect(reversalType).toBeDefined();
    const configRecipientField = reversalType?.required.find(f => f.id === 'rev_recipient');
    expect(configRecipientField?.mpesaTxn).toBe('recipient');
    expect(configRecipientField?.len).toBe(0);
    expect(resolveMpesaPastedFieldValue(configRecipientField, parsed)).toBe('25411****402 - FRANCSAM OKELLO');

    const configAirtimeBal = reversalType?.optional.find(f => f.id === 'rev_recipient_airtime');
    expect(configAirtimeBal?.mpesaTxn).toBeUndefined();
    expect(resolveMpesaPastedFieldValue(configAirtimeBal, parsed)).toBeNull();
  });
});


