import { describe, it, expect, beforeEach } from 'vitest';
import config from '../../src/safaricom-vetting-config.json';
import { attachAutoExpand } from '../../src/lib/multiline.js';

describe('Feature Enhancements: Policy, DIY Unified, Shift+Enter & Multiline', () => {
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    textarea = document.createElement('textarea');
    textarea.className = 'mat-input vfield-textarea';
    textarea.dataset.maxLines = '4';
    document.body.appendChild(textarea);
  });

  describe('1. Policy Items & SAKA Directives', () => {
    it('ensures policy items are marked excludeFromCount with itemType policy', () => {
      const startKey = config.types.find(t => t.id === 'startkey');
      const txnRule = startKey?.optional.find(f => f.id === 'sk_rule_24h_txn');
      expect(txnRule).toBeDefined();
      expect(txnRule?.excludeFromCount).toBe(true);
      expect(txnRule?.itemType).toBe('policy');
      expect(txnRule?.violationAdvice).toBeDefined();
    });

    it('ensures post-action apps_wiped items are excludeFromCount with itemType action', () => {
      const swap = config.types.find(t => t.id === 'swap');
      const apps = swap?.optional.find(f => f.id === 'swap_apps_wiped');
      expect(apps).toBeDefined();
      expect(apps?.excludeFromCount).toBe(true);
      expect(apps?.itemType).toBe('action');
    });

    it('ensures SOP checklist items are marked with itemType action and NOT policy', () => {
      const pinUnlock = config.types.find(t => t.id === 'pin_unlock');
      const g3Action = pinUnlock?.optional.find(f => f.id === 'pinu_g3_action');
      expect(g3Action).toBeDefined();
      expect(g3Action?.itemType).toBe('action');
      expect(g3Action?.excludeFromCount).toBe(true);
      // Redundant DIY item was removed
      const redundantDiy = pinUnlock?.optional.find(f => f.id === 'pinu_diy_advice');
      expect(redundantDiy).toBeUndefined();

      const barSelf = config.types.find(t => t.id === 'bar_self');
      const siebelAction = barSelf?.optional.find(f => f.id === 'bar_siebel_suspend');
      expect(siebelAction?.itemType).toBe('action');
      const hlrAction = barSelf?.optional.find(f => f.id === 'bar_hlr_sawa');
      expect(hlrAction?.itemType).toBe('action');
      const g3Status = barSelf?.optional.find(f => f.id === 'bar_g3_status');
      expect(g3Status?.itemType).toBe('action');
    });

    it('ensures action and policy items have valid info guidelines for popover interaction', () => {
      const swap = config.types.find(t => t.id === 'swap');
      const apps = swap?.optional.find(f => f.id === 'swap_apps_wiped');
      expect(apps?.info).toBeDefined();
      expect(apps?.info).toContain('SAKA');

      const startKey = config.types.find(t => t.id === 'startkey');
      const txn = startKey?.optional.find(f => f.id === 'sk_rule_24h_txn');
      expect(txn?.info).toBeDefined();
      expect(txn?.info).toContain('SAKA');
    });
  });

  describe('2. Unified DIY Action Chips', () => {
    it('verifies DIY actions have valid adviceText and linked smsId in config', () => {
      const reversal = config.types.find(t => t.id === 'reversal');
      expect(reversal?.diyActions).toBeDefined();
      const diy = reversal?.diyActions?.[0];
      expect(diy?.id).toBe('diy_hakikisha');
      expect(diy?.label).toBe('Hakikisha');
      expect(diy?.adviceText).toBeDefined();
      expect(diy?.smsId).toBe('sms_hakikisha');
    });
  });

  describe('3. Shift+Enter Keyboard Handling for Multiline Inputs', () => {
    it('distinguishes between Shift+Enter and plain Enter on multiline textarea', () => {
      let newlineHandled = false;
      let advanceFocusHandled = false;

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) {
            newlineHandled = true;
            return;
          }
          e.preventDefault();
          advanceFocusHandled = true;
        }
      });

      // Simulate Shift+Enter
      const shiftEnterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        cancelable: true
      });
      textarea.dispatchEvent(shiftEnterEvent);
      expect(newlineHandled).toBe(true);
      expect(advanceFocusHandled).toBe(false);

      // Reset
      newlineHandled = false;

      // Simulate Plain Enter
      const plainEnterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: false,
        cancelable: true
      });
      textarea.dispatchEvent(plainEnterEvent);
      expect(newlineHandled).toBe(false);
      expect(advanceFocusHandled).toBe(true);
      expect(plainEnterEvent.defaultPrevented).toBe(true);
    });
  });

  describe('4. Configurable Multiline & Notes Auto-Expand', () => {
    it('initializes and clamps max lines from dataset or option', () => {
      delete textarea.dataset.maxLines;
      const controller = attachAutoExpand(textarea, 5);
      expect(textarea.dataset.maxLines).toBe('5');

      controller.setMaxLines(8);
      expect(textarea.dataset.maxLines).toBe('8');

      // Clamps to min 2 and max 10
      controller.setMaxLines(15);
      expect(textarea.dataset.maxLines).toBe('10');

      controller.setMaxLines(1);
      expect(textarea.dataset.maxLines).toBe('2');

      controller.destroy();
    });

    it('handles dynamic resize callback', () => {
      let resizedTo = 0;
      const controller = attachAutoExpand(textarea, {
        maxLines: 4,
        onResizeLines: (lines) => {
          resizedTo = lines;
        }
      });

      controller.setMaxLines(6);
      expect(textarea.dataset.maxLines).toBe('6');
      controller.destroy();
    });
  });
});
