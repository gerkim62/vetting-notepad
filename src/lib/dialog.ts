/**
 * In-Panel Responsive Custom Dialog Manager (AppDialog)
 * Replaces window.alert, window.confirm, and window.prompt with 200px-compact,
 * accessible, theme-styled modal dialogs.
 */

import { escapeHtml } from './utils.js';
import { ShortcutGroup, ShortcutItem } from '../types/index.js';

export type ShortcutExecuteHandler = (action: string, item: ShortcutItem) => void;

export interface DialogOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  okText?: string;
  danger?: boolean;
}

export interface PromptOptions extends DialogOptions {
  defaultValue?: string;
  placeholder?: string;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: ShortcutGroup[] = [
  {
    category: 'Screens & Navigation',
    items: [
      { desc: 'Notes', keys: ['Alt', 'Shift', 'N'], action: 'toggleNotes' },
      { desc: 'Scratchpad', keys: ['Alt', 'Shift', 'C'], action: 'toggleCallpad' },
      { desc: 'Break Notifier', keys: ['Alt', 'Shift', 'B'], action: 'toggleBreaks' },
      { desc: 'Quick SMS', keys: ['Alt', 'Shift', 'M'], action: 'toggleQuickSms' },
      { desc: 'Settings', keys: ['Alt', 'Shift', 'S'], action: 'toggleSettings' },
      { desc: 'Toggle Preview', keys: ['Alt', 'Shift', 'P'], action: 'togglePreview' }
    ]
  },
  {
    category: 'Vetting & Actions',
    items: [
      { desc: 'Copy Vetting', keys: ['Ctrl', 'Enter'], action: 'copyVetting' },
      { desc: 'Smart Paste', keys: ['Ctrl', 'Shift', 'V'], action: 'pasteVetting' },
      { desc: 'Pass Field', keys: ['Alt', 'P'], action: 'passField' },
      { desc: 'Fail Field', keys: ['Alt', 'F'], action: 'failField' },
      { desc: 'Search Vetting', keys: ['Ctrl', 'K'], action: 'openTypeSearch' }
    ]
  },
  {
    category: 'General',
    items: [
      { desc: 'Shortcuts', keys: ['?'], action: 'showShortcuts' },
      { desc: 'Dismiss', keys: ['Esc'], action: 'handleEscape' }
    ]
  }
];

import { renderIcon } from './icons.js';

function createOverlay(type: 'confirm' | 'alert' | 'prompt', options: PromptOptions): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'app-dialog-overlay';

  const isPrompt = type === 'prompt';
  const isAlert = type === 'alert';
  const isDanger = Boolean(options.danger);
  const confirmText = options.confirmText || (isAlert ? (options.okText || 'OK') : 'Confirm');
  const cancelText = options.cancelText || 'Cancel';

  let iconSvg = '';
  if (isDanger) {
    iconSvg = renderIcon('AlertTriangle', { size: 20, class: 'app-dialog-icon danger' });
  } else if (isPrompt) {
    iconSvg = renderIcon('HelpCircle', { size: 20, class: 'app-dialog-icon prompt' });
  } else {
    iconSvg = renderIcon('Info', { size: 20, class: 'app-dialog-icon info' });
  }

  overlay.innerHTML = `
    <div class="app-dialog-card" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
      <div class="app-dialog-header">
        ${iconSvg}
        <h3 id="appDialogTitle" class="app-dialog-title">${escapeHtml(options.title || 'Notification')}</h3>
      </div>
      <div class="app-dialog-body">
        <p class="app-dialog-msg">${escapeHtml(options.message || '')}</p>
        ${isPrompt ? `
          <div class="app-dialog-input-wrap">
            <input type="text" class="app-dialog-input" value="${escapeHtml(options.defaultValue || '')}" placeholder="${escapeHtml(options.placeholder || '')}" autocomplete="off" spellcheck="false">
          </div>
        ` : ''}
      </div>
      <div class="app-dialog-actions">
        <button type="button" class="app-dialog-btn app-dialog-btn-confirm ${isDanger ? 'danger' : 'primary'}">${escapeHtml(confirmText)}</button>
        ${!isAlert ? `<button type="button" class="app-dialog-btn app-dialog-btn-cancel secondary">${escapeHtml(cancelText)}</button>` : ''}
      </div>
    </div>
  `;

  return overlay;
}

