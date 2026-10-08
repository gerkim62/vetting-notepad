import { describe, it, expect } from 'vitest';
import defaultConfig from '../../src/safaricom-vetting-config.json';
import { parseVettingText } from '../../src/lib/parser.js';

describe('Siebel Interaction Ready Text & DIY Actions', () => {
  const types = defaultConfig.types;
  const reversalType = types.find(t => t.id === 'reversal');

  it('verifies default DIY actions exist on common types in config', () => {
    expect(reversalType).toBeDefined();
    expect(reversalType?.diyActions).toBeDefined();
    expect(reversalType?.diyActions?.length).toBeGreaterThan(0);
    expect(reversalType?.diyActions?.[0].label).toBe('Hakikisha');
    expect(reversalType?.diyActions?.[0].adviceText).toContain('Hakikisha');
  });

  it('parses Siebel formatted copy text with top advice line and Vetting Passed', () => {
    const rawSiebelText = `M-PESA Reversal: Reversal processed. Educated customer on Hakikisha.
Vetting: Passed
Calling Number: 0712345678
Transaction ID: TGI7XYZ123
Sender Number: 0712345678
Sender Name: John Doe (Passed)
Amount: 5000
Recipient Number: 0722000000`;

    const parsed = parseVettingText(rawSiebelText, types, 'reversal');
    expect(parsed.typeId).toBe('reversal');
    expect(parsed.values['rev_callno']).toBe('0712345678');
    expect(parsed.values['rev_tid']).toBe('TGI7XYZ123');
    expect(parsed.values['rev_sender_msisdn']).toBe('0712345678');
    expect(parsed.values['rev_sender_name']).toBe('John Doe');
    expect(parsed.status['rev_sender_name']).toBeFalsy();
  });

  it('parses Siebel formatted copy text with custom comment on Line 1', () => {
    const rawSiebelText = `M-PESA Reversal: Customer requested urgent reversal for Paybill.
Vetting: Passed
Calling Number: 0712345678
Transaction ID: TGI7XYZ123`;

    const parsed = parseVettingText(rawSiebelText, types, 'reversal');
    expect(parsed.typeId).toBe('reversal');
    expect(parsed.comment).toBe('Customer requested urgent reversal for Paybill.');
    expect(parsed.values['rev_callno']).toBe('0712345678');
    expect(parsed.values['rev_tid']).toBe('TGI7XYZ123');
  });

  it('skips Vetting: Failed line and extracts failed statuses', () => {
    const rawFailedText = `M-PESA Reversal: Failed vetting. Advised customer to confirm details.
Vetting: Failed (Sender Name)
Calling Number: 0712345678
Transaction ID: TGI7XYZ123
Sender Name: Jane Smith (Failed)`;

    const parsed = parseVettingText(rawFailedText, types, 'reversal');
    expect(parsed.typeId).toBe('reversal');
    expect(parsed.values['rev_callno']).toBe('0712345678');
    expect(parsed.values['rev_sender_name']).toBe('Jane Smith');
    expect(parsed.status['rev_sender_name']).toBe('failed');
  });

  it('parses zero values (0 or 0.00) accurately without dropping them as falsy', () => {
    const rawZeroText = `M-PESA Reversal – Vetting
Vetting: Passed
Calling Number: 0712345678
Transaction ID: TGI7XYZ123
Amount: 0
Recipient Number: 0722000000`;

    const parsed = parseVettingText(rawZeroText, types, 'reversal');
    expect(parsed.values['rev_amount']).toBe('0');
  });

  it('preserves typed value on failed fields such as Year of Birth: 1996 (Failed)', () => {
    const rawSwapFailed = `SIM Swap: Failed vetting. Advised customer to confirm FDN 1 and FDN 2 and call back.
Vetting: Failed (Year of Birth)
Calling Number: 0722123456
Line to Swap: 0722999999
Full Names: John Doe (Passed)
ID Number: 12345678 (Passed)
Year of Birth: 1996 (Failed)`;

    const parsed = parseVettingText(rawSwapFailed, types, 'swap');
    expect(parsed.typeId).toBe('swap');
    expect(parsed.values['sw_yob']).toBe('1996');
    expect(parsed.status['sw_yob']).toBe('failed');
    expect(parsed.values['sw_callno']).toBe('0722123456');
    expect(parsed.values['sw_msisdn']).toBe('0722999999');
  });

  it('parses neutral text when primary vetting line is omitted due to incomplete vetting', () => {
    const rawNeutral = `M-PESA Reversal
Calling Number: 0712345678
Transaction ID: TGI7XYZ123
Amount: 5000`;

    const parsed = parseVettingText(rawNeutral, types, 'reversal');
    expect(parsed.typeId).toBe('reversal');
    expect(parsed.values['rev_callno']).toBe('0712345678');
    expect(parsed.values['rev_tid']).toBe('TGI7XYZ123');
    expect(parsed.values['rev_amount']).toBe('5000');
  });

  it('parses dynamically grouped fields via configured groupLabel and values with /', () => {
    const rawFdnText = `SIM Swap – Vetting
Calling Number: 0722123456
Line to Swap: 0722999999
FDN 1 & 2: 0711111111 / 0722222222 (Passed)`;

    const parsed = parseVettingText(rawFdnText, types, 'swap');
    expect(parsed.values['sw_fdn1']).toBe('0711111111');
    expect(parsed.values['sw_fdn2']).toBe('0722222222');
    expect(parsed.status['sw_fdn1']).toBeNull();
    expect(parsed.status['sw_fdn2']).toBeNull();
  });

  it('parses text with clean Vetting: Failed without inline parenthesized items and preserves all field statuses', () => {
    const rawFailedText = `M-PESA Start Key / Forgotten PIN: Failed vetting. Advised customer to confirm account details and call back.
Vetting: Failed
Calling Number: 717207568
Affected M-PESA Line: 717207568
Full Names: MARTHA WANGUI KUNGU (Passed)
ID Number: 11293900 (Passed)
Year of Birth: 1971 (Passed)
FDN 1 & 2: 711779985 / 713506696 (Failed)
M-PESA Balance: 520 (Failed)
Airtime Balance: 60 (Failed)
Fuliza Limit: 200 (Passed)
Registration Date: 2020 (Failed)
Self-Txn 1: 300.00 hanna wangui 5pm (Failed)`;

    const parsed = parseVettingText(rawFailedText, types, 'startkey');
    expect(parsed.typeId).toBe('startkey');
    expect(parsed.values['sk_callno']).toBe('717207568');
    expect(parsed.values['sk_name']).toBe('MARTHA WANGUI KUNGU');
    expect(parsed.values['sk_idnum']).toBe('11293900');
    expect(parsed.values['sk_yob']).toBe('1971');
    expect(parsed.status['sk_fdn1']).toBe('failed');
    expect(parsed.status['sk_fdn2']).toBe('failed');
    expect(parsed.status['sk_mpesa_bal']).toBe('failed');
    expect(parsed.status['sk_airtime_bal']).toBe('failed');
    expect(parsed.status['sk_fuliza_limit']).toBeFalsy();
    expect(parsed.status['sk_regdate']).toBe('failed');
    expect(parsed.status['sk_mpesa_txn1']).toBe('failed');
  });

  it('parses neutral text when primary questions pass but secondary requirements are incomplete', () => {
    const rawIncomplete = `SIM Swap
Calling Number: 743171577
Line to Swap: 140365621
Full Names: JEREMIAH NYAWOKA BUNDI (Passed)
ID Number: 33636834 (Passed)
Year of Birth: 1996 (Passed)`;

    const parsed = parseVettingText(rawIncomplete, types, 'swap');
    expect(parsed.typeId).toBe('swap');
    expect(parsed.values['sw_callno']).toBe('743171577');
    expect(parsed.values['sw_msisdn']).toBe('140365621');
    expect(parsed.values['sw_name']).toBe('JEREMIAH NYAWOKA BUNDI');
    expect(parsed.values['sw_idnum']).toBe('33636834');
    expect(parsed.values['sw_yob']).toBe('1996');
    expect(parsed.comment).toBeFalsy();
  });
});
