import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppDialog } from '../../src/lib/dialog.js';

describe('AppDialog Component', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="dialogMount"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves true when confirm is confirmed', async () => {
    const promise = AppDialog.confirm({
      title: 'Delete Item',
      message: 'Are you sure?',
      confirmText: 'Yes, Delete',
      danger: true
    });

    const overlay = document.querySelector('.app-dialog-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Delete Item');
    expect(overlay.textContent).toContain('Are you sure?');

    const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');
    expect(confirmBtn.textContent).toBe('Yes, Delete');
    expect(confirmBtn.classList.contains('danger')).toBe(true);

    confirmBtn.click();
    const result = await promise;
    expect(result).toBe(true);
    expect(document.querySelector('.app-dialog-overlay')).toBeNull();
  });

  it('resolves false when cancel button is clicked', async () => {
    const promise = AppDialog.confirm({
      title: 'Reset Settings',
      message: 'Reset all?'
    });

    const cancelBtn = document.querySelector('.app-dialog-btn-cancel');
    cancelBtn.click();
    const result = await promise;
    expect(result).toBe(false);
    expect(document.querySelector('.app-dialog-overlay')).toBeNull();
  });

  it('resolves false when Escape key is pressed', async () => {
    const promise = AppDialog.confirm({
      title: 'Dismiss Test',
      message: 'Test escape'
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const result = await promise;
    expect(result).toBe(false);
  });

  it('resolves input value on prompt submission', async () => {
    const promise = AppDialog.prompt({
      title: 'New Label',
      message: 'Enter title:',
      defaultValue: 'Custom Vetting'
    });

    const input = document.querySelector('.app-dialog-input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('Custom Vetting');

    input.value = 'Updated Vetting';
    const confirmBtn = document.querySelector('.app-dialog-btn-confirm');
    confirmBtn.click();

    const result = await promise;
    expect(result).toBe('Updated Vetting');
  });

  it('resolves void on alert dismissal', async () => {
    const promise = AppDialog.alert({
      title: 'Notice',
      message: 'Operation completed'
    });

    const confirmBtn = document.querySelector('.app-dialog-btn-confirm');
    confirmBtn.click();

    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('renders rich professional shortcuts modal and resolves on Done', async () => {
    const promise = AppDialog.shortcuts();

    const overlay = document.querySelector('.shortcuts-dialog-overlay');
    expect(overlay).not.toBeNull();

    const title = overlay.querySelector('#shortcutsModalTitle');
    expect(title.textContent).toBe('Shortcuts');

    const searchInput = overlay.querySelector('#shortcutsSearchInput');
    expect(searchInput).not.toBeNull();

    const kbdCaps = overlay.querySelectorAll('.kbd-cap');
    expect(kbdCaps.length).toBeGreaterThan(5);

    const rows = overlay.querySelectorAll('.shortcut-row');
    expect(rows.length).toBeGreaterThan(5);

    const doneBtn = overlay.querySelector('#shortcutsDialogDone');
    expect(doneBtn).not.toBeNull();
    doneBtn.click();

    await promise;
    expect(document.querySelector('.shortcuts-dialog-overlay')).toBeNull();
  });

  it('filters shortcuts list when typing in search input', async () => {
    const promise = AppDialog.shortcuts();
    const overlay = document.querySelector('.shortcuts-dialog-overlay');
    const searchInput = overlay.querySelector('#shortcutsSearchInput') as HTMLInputElement;

    searchInput.value = 'notes';
    searchInput.dispatchEvent(new Event('input'));

    const rows = Array.from(overlay.querySelectorAll('.shortcut-row')) as HTMLElement[];
    const visibleRows = rows.filter(r => r.style.display !== 'none');
    expect(visibleRows.length).toBe(1);
    expect(visibleRows[0].textContent).toContain('Notes');

    const doneBtn = overlay.querySelector('#shortcutsDialogDone') as HTMLElement;
    doneBtn.click();
    await promise;
  });

  it('executes shortcut action on ArrowDown and Enter keydown', async () => {
    const onExecute = vi.fn();
    const promise = AppDialog.shortcuts(undefined, onExecute);
    const overlay = document.querySelector('.shortcuts-dialog-overlay');
    const searchInput = overlay.querySelector('#shortcutsSearchInput') as HTMLInputElement;

    searchInput.value = 'notes';
    searchInput.dispatchEvent(new Event('input'));

    // Press Enter to trigger the auto-highlighted first match
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await promise;
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith('toggleNotes', expect.objectContaining({ desc: 'Notes' }));
    expect(document.querySelector('.shortcuts-dialog-overlay')).toBeNull();
  });

  it('executes shortcut action when a row is clicked', async () => {
    const onExecute = vi.fn();
    const promise = AppDialog.shortcuts(undefined, onExecute);
    const overlay = document.querySelector('.shortcuts-dialog-overlay');

    const copyRow = Array.from(overlay.querySelectorAll('.shortcut-row')).find(
      r => r.textContent?.includes('Copy Vetting')
    ) as HTMLElement;
    expect(copyRow).not.toBeNull();

    copyRow.click();
    await promise;

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith('copyVetting', expect.objectContaining({ desc: 'Copy Vetting' }));
    expect(document.querySelector('.shortcuts-dialog-overlay')).toBeNull();
  });

  it('closes shortcuts modal when Escape is pressed', async () => {
    const promise = AppDialog.shortcuts();
    expect(document.querySelector('.shortcuts-dialog-overlay')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await promise;
    expect(document.querySelector('.shortcuts-dialog-overlay')).toBeNull();
  });

  it('renders structured items bullet list and footer in confirm dialog', async () => {
    const promise = AppDialog.confirm({
      title: 'Delete Linked SMS Template?',
      message: 'This SMS template is linked to the following actions:',
      items: [
        'M-PESA & Airtime Reversal (Hakikisha)',
        'PUK Retrieval (DIY PUK (*100#))'
      ],
      footer: 'Deleting it will detach these actions.',
      confirmText: 'Delete & Detach',
      danger: true
    });

    const overlay = document.querySelector('.app-dialog-overlay');
    expect(overlay).not.toBeNull();
    const list = overlay.querySelector('.app-dialog-list');
    expect(list).not.toBeNull();

    const items = list.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('M-PESA & Airtime Reversal (Hakikisha)');
    expect(items[1].textContent).toBe('PUK Retrieval (DIY PUK (*100#))');

    const footer = overlay.querySelector('.app-dialog-footer-msg');
    expect(footer).not.toBeNull();
    expect(footer.textContent).toBe('Deleting it will detach these actions.');

    const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm') as HTMLButtonElement;
    confirmBtn.click();
    const result = await promise;
    expect(result).toBe(true);
  });
});