function createShortcutsOverlay(groups: ShortcutGroup[] = DEFAULT_KEYBOARD_SHORTCUTS): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'app-dialog-overlay shortcuts-dialog-overlay';

  const groupsHtml = groups.map(g => {
    const rowsHtml = g.items.map(item => {
      const keysHtml = item.keys
        .map(k => `<kbd class="kbd-cap">${escapeHtml(k)}</kbd>`)
        .join('<span class="kbd-sep">+</span>');
      return `
        <div class="shortcut-row" data-action="${escapeHtml(item.action || '')}" data-desc="${escapeHtml(item.desc.toLowerCase())}" data-keys="${escapeHtml(item.keys.join(' ').toLowerCase())}" tabindex="0" role="button" aria-label="${escapeHtml(item.desc)}">
          <span class="shortcut-desc">${escapeHtml(item.desc)}</span>
          <div class="shortcut-keys">${keysHtml}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="shortcuts-group">
        <div class="shortcuts-group-title">${escapeHtml(g.category)}</div>
        <div class="shortcuts-table">${rowsHtml}</div>
      </div>
    `;
  }).join('');

  overlay.innerHTML = `
    <div class="app-dialog-card shortcuts-dialog-card" role="dialog" aria-modal="true" aria-labelledby="shortcutsModalTitle">
      <div class="shortcuts-dialog-header">
        <div class="shortcuts-title-wrap">
          ${renderIcon('Keyboard', { size: 15, class: 'shortcuts-header-icon' })}
          <h3 id="shortcutsModalTitle" class="shortcuts-dialog-title">Shortcuts</h3>
        </div>
        <button type="button" class="shortcuts-dialog-close" id="shortcutsDialogClose" aria-label="Close" title="Close (Esc)">
          ${renderIcon('X', { size: 13 })}
        </button>
      </div>
      <div class="shortcuts-search-wrap">
        <input type="text" class="shortcuts-search-input" id="shortcutsSearchInput" placeholder="Search shortcuts..." autocomplete="off" spellcheck="false" aria-label="Search shortcuts">
      </div>
      <div class="shortcuts-dialog-body scroll-pane">
        ${groupsHtml}
        <div class="shortcuts-empty-state" id="shortcutsEmptyState" style="display:none;">No matching shortcuts</div>
      </div>
      <div class="shortcuts-dialog-footer">
        <button type="button" class="app-dialog-btn primary shortcuts-confirm-btn" id="shortcutsDialogDone">Got it</button>
      </div>
    </div>
  `;

  return overlay;
}

export const AppDialog = {
  confirm(options: DialogOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = createOverlay('confirm', options);
      document.body.appendChild(overlay);

      const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');
      const cancelBtn = overlay.querySelector('.app-dialog-btn-cancel');

      let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

      const cleanup = (val: boolean): void => {
        if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(val);
      };

      onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          cleanup(true);
        }
      };

      document.addEventListener('keydown', onKeyDown);

      if (confirmBtn instanceof HTMLElement) {
        confirmBtn.addEventListener('click', () => cleanup(true));
      }
      if (cancelBtn instanceof HTMLElement) {
        cancelBtn.addEventListener('click', () => cleanup(false));
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(false);
      });

      if (confirmBtn instanceof HTMLElement) confirmBtn.focus();
    });
  },

  alert(options: DialogOptions | string = {}): Promise<void> {
    const opts: DialogOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise((resolve) => {
      const overlay = createOverlay('alert', opts);
      document.body.appendChild(overlay);

      const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');

      let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

      const cleanup = (): void => {
        if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve();
      };

      onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          cleanup();
        }
      };

      document.addEventListener('keydown', onKeyDown);

      if (confirmBtn instanceof HTMLElement) {
        confirmBtn.addEventListener('click', cleanup);
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
      });

      if (confirmBtn instanceof HTMLElement) confirmBtn.focus();
    });
  },

  prompt(options: PromptOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = createOverlay('prompt', options);
      document.body.appendChild(overlay);

      const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');
      const cancelBtn = overlay.querySelector('.app-dialog-btn-cancel');
      const input = overlay.querySelector('.app-dialog-input');

      let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

      const cleanup = (val: string | null): void => {
        if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(val);
      };

      onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const v = input instanceof HTMLInputElement ? input.value : '';
          cleanup(v);
        }
      };

      document.addEventListener('keydown', onKeyDown);

      if (confirmBtn instanceof HTMLElement) {
        confirmBtn.addEventListener('click', () => {
          const v = input instanceof HTMLInputElement ? input.value : '';
          cleanup(v);
        });
      }
      if (cancelBtn instanceof HTMLElement) {
        cancelBtn.addEventListener('click', () => cleanup(null));
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(null);
      });

      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    });
  },

  shortcuts(
    groups: ShortcutGroup[] = DEFAULT_KEYBOARD_SHORTCUTS,
    onExecute?: ShortcutExecuteHandler
  ): Promise<void> {
    const existing = document.querySelector('.shortcuts-dialog-overlay');
    if (existing) {
      if (existing.parentNode) existing.parentNode.removeChild(existing);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const overlay = createShortcutsOverlay(groups);
      document.body.appendChild(overlay);

      const closeBtn = overlay.querySelector('#shortcutsDialogClose');
      const doneBtn = overlay.querySelector('#shortcutsDialogDone');
      const searchInput = overlay.querySelector<HTMLInputElement>('#shortcutsSearchInput');
      const emptyState = overlay.querySelector<HTMLElement>('#shortcutsEmptyState');
      const allRows = Array.from(overlay.querySelectorAll<HTMLElement>('.shortcut-row'));
      const allGroups = Array.from(overlay.querySelectorAll<HTMLElement>('.shortcuts-group'));

      let activeIndex = -1;
      let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

      const cleanup = (): void => {
        if (onKeyDown) document.removeEventListener('keydown', onKeyDown, true);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve();
      };

      const getVisibleRows = (): HTMLElement[] => {
        return allRows.filter(r => r.style.display !== 'none');
      };

      const updateActiveRow = (index: number): void => {
        const visible = getVisibleRows();
        visible.forEach((r, idx) => {
          r.classList.toggle('active', idx === index);
        });
        if (index >= 0 && index < visible.length) {
          if (typeof visible[index].scrollIntoView === 'function') {
            visible[index].scrollIntoView({ block: 'nearest' });
          }
        }
      };

      const applyFilter = (q: string): void => {
        const term = q.trim().toLowerCase();
        let totalVisible = 0;

        allGroups.forEach(group => {
          const rows = Array.from(group.querySelectorAll<HTMLElement>('.shortcut-row'));
          let groupHasVisible = false;
          rows.forEach(row => {
            const desc = row.dataset.desc || '';
            const keys = row.dataset.keys || '';
            const match = !term || desc.includes(term) || keys.includes(term);
            row.style.display = match ? 'flex' : 'none';
            if (match) {
              groupHasVisible = true;
              totalVisible++;
            }
          });
          group.style.display = groupHasVisible ? 'block' : 'none';
        });

        if (emptyState) {
          emptyState.style.display = totalVisible === 0 ? 'block' : 'none';
        }

        activeIndex = totalVisible > 0 && term ? 0 : -1;
        updateActiveRow(activeIndex);
      };

      const executeRow = (row: HTMLElement): void => {
        const action = row.dataset.action || '';
        const desc = row.querySelector('.shortcut-desc')?.textContent || '';
        let matchedItem: ShortcutItem | undefined;

        for (const g of groups) {
          const it = g.items.find(i => (action && i.action === action) || i.desc === desc);
          if (it) {
            matchedItem = it;
            break;
          }
        }

        cleanup();

        if (onExecute && matchedItem && action) {
          onExecute(action, matchedItem);
        }
      };

      onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cleanup();
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          const visible = getVisibleRows();
          if (!visible.length) return;
          activeIndex = (activeIndex + 1) % visible.length;
          updateActiveRow(activeIndex);
          return;
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const visible = getVisibleRows();
          if (!visible.length) return;
          activeIndex = activeIndex <= 0 ? visible.length - 1 : activeIndex - 1;
          updateActiveRow(activeIndex);
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const visible = getVisibleRows();
          if (activeIndex >= 0 && activeIndex < visible.length) {
            executeRow(visible[activeIndex]);
          } else if (visible.length === 1) {
            executeRow(visible[0]);
          } else {
            cleanup();
          }
          return;
        }

        // If '?' is pressed outside of an input, close
        if (e.key === '?' && document.activeElement !== searchInput) {
          e.preventDefault();
          e.stopPropagation();
          cleanup();
          return;
        }
      };

      document.addEventListener('keydown', onKeyDown, true);
      if (closeBtn instanceof HTMLElement) closeBtn.addEventListener('click', cleanup);
      if (doneBtn instanceof HTMLElement) doneBtn.addEventListener('click', cleanup);

      allRows.forEach(row => {
        row.addEventListener('click', () => {
          executeRow(row);
        });
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
      });

      if (searchInput) {
        searchInput.addEventListener('input', () => {
          applyFilter(searchInput.value);
        });
        setTimeout(() => {
          searchInput.focus();
        }, 20);
      } else if (doneBtn instanceof HTMLElement) {
        doneBtn.focus();
      }
    });
  },

  closeActive(): boolean {
    const overlay = document.querySelector('.app-dialog-overlay');
    if (overlay) {
      const cancelBtn = overlay.querySelector('.app-dialog-btn-cancel, #shortcutsDialogClose') as HTMLElement | null;
      if (cancelBtn) {
        cancelBtn.click();
      } else {
        const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm') as HTMLElement | null;
        if (confirmBtn) {
          confirmBtn.click();
        } else {
          overlay.remove();
        }
      }
      return true;
    }
    return false;
  }
};
