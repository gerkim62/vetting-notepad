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
    const rawSiebelText = `M-PESA & Airtime Reversal: Reversal processed. Educated customer on Hakikisha.
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
    const rawSiebelText = `M-PESA & Airtime Reversal: Customer requested urgent reversal for Paybill.
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
    const rawFailedText = `M-PESA & Airtime Reversal: Failed vetting. Advised customer to confirm details.
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
});
