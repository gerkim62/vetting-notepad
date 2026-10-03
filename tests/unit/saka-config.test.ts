import { describe, it, expect } from 'vitest';
import config from '../../src/safaricom-vetting-config.json';

describe('SAKA Vetting Configuration', () => {
  it('includes Agent Calling with Personal Number vetting type', () => {
    const type = config.types.find(t => t.id === 'agent_personal');
    expect(type).toBeDefined();
    if (!type) return;
    expect(type.name).toContain('Agent Calling');
    expect(type.copyTitle).toBe('Agent Calling (Personal Number) – Call Centre Vetting');
    expect(type.article).toContain('SSCB-0006');

    const reqIds = type.required.map(f => f.id);
    expect(reqIds).toContain('ap_callingno');
    expect(reqIds).toContain('ap_tillno');
    expect(reqIds).toContain('ap_opname');
    expect(reqIds).toContain('ap_opid');
    expect(reqIds).toContain('ap_opnatid');
  });

  it('includes Till Notification MSISDN Replacement vetting type', () => {
    const type = config.types.find(t => t.id === 'till_notif_replacement');
    expect(type).toBeDefined();
    if (!type) return;
    expect(type.name).toContain('Till Notification');
    expect(type.copyTitle).toBe('Till Notification MSISDN Replacement – Call Centre Vetting');
    expect(type.article).toContain('LNMO-0001');

    const reqIds = type.required.map(f => f.id);
    expect(reqIds).toContain('tn_tillno');
    expect(reqIds).toContain('tn_bizname');
    expect(reqIds).toContain('tn_nominated');
    expect(reqIds).toContain('tn_newnotif');
  });

  it('ensures all vetting types have valid required and optional arrays', () => {
    config.types.forEach(t => {
      expect(t.id).toBeDefined();
      expect(typeof t.name).toBe('string');
      expect(Array.isArray(t.required)).toBe(true);
      expect(Array.isArray(t.optional)).toBe(true);
      t.required.forEach(f => {
        expect(f.id).toBeDefined();
        expect(f.label).toBeDefined();
      });
    });
  });

  it('configures Customer Query and Resolution Given as multiline with maxLines by default', () => {
    const gen = config.types.find(t => t.id === 'general');
    expect(gen).toBeDefined();
    const queryField = gen?.required.find(f => f.id === 'gen_query');
    const resField = gen?.required.find(f => f.id === 'gen_resolution');

    expect(queryField?.multiline).toBe(true);
    expect(queryField?.maxLines).toBe(4);
    expect(resField?.multiline).toBe(true);
    expect(resField?.maxLines).toBe(4);
  });

  it('verifies policy items contain itemType and violationAdvice per SAKA guidelines', () => {
    const startKey = config.types.find(t => t.id === 'startkey');
    expect(startKey).toBeDefined();
    const txnRule = startKey?.optional.find(f => f.id === 'sk_rule_24h_txn');
    const swapRule = startKey?.optional.find(f => f.id === 'sk_rule_24h_swap');

    expect(txnRule?.excludeFromCount).toBe(true);
    expect(txnRule?.itemType).toBe('policy');
    expect(txnRule?.violationAdvice).toContain('Retail Center');

    expect(swapRule?.excludeFromCount).toBe(true);
    expect(swapRule?.itemType).toBe('policy');
    expect(swapRule?.violationAdvice).toContain('wait 24h');
  });

  it('verifies Apps Wiped post-action item is present in SIM Swap and Line Barring as itemType action', () => {
    const swap = config.types.find(t => t.id === 'swap');
    expect(swap).toBeDefined();
    const swapApps = swap?.optional.find(f => f.id === 'swap_apps_wiped');
    expect(swapApps).toBeDefined();
    expect(swapApps?.itemType).toBe('action');

    const bar = config.types.find(t => t.id === 'bar_self');
    const barApps = bar?.optional.find(f => f.id === 'bar_apps_wiped');
    expect(barApps).toBeDefined();
    expect(barApps?.itemType).toBe('action');
  });
});
