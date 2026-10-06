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

  it('includes Till Notification SIM Swap vetting type', () => {
    const type = config.types.find(t => t.id === 'till_notif_replacement');
    expect(type).toBeDefined();
    if (!type) return;
    expect(type.name).toContain('Till Notification');
    expect(type.copyTitle).toBe('Till Notification SIM Swap – Call Centre Vetting');
    expect(type.article).toContain('LBCF-0014');

    const reqIds = type.required.map(f => f.id);
    expect(reqIds).toContain('tn_tillno');
    expect(reqIds).toContain('tn_bizname');
    expect(reqIds).toContain('tn_nominated');
    expect(reqIds).toContain('tn_till_msisdn');
    expect(reqIds).toContain('tn_simex_serial');
  });

  it('includes Agent Reversal vetting type per DSMP-0008', () => {
    const type = config.types.find(t => t.id === 'agent_reversal');
    expect(type).toBeDefined();
    if (!type) return;
    expect(type.name).toBe('Agent Reversal');
    expect(type.copyTitle).toBe('Agent Reversal – Call Centre Vetting');
    expect(type.article).toContain('DSMP-0008');

    const reqIds = type.required.map(f => f.id);
    expect(reqIds).toContain('ar_agent_no');
    expect(reqIds).toContain('ar_till_msisdn');
    expect(reqIds).toContain('ar_op_name');
    expect(reqIds).toContain('ar_op_natid');
    expect(reqIds).toContain('ar_txnid');
    expect(reqIds).toContain('ar_amount');
    expect(reqIds).toContain('ar_txntype');
    expect(reqIds).toContain('ar_customer_no');
  });

  it('verifies DIY actions for PUK, Agent, Till Swap, Pooled Number, and General Enquiry', () => {
    const puk = config.types.find(t => t.id === 'puk');
    expect(puk?.diyActions?.some(d => d.id === 'diy_puk_issuance')).toBe(true);

    const ap = config.types.find(t => t.id === 'agent_personal');
    expect(ap?.diyActions?.some(d => d.id === 'diy_agent_rev_2530')).toBe(true);

    const ar = config.types.find(t => t.id === 'agent_reversal');
    expect(ar?.diyActions?.some(d => d.id === 'diy_agent_rev_2530')).toBe(true);

    const gen = config.types.find(t => t.id === 'general');
    expect(gen?.diyActions?.some(d => d.id === 'diy_statement_334')).toBe(true);
    expect(gen?.diyActions?.some(d => d.id === 'diy_stop_promo_456')).toBe(true);
    expect(gen?.diyActions?.some(d => d.id === 'diy_report_fraud_333')).toBe(true);

    const till = config.types.find(t => t.id === 'till_notif_replacement');
    expect(till?.diyActions?.some(d => d.id === 'diy_till_sim_swap_234')).toBe(true);

    const pooled = config.types.find(t => t.id === 'pooled');
    expect(pooled?.diyActions?.some(d => d.id === 'diy_pooled_reactivation_100')).toBe(true);
  });

  it('includes split reversal types: M-PESA Reversal, Paybill Reversal, and Airtime Reversal', () => {
    const mpesaRev = config.types.find(t => t.id === 'reversal');
    expect(mpesaRev).toBeDefined();
    expect(mpesaRev?.name).toBe('M-PESA Reversal');

    const paybillRev = config.types.find(t => t.id === 'paybill_reversal');
    expect(paybillRev).toBeDefined();
    expect(paybillRev?.name).toBe('Paybill Reversal');
    expect(paybillRev?.article).toContain('LPPP-0014');

    const airtimeRev = config.types.find(t => t.id === 'airtime_reversal');
    expect(airtimeRev).toBeDefined();
    expect(airtimeRev?.name).toBe('Airtime Reversal');
    expect(airtimeRev?.article).toContain('MALP-0001');
    expect(airtimeRev?.required.some(f => f.id === 'atr_inbalance')).toBe(true);
  });

  it('verifies updated SRFB-0005 Pooled Lines configuration', () => {
    const pooled = config.types.find(t => t.id === 'pooled');
    expect(pooled).toBeDefined();
    expect(pooled?.article).toBe('SRFB-0005');

    const reqIds = pooled?.required.map(f => f.id);
    expect(reqIds).toContain('pol_callno');
    expect(reqIds).toContain('pol_msisdn');
    expect(reqIds).toContain('pol_name');
    expect(reqIds).toContain('pol_idnum');
    expect(reqIds).toContain('pol_old_simex');

    const oldSimPolicy = pooled?.optional.find(f => f.id === 'pol_rule_old_sim');
    expect(oldSimPolicy?.itemType).toBe('policy');
    expect(oldSimPolicy?.excludeFromCount).toBe(true);

    const topUpPolicy = pooled?.optional.find(f => f.id === 'pol_rule_topup_7d');
    expect(topUpPolicy?.itemType).toBe('policy');
    expect(topUpPolicy?.excludeFromCount).toBe(true);
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

  it('verifies SIMEX serial fields have defaultValue 89254021, omitDefault true, and len 20', () => {
    const simexFields: Array<{ typeId: string; fieldId: string; item: any }> = [];
    config.types.forEach(t => {
      [...t.required, ...t.optional].forEach(f => {
        if (f.id.includes('simex') || f.label.toLowerCase().includes('simex')) {
          simexFields.push({ typeId: t.id, fieldId: f.id, item: f });
        }
      });
    });

    expect(simexFields.length).toBeGreaterThanOrEqual(4);
    simexFields.forEach(({ typeId, fieldId, item }) => {
      expect(item.len, `${typeId}.${fieldId} len`).toBe(20);
      expect(item.defaultValue, `${typeId}.${fieldId} defaultValue`).toBe('89254021');
      expect(item.omitDefault, `${typeId}.${fieldId} omitDefault`).toBe(true);
    });
  });

  it('verifies that every single field across all types has an explicit role defined with zero guesswork', () => {
    const validRoles = new Set(['identifier', 'primary', 'secondary', 'action', 'policy']);
    let count = 0;
    config.types.forEach(t => {
      [...t.required, ...t.optional].forEach(f => {
        count++;
        expect(f.role, `Field ${t.id}.${f.id} must define an explicit role`).toBeDefined();
        expect(validRoles.has(f.role!), `Field ${t.id}.${f.id} has invalid role: ${f.role}`).toBe(true);
      });
    });
    expect(count).toBeGreaterThanOrEqual(200);
  });

  it('verifies that compact chips declare attachTo pointing to an existing field in the type', () => {
    config.types.forEach(t => {
      const allFieldIds = new Set([...t.required, ...t.optional].map(f => f.id));
      [...t.required, ...t.optional].forEach(f => {
        if (f.compactChip) {
          expect(f.attachTo, `Chip ${t.id}.${f.id} must declare attachTo`).toBeDefined();
          expect(allFieldIds.has(f.attachTo!), `Chip ${t.id}.${f.id} attachTo must point to a valid field`).toBe(true);
        }
      });
    });
  });

  it('verifies that grouped fields declare groupLabel', () => {
    config.types.forEach(t => {
      [...t.required, ...t.optional].forEach(f => {
        if (f.group) {
          expect(f.groupLabel, `Grouped field ${t.id}.${f.id} must declare groupLabel`).toBeDefined();
        }
      });
    });
  });
});

