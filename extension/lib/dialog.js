/**
 * In-Panel Responsive Custom Dialog Manager (AppDialog)
 * Replaces window.alert, window.confirm, and window.prompt with 200px-compact,
 * accessible, theme-styled modal dialogs.
 */

import { escapeHtml } from './utils.js';

function createOverlay(type, options) {
  const overlay = document.createElement('div');
  overlay.className = 'app-dialog-overlay';

  const isPrompt = type === 'prompt';
  const isAlert = type === 'alert';
  const isDanger = Boolean(options.danger);
  const confirmText = options.confirmText || (isAlert ? (options.okText || 'OK') : 'Confirm');
  const cancelText = options.cancelText || 'Cancel';

  let iconSvg = '';
  if (isDanger) {
    iconSvg = `<svg class="app-dialog-icon danger" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`;
  } else if (isPrompt) {
    iconSvg = `<svg class="app-dialog-icon prompt" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  } else {
    iconSvg = `<svg class="app-dialog-icon info" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>`;
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

export const AppDialog = {
  confirm(options = {}) {
    return new Promise((resolve) => {
      const overlay = createOverlay('confirm', options);
      document.body.appendChild(overlay);

      const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');
      const cancelBtn = overlay.querySelector('.app-dialog-btn-cancel');

      const cleanup = (val) => {
        document.removeEventListener('keydown', onKeyDown);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(val);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          cleanup(true);
        }
      };

      document.addEventListener('keydown', onKeyDown);

      confirmBtn.addEventListener('click', () => cleanup(true));
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cleanup(false));
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          cleanup(false);
        }
      });

      if (options.danger && cancelBtn) {
        cancelBtn.focus();
      } else if (confirmBtn) {
        confirmBtn.focus();
      }
    });
  },

  alert(options = {}) {
    return new Promise((resolve) => {
      const overlay = createOverlay('alert', options);
      document.body.appendChild(overlay);

      const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve();
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          cleanup();
        }
      };

      document.addEventListener('keydown', onKeyDown);
      confirmBtn.addEventListener('click', cleanup);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
      });

      confirmBtn.focus();
    });
  },

  prompt(options = {}) {
    return new Promise((resolve) => {
      const overlay = createOverlay('prompt', options);
      document.body.appendChild(overlay);

      const input = overlay.querySelector('.app-dialog-input');
      const confirmBtn = overlay.querySelector('.app-dialog-btn-confirm');
      const cancelBtn = overlay.querySelector('.app-dialog-btn-cancel');

      const cleanup = (val) => {
        document.removeEventListener('keydown', onKeyDown);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(val);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          cleanup(input.value);
        }
      };

      document.addEventListener('keydown', onKeyDown);

      confirmBtn.addEventListener('click', () => cleanup(input.value));
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cleanup(null));
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(null);
      });

      if (input) {
        input.focus();
        input.select();
      }
    });
  },

  shortcuts(groups = DEFAULT_KEYBOARD_SHORTCUTS) {
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

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve();
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?') {
          e.preventDefault();
          e.stopPropagation();
          cleanup();
        }
      };

      document.addEventListener('keydown', onKeyDown, true);
      if (closeBtn) closeBtn.addEventListener('click', cleanup);
      if (doneBtn) doneBtn.addEventListener('click', cleanup);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
      });

      if (doneBtn) doneBtn.focus();
    });
  }
};

export const DEFAULT_KEYBOARD_SHORTCUTS = [
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

function createShortcutsOverlay(groups = DEFAULT_KEYBOARD_SHORTCUTS) {
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
          <svg class="shortcuts-header-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="6" y1="8" x2="6" y2="8" />
            <line x1="10" y1="8" x2="10" y2="8" />
            <line x1="14" y1="8" x2="14" y2="8" />
            <line x1="18" y1="8" x2="18" y2="8" />
          </svg>
          <h3 id="shortcutsModalTitle" class="shortcuts-dialog-title">Keyboard Shortcuts</h3>
        </div>
        <button type="button" class="shortcuts-dialog-close" id="shortcutsDialogClose" aria-label="Close" title="Close (Esc)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
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
