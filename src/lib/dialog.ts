/**
 * In-Panel Responsive Custom Dialog Manager (AppDialog)
 * Replaces window.alert, window.confirm, and window.prompt with 200px-compact,
 * accessible, theme-styled modal dialogs.
 */

import { escapeHtml } from './utils.js';
import { ShortcutGroup } from '../types/index.js';

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
      { desc: 'Notes', keys: ['Alt', 'Shift', 'N'] },
      { desc: 'Scratchpad', keys: ['Alt', 'Shift', 'C'] },
      { desc: 'Break Notifier', keys: ['Alt', 'Shift', 'B'] },
      { desc: 'Quick SMS', keys: ['Alt', 'Shift', 'M'] },
      { desc: 'Settings', keys: ['Alt', 'Shift', 'S'] },
      { desc: 'Toggle Preview', keys: ['Alt', 'Shift', 'P'] }
    ]
  },
  {
    category: 'Vetting & Actions',
    items: [
      { desc: 'Copy Vetting', keys: ['Ctrl', 'Enter'] },
      { desc: 'Smart Paste', keys: ['Ctrl', 'Shift', 'V'] },
      { desc: 'Pass Field', keys: ['Alt', 'P'] },
      { desc: 'Fail Field', keys: ['Alt', 'F'] },
      { desc: 'Search Vetting', keys: ['Ctrl', 'K'] }
    ]
  },
  {
    category: 'General',
    items: [
      { desc: 'Shortcuts', keys: ['?'] },
      { desc: 'Dismiss', keys: ['Esc'] }
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
        <div class="shortcut-row">
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
          <h3 id="shortcutsModalTitle" class="shortcuts-dialog-title">Keyboard Shortcuts</h3>
        </div>
        <button type="button" class="shortcuts-dialog-close" id="shortcutsDialogClose" aria-label="Close" title="Close (Esc)">
          ${renderIcon('X', { size: 13 })}
        </button>
      </div>
      <div class="shortcuts-dialog-body scroll-pane">
        ${groupsHtml}
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

  shortcuts(groups: ShortcutGroup[] = DEFAULT_KEYBOARD_SHORTCUTS): Promise<void> {
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

      let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

      const cleanup = (): void => {
        if (onKeyDown) document.removeEventListener('keydown', onKeyDown, true);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve();
      };

      onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?') {
          e.preventDefault();
          e.stopPropagation();
          cleanup();
        }
      };

      document.addEventListener('keydown', onKeyDown, true);
      if (closeBtn instanceof HTMLElement) closeBtn.addEventListener('click', cleanup);
      if (doneBtn instanceof HTMLElement) doneBtn.addEventListener('click', cleanup);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
      });

      if (doneBtn instanceof HTMLElement) doneBtn.focus();
    });
  }
};
