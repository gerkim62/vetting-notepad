import { describe, it, expect } from 'vitest';
import config from '../../extension/safaricom-vetting-config.json';

describe('SAKA Vetting Configuration', () => {
  it('includes Agent Calling with Personal Number vetting type', () => {
    const type = config.types.find(t => t.id === 'agent_personal');
    expect(type).toBeDefined();
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
});
