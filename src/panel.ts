// @ts-nocheck
/**
 * Vetting Notepad — Chrome Extension Controller
 * Ultra-compact, fast, KISS, lightweight.
 */
import defaultConfig from './safaricom-vetting-config.json';
import { AppDialog, DEFAULT_KEYBOARD_SHORTCUTS } from './lib/dialog.js';
import {
  DEFAULT_BREAK_SCHEDULE,
  calculateBreakState,
  formatActiveBreakDisplay,
  formatTimeRange,
  formatShiftEndTime,
  parseTimeToDate
} from './lib/break-timer.js';
import { attachAutoExpand } from './lib/multiline.js';
import { escapeHtml, escapeRegExp, uid, getAppVersion } from './lib/utils.js';
import { SmartCallPad, migrateCallpadStorage } from './lib/callpad.js';
import { parseVettingText, isVettingClipboardText, parseMpesaTxnText, resolveMpesaPastedFieldValue } from './lib/parser.js';
import { initShortcuts } from './lib/shortcuts.js';
import { RichNotepad, writeDualClipboard, calculateNoteStats } from './lib/notepad.js';
import {
  buildExportPayload,
  validateImportPayload,
  exportConfiguration,
  buildDebugDiagnostics,
  exportDebugDiagnostics
} from './lib/exporter.js';
import 'quill/dist/quill.snow.css';
import './panel.css';
import type { VettingField } from './types/index.js';
import { logger } from './lib/logger.js';
import { renderIcon, initIcons } from './lib/icons.js';
import {
  getVarSuggestions,
  saveVarRecord,
  deleteVarRecord,
  isVarRemembered,
  isVarHighChurn,
  purgeVarFromHistory,
  migrateLegacyVars
} from './lib/var-history.js';

function renderBreakIcon(icon: string, size = 13): string {
  if (icon === 'coffee' || icon === '☕') return renderIcon('Coffee', { size });
  if (icon === 'utensils' || icon === 'lunch' || icon === '🍱') return renderIcon('Utensils', { size });
  if (icon === 'flag' || icon === 'done' || icon === '🏁') return renderIcon('Flag', { size });
  return renderIcon('Coffee', { size });
}

const morphTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const copyFeedbackTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const autoExpanders = new WeakMap<HTMLTextAreaElement, { adjustHeight: () => void }>();

const Storage = {
  async get(key, fallback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const res = await chrome.storage.local.get(key);
        return res[key] !== undefined ? res[key] : fallback;
      } catch (e) {
        logger.captureError('storage', e, { action: 'get', key });
        return fallback;
      }
    }
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      logger.captureError('storage', e, { action: 'get-localStorage', key });
      return fallback;
    }
  },
  async set(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ [key]: value });
        return;
      } catch (e) {
        logger.captureError('storage', e, { action: 'set', key });
      }
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      logger.captureError('storage', e, { action: 'set-localStorage', key });
    }
  },
  async setMultiple(obj) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set(obj);
        return;
      } catch (e) {
        logger.captureError('storage', e, { action: 'setMultiple' });
      }
      return;
    }
      try {
        for (const [k, v] of Object.entries(obj)) {
          localStorage.setItem(k, JSON.stringify(v));
        }
      } catch (e) {
        logger.captureError('storage', e, { action: 'setMultiple-localStorage' });
      }
    },
    async remove(key) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          await chrome.storage.local.remove(key);
        } catch (e) {
          logger.captureError('storage', e, { action: 'remove', key });
        }
        return;
      }
      try {
        localStorage.removeItem(key);
      } catch (e) {
        logger.captureError('storage', e, { action: 'remove-localStorage', key });
      }
    },
    async getMultiple(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          return await chrome.storage.local.get(keys);
        } catch (e) {
          logger.captureError('storage', e, { action: 'getMultiple', keys });
          return {};
        }
      }
      const res = {};
      for (const k of keys) {
        try {
          const v = localStorage.getItem(k);
          if (v !== null) res[k] = JSON.parse(v);
        } catch (e) {
          logger.captureError('storage', e, { action: 'getMultiple-localStorage', key: k });
        }
      }
      return res;
    }
  };

  function defaultVettingTypes() {
    return JSON.parse(JSON.stringify(defaultConfig?.types || []));
  }

  let types = [];
  let settings = { theme: 'auto', autoClear: 0 };
  let callAttempt = 1;
  let notes = [];
let activeNoteId = null;
let noteSelectComponent = null;
let typeSelectComponent = null;
let saveNotesTimer = null;

let activeTypeId = null;
let savedComments = [];
let formValues = {};
let itemStatus = {};
let previewOpen = false;
let autoClearTimer = null;
let autoClearSeconds = 0;
let clearCallpadOnClear = false;
let quickSmsSearchQuery = '';

const curType = () => types.find(t => t.id === activeTypeId) || types[0] || null;
const curComments = () => {
  const t = curType();
  if (!t) return [];
  if (!Array.isArray(t.comments)) t.comments = [];
  return t.comments;
};
const curValues = () => {
  const tId = activeTypeId || (types[0] ? types[0].id : 'default');
  return formValues[tId] || (formValues[tId] = {});
};
const curStatus = () => {
  const tId = activeTypeId || (types[0] ? types[0].id : 'default');
  return itemStatus[tId] || (itemStatus[tId] = {});
};

let fillingOrders: Record<string, string[]> = {};
const curFillingOrder = () => {
  const tId = activeTypeId || (types[0] ? types[0].id : 'default');
  return fillingOrders[tId] || (fillingOrders[tId] = []);
};
const recordFillingOrder = (id: string) => {
  if (!id) return;
  const order = curFillingOrder();
  if (!order.includes(id)) {
    order.push(id);
  }
};
const resetFillingOrder = (tId?: string) => {
  const targetId = tId || activeTypeId || (types[0] ? types[0].id : 'default');
  fillingOrders[targetId] = [];
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme;
  Storage.set('vpad.settings', settings);
}

const saveTypes = () => { Storage.setMultiple({ 'vpad.types': types, 'vpad.active': activeTypeId }); };
const saveSettings = () => { Storage.set('vpad.settings', settings); };
const saveComments = () => { saveTypes(); };

/* ==========================================================================
   Reusable CreatableSelect Component
   ========================================================================== */
class CreatableSelect {
  static n = 0;
  constructor(root, o = {}) {
    this.o = { options: [], value: null, placeholder: 'Select or type...', onChange: null, onCreate: null, ...o };
    this.opts = this.o.options.map(CreatableSelect.norm);
    this.val = this.o.value !== null ? String(this.o.value) : (this.opts[0] ? this.opts[0].value : null);
    this.q = ''; this.dirty = false; this.isOpen = false; this.idx = 0; this.items = [];
    this.id = 'cs' + (++CreatableSelect.n);
    this.root = root;
    this.renderSkeleton();
    this.sync();
  }

  static norm(x) {
    return typeof x === 'object' ? { value: String(x.value), label: String(x.label ?? x.value) } : { value: String(x), label: String(x) };
  }

  get selected() {
    return this.opts.find(o => o.value === this.val) || null;
  }

  setOptions(newOpts, newVal = null) {
    this.opts = newOpts.map(CreatableSelect.norm);
    if (newVal !== null) this.val = String(newVal);
    this.sync();
    this.render();
  }

  renderSkeleton() {
    this.root.innerHTML = `
      <div class="box">
        <input role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${this.id}-l" autocomplete="off" spellcheck="false" placeholder="${this.o.placeholder}">
        <span class="ctl">
          <button type="button" class="tog" tabindex="-1" aria-label="Toggle">
            ${renderIcon('ChevronDown', { size: 14, class: 'arrow' })}
          </button>
        </span>
      </div>
      <ul id="${this.id}-l" role="listbox"></ul>
    `;
    this.input = this.root.querySelector('input');
    this.list = this.root.querySelector('ul');
    this.box = this.root.querySelector('.box');

    this.box.addEventListener('click', () => this.open());
    this.root.querySelector('.tog').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    this.list.addEventListener('mousedown', e => e.preventDefault());
    this.list.addEventListener('click', e => {
      const li = e.target.closest('li[data-i]');
      if (li) this.pick(this.items[+li.dataset.i]);
    });

    this.input.addEventListener('focus', () => {
      this.root.classList.add('focus');
      this.input.select();
      this.sync();
    });
    this.input.addEventListener('blur', () => {
      this.root.classList.remove('focus');
      this.close();
    });
    this.input.addEventListener('input', () => {
      this.dirty = true;
      this.q = this.input.value;
      this.idx = 0;
      this.open();
      this.render();
    });
    this.input.addEventListener('keydown', e => this.key(e));
  }

  sync() {
    if (!this.dirty) {
      this.input.value = this.selected ? this.selected.label : '';
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.setAttribute('aria-expanded', 'true');
    this.render();
    this.sync();
  }

  close() {
    if (!this.isOpen && !this.dirty) return;
    this.isOpen = false;
    this.dirty = false;
    this.q = '';
    this.root.classList.remove('open');
    this.input.setAttribute('aria-expanded', 'false');
    this.sync();
  }

  hl(label) {
    const q = this.q.trim();
    if (!q) return CreatableSelect.esc(label);
    const terms = q.split(/\s+/).filter(Boolean);
    if (!terms.length) return CreatableSelect.esc(label);
    let escaped = CreatableSelect.esc(label);
    terms.forEach(term => {
      const reg = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      escaped = escaped.replace(reg, '<mark>$1</mark>');
    });
    return escaped;
  }

  static esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  render() {
    if (!this.isOpen) return;
    const q = this.q.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    this.items = this.opts.filter(o => {
      if (!terms.length) return true;
      const lbl = (o.label || '').toLowerCase();
      return terms.every(t => lbl.includes(t));
    }).map(o => ({ o }));
    const exact = this.opts.some(o => (o.label || '').toLowerCase() === q);
    if (q && !exact) {
      this.items.push({ create: this.q.trim() });
    }

    this.idx = Math.min(this.idx, Math.max(this.items.length - 1, 0));
    const tick = renderIcon('Check', { size: 13, class: 'tick' });

    this.list.innerHTML = this.items.length ? this.items.map((it, i) => it.create !== undefined
      ? `<li role="option" id="${this.id}-o${i}" data-i="${i}" class="create">+ Create “${CreatableSelect.esc(it.create)}”</li>`
      : `<li role="option" id="${this.id}-o${i}" data-i="${i}" aria-selected="${it.o.value === this.val}"><span>${this.hl(it.o.label)}</span>${tick}</li>`).join('')
      : '<li class="empty">No results</li>';

    this.paintActive(true);
  }

  paintActive(scroll) {
    this.list.querySelectorAll('li.active').forEach(l => l.classList.remove('active'));
    const el = this.list.querySelector(`li[data-i="${this.idx}"]`);
    if (el) {
      el.classList.add('active');
      this.input.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    }
  }

  pick(it) {
    if (!it) return;
    let o = it.o;
    if (it.create !== undefined) {
      o = { value: uid(), label: it.create };
      this.opts.push(o);
      this.o.onCreate?.(o);
    }
    this.val = o.value;
    this.close();
    this.sync();
    this.o.onChange?.(this.val, this);
  }

  key(e) {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!this.isOpen) return this.open();
      const n = this.items.length;
      if (!n) return;
      this.idx = (this.idx + (k === 'ArrowDown' ? 1 : -1) + n) % n;
      this.paintActive(true);
    } else if (k === 'Enter') {
      if (this.isOpen) {
        e.preventDefault();
        this.pick(this.items[this.idx]);
      }
    } else if (k === 'Escape') {
      if (this.isOpen) {
        e.preventDefault();
        this.close();
      }
    }
  }
}

/* ==========================================================================
   Static Topbar Alert Banner with Shake Effect
   ========================================================================== */
const topBanner = document.getElementById('topBanner');
const topBannerMsg = document.getElementById('topBannerMsg');
const topBannerBtn = document.getElementById('topBannerBtn');
const topBannerClose = document.getElementById('topBannerClose');
const topBannerProgress = document.getElementById('topBannerProgress');

let bannerTimer = null;
let bannerRemainingMs = 0;
let bannerTotalDurationMs = 0;
let bannerStartTime = 0;
let isBannerHovered = false;

function showBanner(message, actionLabel = null, actionCallback = null, durationMs = 3500, type = 'info') {
  if (!topBanner) return;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  bannerRemainingMs = durationMs;
  bannerTotalDurationMs = durationMs;
  bannerStartTime = Date.now();

  topBanner.className = `top-banner banner-${type}`;
  topBanner.title = message;
  topBannerMsg.textContent = message;
  topBannerMsg.title = message;

  if (actionLabel && actionCallback) {
    topBannerBtn.style.display = 'inline-block';
    topBannerBtn.textContent = actionLabel;
    topBannerBtn.onclick = (e) => {
      e.stopPropagation();
      actionCallback();
      hideBanner();
    };
  } else {
    topBannerBtn.style.display = 'none';
  }

  topBanner.style.display = 'flex';
  topBanner.style.animation = 'none';
  void topBanner.offsetWidth; // trigger reflow for smooth animation
  if (type === 'danger' || type === 'error') {
    topBanner.style.animation = 'bannerShake 0.35s ease-in-out';
  } else if (type === 'warn' || type === 'warning') {
    topBanner.style.animation = 'bannerPop 0.22s ease-out';
  } else {
    topBanner.style.animation = 'bannerSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
  }

  if (topBannerProgress) {
    if (durationMs > 0) {
      topBannerProgress.style.display = 'block';
      topBannerProgress.style.transition = 'none';
      topBannerProgress.style.transform = 'scaleX(1)';
      void topBannerProgress.offsetWidth;
      topBannerProgress.style.transition = `transform ${durationMs}ms linear`;
      topBannerProgress.style.transform = 'scaleX(0)';
    } else {
      topBannerProgress.style.display = 'none';
    }
  }

  if (durationMs > 0 && !isBannerHovered) {
    bannerTimer = setTimeout(() => {
      hideBanner();
    }, durationMs);
  }
}

function hideBanner() {
  if (!topBanner) return;
  topBanner.classList.remove('is-expanded');
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  bannerRemainingMs = 0;
  if (topBannerProgress) {
    topBannerProgress.style.transition = 'none';
    topBannerProgress.style.transform = 'scaleX(0)';
    topBannerProgress.style.display = 'none';
  }
  topBanner.style.display = 'none';
}

if (topBanner) {
  topBanner.addEventListener('mouseenter', () => {
    isBannerHovered = true;
    if (bannerTimer && bannerRemainingMs > 0) {
      const elapsed = Date.now() - bannerStartTime;
      bannerRemainingMs = Math.max(0, bannerRemainingMs - elapsed);
      clearTimeout(bannerTimer);
      bannerTimer = null;
      if (topBannerProgress && bannerTotalDurationMs > 0) {
        const remainingScale = Math.max(0, bannerRemainingMs / bannerTotalDurationMs);
        topBannerProgress.style.transition = 'none';
        topBannerProgress.style.transform = `scaleX(${remainingScale})`;
      }
    }
  });

  topBanner.addEventListener('mouseleave', () => {
    isBannerHovered = false;
    if (topBanner.style.display !== 'none' && bannerRemainingMs > 0) {
      bannerStartTime = Date.now();
      const resumeMs = Math.max(800, bannerRemainingMs);
      if (topBannerProgress) {
        void topBannerProgress.offsetWidth;
        topBannerProgress.style.transition = `transform ${resumeMs}ms linear`;
        topBannerProgress.style.transform = 'scaleX(0)';
      }
      bannerTimer = setTimeout(() => {
        hideBanner();
      }, resumeMs);
    }
  });
}

if (topBannerMsg) {
  topBannerMsg.addEventListener('click', (e) => {
    e.stopPropagation();
    topBanner?.classList.toggle('is-expanded');
  });
}

if (topBannerClose) {
  topBannerClose.onclick = () => {
    if (autoClearTimer) {
      stopAutoClear();
    } else {
      hideBanner();
    }
  };
}

// Alias for backwards compatibility
const showToast = showBanner;

let activeDiyState: Record<string, string[]> = {};

function morphButton(btn: HTMLElement | null, text: string, iconName = 'Check', type: 'success' | 'error' = 'success', durationMs = 1200) {
  if (!btn) return;
  const originalHtml = btn.dataset.origHtml || btn.innerHTML;
  btn.dataset.origHtml = originalHtml;

  btn.classList.remove('morph-success', 'morph-error');
  btn.classList.add(type === 'error' ? 'morph-error' : 'morph-success');

  const icon = renderIcon(iconName, { size: 12, strokeWidth: 2.2 });
  btn.innerHTML = `${icon}<span>${escapeHtml(text)}</span>`;

  const existingTimer = morphTimers.get(btn);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    btn.classList.remove('morph-success', 'morph-error');
    btn.innerHTML = originalHtml;
    delete btn.dataset.origHtml;
    morphTimers.delete(btn);
  }, durationMs);
  morphTimers.set(btn, timer);
}

function shakeForm() {
  if (!mainForm) return;
  mainForm.classList.remove('form-subtle-shake');
  void mainForm.offsetWidth;
  mainForm.classList.add('form-subtle-shake');
  setTimeout(() => {
    mainForm.classList.remove('form-subtle-shake');
  }, 400);
}

/* ==========================================================================
   View 360 Bio-Card Clipboard Parser
   ========================================================================== */
function parseView360Text(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;

  const labelDefs = [
    { key: 'firstName', regex: /^f?irst\s*name$/i, colonRegex: /^f?irst\s*name[:\t]\s*(.*)$/i },
    { key: 'middleName', regex: /^(?:middle|second)\s*name$/i, colonRegex: /^(?:middle|second)\s*name[:\t]\s*(.*)$/i },
    { key: 'lastName', regex: /^(?:(?:last|third)\s*name|surname)$/i, colonRegex: /^(?:(?:last|third)\s*name|surname)[:\t]\s*(.*)$/i },
    { key: 'gender', regex: /^(?:gender|sex)$/i, colonRegex: /^(?:gender|sex)[:\t]\s*(.*)$/i },
    { key: 'dob', regex: /^(?:d\.?o\.?b\.?|date\s*of\s*birth)$/i, colonRegex: /^(?:d\.?o\.?b\.?|date\s*of\s*birth)[:\t]\s*(.*)$/i },
    { key: 'docType', regex: /^(?:document\s*type|doc\s*type|id\s*type)$/i, colonRegex: /^(?:document\s*type|doc\s*type|id\s*type)[:\t]\s*(.*)$/i },
    { key: 'idNumber', regex: /^(?:id\s*number|id\s*no\.?|document\s*number)$/i, colonRegex: /^(?:id\s*number|id\s*no\.?|document\s*number)[:\t]\s*(.*)$/i },
    { key: 'ageOnNetwork', regex: /^(?:age\s*on\s*(?:the\s*)?network|tenure)$/i, colonRegex: /^(?:age\s*on\s*(?:the\s*)?network|tenure)[:\t]\s*(.*)$/i }
  ];

  const isLabel = (str) => labelDefs.some(d => d.regex.test(str) || d.colonRegex.test(str));

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const data = {};
  let matchCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check colon/tab delimiter on same line
    let foundSameLine = false;
    for (const def of labelDefs) {
      const cm = line.match(def.colonRegex);
      if (cm) {
        data[def.key] = (cm[1] || '').trim();
        matchCount++;
        foundSameLine = true;
        break;
      }
    }
    if (foundSameLine) continue;

    // Check alternating lines (label on line i, value on line i+1)
    const def = labelDefs.find(d => d.regex.test(line));
    if (def) {
      matchCount++;
      if (i + 1 < lines.length && !isLabel(lines[i + 1])) {
        data[def.key] = lines[i + 1];
        i++; // consume value line
      } else {
        data[def.key] = '';
      }
    }
  }

  // Must have matched at least one genuine View 360 label line
  if (matchCount === 0) return null;

  let yob = '';
  if (data.dob) {
    const yMatch = data.dob.match(/\b(19\d\d|20\d\d)\b/);
    if (yMatch) yob = yMatch[1];
  }

  const nameParts = [data.firstName, data.middleName, data.lastName].filter(p => p && p !== '-' && p.toLowerCase() !== 'n/a');
  const fullName = nameParts.join(' ');

  return {
    firstName: data.firstName || '',
    middleName: data.middleName || '',
    lastName: data.lastName || '',
    fullName: fullName,
    gender: data.gender || '',
    dob: data.dob || '',
    yob: yob,
    docType: data.docType || '',
    idNumber: data.idNumber || '',
    ageOnNetwork: data.ageOnNetwork || ''
  };
}

/* ==========================================================================
   Label Parser (Separates Clean Label from Reference Hint marked with //)
   ========================================================================== */
function parseLabel(raw) {
  const str = String(raw || '');
  const idx = str.indexOf('//');
  if (idx === -1) {
    return { main: str.trim(), hint: '', copy: str.trim() };
  }
  const main = str.slice(0, idx).trim();
  const hint = str.slice(idx + 2).trim();
  return { main, hint, copy: main || str.trim() };
}

/* ==========================================================================
   Build Text Output & Copy Operations
   ========================================================================== */
function getFieldRole(it: Partial<VettingField> | null | undefined): 'identifier' | 'primary' | 'secondary' | 'action' | 'policy' {
  if (!it) return 'identifier';
  return it.role || 'identifier';
}

function isVettingItem(it: Partial<VettingField> | null | undefined): boolean {
  if (!it) return false;
  if (it.isVetting !== undefined) return Boolean(it.isVetting);
  const role = getFieldRole(it);
  return role === 'primary' || role === 'secondary';
}

function isPrimaryItem(it: Partial<VettingField> | null | undefined): boolean {
  if (!it) return false;
  return getFieldRole(it) === 'primary';
}

function countSecondaryPassed(t, st, v) {
  let passed = 0;
  const seen = new Set();
  t.optional.forEach(it => {
    if (it.excludeFromCount || it.itemType === 'policy' || it.itemType === 'action') return;
    if (it.group) {
      if (seen.has(it.group)) return;
      seen.add(it.group);
      const grp = t.optional.filter(x => x.group === it.group && !x.excludeFromCount && x.itemType !== 'policy' && x.itemType !== 'action');
      if (grp.length && getGroupStatus(grp, st) === 'passed') passed++;
    } else if (getItemEffectiveStatus(it, st, v[it.id]) === 'passed') {
      passed++;
    }
  });
  return passed;
}

function getCallbackInfo(t, st, v) {
  const allItems = [...t.required, ...t.optional];
  const failedItems = allItems.filter(it => st[it.id] === 'failed');
  if (failedItems.length === 0) return { show: false };

  const policyViolated = failedItems.find(it => it.itemType === 'policy');
  if (policyViolated) {
    const directive = policyViolated.violationAdvice || policyViolated.info || 'Policy rule violated. Refer customer to Retail as per policy.';
    return { show: true, policy: true, policyDirective: directive, policyItem: policyViolated };
  }

  if (failedItems.some(it => isPrimaryItem(it))) return { show: true, primary: true };

  const minSec = t.minSecondary || 0;
  if (!minSec) {
    return { show: true, primary: false, labels: failedItems.map(it => parseLabel(it.label).copy) };
  }

  const needed = Math.max(0, minSec - countSecondaryPassed(t, st, v));
  const failedReq = failedItems.filter(it => t.required.includes(it));
  const failedSec = failedItems.filter(it => t.optional.includes(it));
  if (failedReq.length === 0 && needed === 0) return { show: false };

  const labels = [...failedReq, ...failedSec].map(it => parseLabel(it.label).copy);
  return { show: true, primary: false, labels };
}

function buildCopyText(t) {
  if (!t) return '';

  const v = curValues();
  const st = curStatus();
  const lines = [];

  const cb = getCallbackInfo(t, st, v);
  const failedItems = [...t.required, ...t.optional].filter(it => st[it.id] === 'failed');
  const isFailed = Boolean(cb.show);

  // 1. Line 1: Top Advice / Action Taken (CEE Priority)
  const manualComment = (v._comment || '').trim();
  const typeName = t.name || t.copyTitle?.replace(/ – Vetting$/i, '') || 'Vetting';

  let topAdvice = '';
  if (manualComment) {
    topAdvice = `${typeName}: ${manualComment}`;
  } else {
    const activeDiyIds = activeDiyState[t.id] || [];
    const activeDiys = (t.diyActions || []).filter(d => activeDiyIds.includes(d.id));

    if (activeDiys.length > 0) {
      const diyText = activeDiys.map(d => d.adviceText || d.label).join(' and ');
      topAdvice = `${typeName}: Processed. ${diyText}.`;
    } else if (cb.policy && cb.policyDirective) {
      topAdvice = `${typeName}: Policy restriction triggered. ${cb.policyDirective}`;
    } else if (!isFailed) {
      topAdvice = `${typeName}: Passed vetting.`;
    } else {
      if (cb.primary) {
        topAdvice = `${typeName}: Failed vetting. Referred to Retail Centre / Care Desk with original ID.`;
      } else if (callAttempt === 2) {
        topAdvice = `${typeName}: Failed vetting again. Referred to Retail Centre / Care Desk with original ID.`;
      } else if (cb.labels && cb.labels.length > 0) {
        topAdvice = `${typeName}: Failed vetting. Advised customer to confirm ${cb.labels.join(', ')} and call back.`;
      } else {
        topAdvice = `${typeName}: Failed vetting. Advised customer to confirm registration details and call back.`;
      }
    }
  }
  lines.push(topAdvice);

  // 2. Line 2: Vetting Outcome
  if (isFailed) {
    const failedNames = (cb.labels && cb.labels.length > 0) ? cb.labels : failedItems.map(it => parseLabel(it.label).copy);
    lines.push(`Vetting: Failed${failedNames.length > 0 ? ` (${failedNames.join(', ')})` : ''}`);
  } else {
    lines.push('Vetting: Passed');
  }

  // 3. Vetted Fields (Emitted in filling order, each on its own line)
  const allItems = [...t.required, ...t.optional];
  const orderList = curFillingOrder();

  const renderItemLine = (it: VettingField) => {
    if (it.itemType === 'action') {
      if (st[it.id] === 'passed' || v[it.id] === 'Done') {
        const { copy: copyLabel } = parseLabel(it.label);
        return `${copyLabel}: Done`;
      }
      return null;
    }
    if (it.itemType === 'policy') {
      if (st[it.id] === 'failed') {
        const { copy: copyLabel } = parseLabel(it.label);
        return `${copyLabel}: Violated (Policy Restriction)`;
      }
      return null;
    }
    const val = String(v[it.id] ?? '').trim();
    const isUnchangedDefault = it.defaultValue && val === it.defaultValue.trim() && !st[it.id];
    if (it.omitDefault && isUnchangedDefault) {
      return null;
    }
    const { copy: copyLabel } = parseLabel(it.label);
    if (val.length > 0) {
      let str = `${copyLabel}: ${val}`;
      if (isVettingItem(it)) {
        if (st[it.id] === 'failed') str += ' (Failed)';
        else str += ' (Passed)';
      }
      return str;
    } else if (st[it.id] === 'failed') {
      return `${copyLabel}: Failed`;
    }
    return null;
  };

  // Tier 1: Identifier / Account details at top
  const identifierItems = allItems.filter(it => getFieldRole(it) === 'identifier');
  for (const it of identifierItems) {
    const l = renderItemLine(it);
    if (l) lines.push(l);
  }

  // Tier 2: Action and policy items (actions done / DIY before vettings list)
  const actionPolicyItems = allItems.filter(it => getFieldRole(it) === 'action' || getFieldRole(it) === 'policy');
  for (const it of actionPolicyItems) {
    const l = renderItemLine(it);
    if (l) lines.push(l);
  }

  // Tier 3: Primary and secondary question items in recorded filling order
  const questionItems = allItems.filter(it => isVettingItem(it));
  const sortedQuestionItems = [...questionItems].sort((a, b) => {
    const idxA = orderList.indexOf(a.id);
    const idxB = orderList.indexOf(b.id);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return questionItems.indexOf(a) - questionItems.indexOf(b);
  });

  for (const it of sortedQuestionItems) {
    const l = renderItemLine(it);
    if (l) lines.push(l);
  }

  return lines.join('\n');
}

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    logger.warn('clipboard', 'navigator.clipboard.writeText failed, trying execCommand copy', { err });
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      logger.captureError('clipboard', e2, { action: 'execCommandCopy' });
      return false;
    }
  }
}

/* ==========================================================================
   Auto-Clear Countdown on Clear Button
   ========================================================================== */
const btnClear = document.getElementById('btnClear');
const clearBtnText = document.getElementById('clearBtnText');

function stopAutoClear() {
  const wasActive = !!autoClearTimer;
  if (autoClearTimer) {
    clearInterval(autoClearTimer);
    autoClearTimer = null;
  }
  autoClearSeconds = 0;
  btnClear.classList.remove('countdown-active');
  clearBtnText.textContent = 'Clear';
  if (wasActive) {
    hideBanner();
  }
}

function startAutoClear(typeId) {
  stopAutoClear();
  if (!settings.autoClear || settings.autoClear <= 0) return;

  autoClearSeconds = settings.autoClear;
  btnClear.classList.add('countdown-active');
  clearBtnText.textContent = `Clear (${autoClearSeconds}s)`;

  // Display top banner with countdown and Cancel button (type 'warn', non-expiring until countdown or cancel)
  showBanner(`Clearing in ${autoClearSeconds}s...`, 'Cancel', () => {
    stopAutoClear();
  }, 0, 'warn');

  autoClearTimer = setInterval(async () => {
    autoClearSeconds--;
    if (autoClearSeconds <= 0) {
      stopAutoClear();
      formValues[typeId] = {};
      itemStatus[typeId] = {};
      activeDiyState[typeId] = [];
      renderForm();
      updateCommentInput();
      syncPreview();
      showClearedFeedback();
      setTimeout(() => {
        checkClipboardForVetting(false);
      }, 350);
    } else {
      clearBtnText.textContent = `Clear (${autoClearSeconds}s)`;
      if (topBannerMsg) {
        topBannerMsg.textContent = `Clearing in ${autoClearSeconds}s...`;
      }
    }
  }, 1000);
}

btnClear.onclick = async () => {
  stopAutoClear();

  const t = curType();
  const hasContent = hasFormContent(t);

  if (!hasContent) {
    showClearedFeedback('Empty');
    setTimeout(() => {
      checkClipboardForVetting(false);
    }, 350);
    return;
  }

  const snapVal = JSON.parse(JSON.stringify(formValues));
  const snapStatus = JSON.parse(JSON.stringify(itemStatus));
  const snapAttempt = callAttempt;
  const snapDiy = JSON.parse(JSON.stringify(activeDiyState));

  formValues = {};
  itemStatus = {};
  activeDiyState = {};
  callAttempt = 1;
  resetFillingOrder();

  if (commentInput) {
    commentInput.value = '';
  }

  renderForm();
  updateCommentInput();
  syncPreview();
  showClearedFeedback('Cleared');

  let callpadCleared = false;
  if (clearCallpadOnClear && smartCallPadInstance) {
    const lines = smartCallPadInstance.getLines ? smartCallPadInstance.getLines() : [];
    if (lines.some(l => (l || '').trim().length > 0)) {
      smartCallPadInstance.clearAll();
      callpadCleared = true;
    }
  }

  const bannerMsg = callpadCleared ? 'Call & floating items cleared' : 'Call cleared';
  showBanner(bannerMsg, 'Undo', () => {
    formValues = snapVal;
    itemStatus = snapStatus;
    activeDiyState = snapDiy;
    callAttempt = snapAttempt;
    renderForm();
    updateCommentInput();
    syncPreview();
    setMiddleActionButton('clear');
  }, 4000, 'info');

  setTimeout(() => {
    checkClipboardForVetting(false);
  }, 350);
};

function showClearedFeedback(label = 'Cleared') {
  const originalHtml = btnClear.innerHTML;
  btnClear.classList.add('cleared-success');
  btnClear.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>
    <span>${label}</span>
  `;
  setTimeout(() => {
    btnClear.classList.remove('cleared-success');
    btnClear.innerHTML = originalHtml;
  }, 1200);
}

/* ==========================================================================
   Main Form Rendering (Masked Underline Slots)
   ========================================================================== */
const mainForm = document.getElementById('mainForm');

let popoverTimeout = null;

function closeInfoPopover() {
  const pop = document.getElementById('activeSakaPopover');
  if (pop) pop.remove();
  document.querySelectorAll('.mat-info-btn.active').forEach(b => b.classList.remove('active'));
}

function showInfoPopover(btn, text, label) {
  closeInfoPopover();
  if (!text) return;
  btn.classList.add('active');

  const { main: cleanTitle } = parseLabel(label);
  const pop = document.createElement('div');
  pop.className = 'saka-popover';
  pop.id = 'activeSakaPopover';
  pop.dataset.ownerBtn = btn.dataset.infoId;

  // Extract [SAKA XXXX] tag if present
  let articleTag = '';
  let cleanText = text;
  const artMatch = text.match(/^\[SAKA\s+([^\]]+)\]\s*\n?/);
  if (artMatch) {
    articleTag = artMatch[1];
    cleanText = text.slice(artMatch[0].length);
  } else {
    const t = curType();
    if (t && t.article) articleTag = t.article;
  }

  const lines = cleanText.split('\n');
  const bodyHtml = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
      return `<div class="pop-bullet"><span class="pop-dot">•</span><span>${escapeHtml(trimmed.replace(/^[•-]\s*/, ''))}</span></div>`;
    }
    return `<div class="pop-line">${escapeHtml(trimmed)}</div>`;
  }).join('');

  const articleBadge = articleTag ? `<span class="pop-article">${escapeHtml(articleTag)}</span>` : '';

  pop.innerHTML = `
    <div class="pop-header">
      <div class="pop-title-wrap">
        <span class="pop-title">
          ${renderIcon('Info', { size: 10, strokeWidth: 2.6 })}
          ${escapeHtml(cleanTitle)}
        </span>
        ${articleBadge}
      </div>
      <button type="button" class="pop-close" aria-label="Close popover">${renderIcon('X', { size: 10, strokeWidth: 2.5 })}</button>
    </div>
    <div class="pop-content">${bodyHtml}</div>
  `;

  document.body.appendChild(pop);

  const btnRect = btn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();

  let left = Math.min(Math.max(10, btnRect.left - 20), window.innerWidth - popRect.width - 10);
  let top = btnRect.bottom + 4;

  if (top + popRect.height > window.innerHeight - 8) {
    top = Math.max(8, btnRect.top - popRect.height - 4);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  pop.querySelector('.pop-close').onclick = (e) => {
    e.stopPropagation();
    closeInfoPopover();
  };

  pop.addEventListener('mouseenter', () => clearTimeout(popoverTimeout));
  pop.addEventListener('mouseleave', () => {
    popoverTimeout = setTimeout(closeInfoPopover, 300);
  });
}

function setupInfoPopovers() {
  mainForm.querySelectorAll('.mat-info-btn').forEach(btn => {
    const itemId = btn.dataset.infoId;
    const t = curType();
    if (!t) return;
    const it = [...t.required, ...t.optional].find(x => x.id === itemId);
    if (!it || !it.info) return;

    btn.addEventListener('mouseenter', () => {
      clearTimeout(popoverTimeout);
      showInfoPopover(btn, it.info, it.label);
    });

    btn.addEventListener('mouseleave', () => {
      popoverTimeout = setTimeout(() => {
        const pop = document.getElementById('activeSakaPopover');
        if (pop && !pop.matches(':hover')) {
          closeInfoPopover();
        }
      }, 300);
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pop = document.getElementById('activeSakaPopover');
      if (pop && pop.dataset.ownerBtn === itemId) {
        closeInfoPopover();
      } else {
        showInfoPopover(btn, it.info, it.label);
      }
    });
  });
}

function getItemEffectiveStatus(it, st, val) {
  if (!it) return null;
  if (st[it.id] === 'failed') return 'failed';
  if (val !== undefined && val !== null && String(val).trim().length > 0) return 'passed';
  return null;
}

function getGroupStatus(grpItems, st) {
  if (!grpItems || grpItems.length === 0) return null;
  const v = curValues();
  const statuses = grpItems.map(it => getItemEffectiveStatus(it, st, v[it.id]));
  if (statuses.some(s => s === 'failed')) return 'failed';
  if (statuses.every(s => s === 'passed')) return 'passed';
  if (statuses.some(s => s === 'passed')) return 'partial';
  return null;
}

function updateTiedGroupBrackets() {
  const t = curType();
  if (!t) return;
  const st = curStatus();
  const allItems = [...t.required, ...t.optional];

  mainForm.querySelectorAll('.tied-group-wrap').forEach(wrap => {
    const grpId = wrap.dataset.group;
    if (!grpId) return;
    const grpItems = allItems.filter(x => x.group === grpId);
    const grpStatus = getGroupStatus(grpItems, st);

    wrap.classList.remove('status-passed', 'status-partial', 'status-failed');
    if (grpStatus) {
      wrap.classList.add(`status-${grpStatus}`);
    }
  });
}

function updateSecondaryCounter() {
  const t = curType();
  const pill = document.getElementById('secCounterPill');
  if (!t || !pill) return;

  const minSec = t.minSecondary || 0;
  if (!minSec) {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = 'inline-flex';

  const st = curStatus();
  const v = curValues();
  let passedCount = 0;
  let failedCount = 0;

  const processedGroups = new Set();
  t.optional.forEach(it => {
    if (it.excludeFromCount) return;
    if (it.group) {
      if (processedGroups.has(it.group)) return;
      processedGroups.add(it.group);
      const grpItems = t.optional.filter(x => x.group === it.group && !x.excludeFromCount);
      if (!grpItems.length) return;
      const grpStatus = getGroupStatus(grpItems, st);
      if (grpStatus === 'passed') passedCount++;
      else if (grpStatus === 'failed') failedCount++;
    } else {
      const status = getItemEffectiveStatus(it, st, v[it.id]);
      if (status === 'passed') passedCount++;
      if (status === 'failed') failedCount++;
    }
  });

  pill.textContent = `${passedCount}/${minSec}${passedCount >= minSec ? ' ✓' : ''}`;
  pill.classList.toggle('met', passedCount >= minSec);
  pill.classList.toggle('partial', passedCount > 0 && passedCount < minSec);

  if (failedCount >= 5 && !pill.dataset.alerted5) {
    pill.dataset.alerted5 = 'true';
    showBanner('5 secondary questions failed (SAKA VMDA-0001). Record details and advise customer to call back or visit Retail.', null, null, 6000, 'warn');
  } else if (failedCount < 5) {
    delete pill.dataset.alerted5;
  }
}

function renderItemList(items, kind, st) {
  let html = '';
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.group) {
      const grpId = it.group;
      const grpItems = [];
      let j = i;
      while (j < items.length && items[j].group === grpId) {
        grpItems.push(items[j]);
        j++;
      }
      const grpStatus = getGroupStatus(grpItems, st);
      const statusClass = grpStatus ? ` status-${grpStatus}` : '';
      html += `<div class="tied-group-wrap${statusClass}" data-group="${escapeHtml(grpId)}">`;
      html += `<div class="tied-bracket" title="Tied group: counts as 1 secondary point"></div>`;
      html += `<div class="tied-items-col">`;
      grpItems.forEach((gIt, gIdx) => {
        html += createRowHtml(gIt, kind, i + gIdx);
      });
      html += `</div>`;
      html += `</div>`;
      i = j;
    } else {
      html += createRowHtml(it, kind, i);
      i++;
    }
  }
  return html;
}

function renderCallbackPanelHtml(t, st) {
  const cb = getCallbackInfo(t, st, curValues());
  if (!cb.show) return '';
  const failedLabels = (cb.labels || []).join(', ');

  if (cb.policy && cb.policyDirective) {
    return `<div class="saka-callback-panel primary-failed policy-violation-panel" title="Policy Rule Violation"><span class="saka-callback-body"><b class="saka-hl">[POLICY VIOLATION]</b> ${escapeHtml(cb.policyDirective)}</span></div>`;
  }

  if (cb.primary) {
    return `<div class="saka-callback-panel primary-failed" title="Personal details failed (SAKA VMDA-0001). Stop vetting. Advise customer to visit Retail Centre / Care Desk with original ID. Do not probe further account details."><span class="saka-callback-body"><b class="saka-hl">Personal failed.</b> Stop. Refer to <strong>Retail/Care Desk</strong> with ID.</span></div>`;
  }

  const isAttempt2 = callAttempt === 2;
  const bodyText = isAttempt2
    ? `<b class="saka-hl">Failed again.</b> No callback. Refer to <strong>Retail/Care Desk</strong> with ID.`
    : `Confirm <strong>${escapeHtml(failedLabels)}</strong>, then call back.`;

  return `<div class="saka-callback-panel"><button type="button" class="saka-attempt-pill ${isAttempt2 ? 'active' : ''}" id="btnToggleAttempt" title="Toggle 1st vs 2nd failure">${isAttempt2 ? '2nd' : '1st'}</button><span class="saka-callback-body">${bodyText}</span></div>`;
}

function renderCallbackPanelOnly() {
  const t = curType();
  if (!t) return;
  const existing = mainForm.querySelector('.saka-callback-panel');
  const newHtml = renderCallbackPanelHtml(t, curStatus());
  if (existing) {
    if (newHtml) {
      existing.outerHTML = newHtml;
    } else {
      existing.remove();
    }
  } else if (newHtml) {
    mainForm.insertAdjacentHTML('beforeend', newHtml);
  }
  const btnAttempt = document.getElementById('btnToggleAttempt');
  if (btnAttempt) {
    btnAttempt.onclick = () => {
      callAttempt = callAttempt === 1 ? 2 : 1;
      renderCallbackPanelOnly();
      syncPreview();
    };
  }
}

/* ==========================================================================
   Call-Wide Floating Key-Value Notepad (Call Companion)
   ========================================================================== */
const callPadFab = document.getElementById('callPadFab');
const callPadPopover = document.getElementById('callPadPopover');
const callPadOverlay = document.getElementById('callPadOverlay');
let smartCallPadInstance = null;

async function initCallPad() {
  const storedData = await Storage.getMultiple([
    'vpad.callpad_lines',
    'vpad.callpad_text',
    'vpad.callpad_freetext',
    'vpad.callpad_keys'
  ]);
  const migration = migrateCallpadStorage(storedData);
  let initialLines = migration.lines;

  if (migration.keysToRemove.length > 0) {
    for (const key of migration.keysToRemove) {
      await Storage.remove(key);
    }
    await Storage.set('vpad.callpad_lines', initialLines);
  }

  const savedWrap = Boolean(await Storage.get('vpad.callpad_wrap', false));

  const savedPos = await Storage.get('vpad.callpad_pos', null);
  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    applyFabPosition(savedPos.x, savedPos.y);
  }

  if (callPadPopover) {
    smartCallPadInstance = new SmartCallPad({
      container: callPadPopover,
      initialLines,
      initialWrap: savedWrap,
      onSave: (lines) => {
        Storage.set('vpad.callpad_lines', lines);
      },
      onSaveWrap: (wrap) => {
        Storage.set('vpad.callpad_wrap', wrap);
      },
      onCopy: async (text) => {
        return writeToClipboard(text);
      }
    });
  }

  initCallPadFabDrag();

  if (callPadOverlay) callPadOverlay.onclick = closeCallPad;
}

function openCallPad() {
  if (callPadPopover) {
    callPadPopover.classList.add('open');
    callPadPopover.style.display = 'flex';
  }
  if (callPadOverlay) callPadOverlay.style.display = 'block';
  if (smartCallPadInstance) {
    smartCallPadInstance.focusEnd();
  }
}

function closeCallPad() {
  if (callPadPopover) {
    callPadPopover.classList.remove('open');
    callPadPopover.style.display = 'none';
  }
  if (callPadOverlay) callPadOverlay.style.display = 'none';
}

function toggleCallPad() {
  if (callPadPopover && (callPadPopover.classList.contains('open') || callPadPopover.style.display !== 'none')) {
    closeCallPad();
  } else {
    openCallPad();
  }
}

function applyFabPosition(x, y) {
  if (!callPadFab) return;
  const app = document.getElementById('app') || document.body;
  const rect = app.getBoundingClientRect();
  const maxX = Math.max(10, rect.width - 34);
  const maxY = Math.max(10, rect.height - 34);
  const clampedX = Math.max(6, Math.min(maxX, x));
  const clampedY = Math.max(6, Math.min(maxY, y));
  callPadFab.style.left = `${clampedX}px`;
  callPadFab.style.top = `${clampedY}px`;
  callPadFab.style.right = 'auto';
  callPadFab.style.bottom = 'auto';
}

function initCallPadFabDrag() {
  if (!callPadFab) return;
  let isDragging = false;
  let hasMoved = false;
  let startX = 0, startY = 0;
  let origLeft = 0, origTop = 0;

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    const dx = clientX - startX;
    const dy = clientY - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
      if (e.cancelable) e.preventDefault();
      applyFabPosition(origLeft + dx, origTop + dy);
    }
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    callPadFab.classList.remove('is-dragging');
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    window.removeEventListener('touchmove', onPointerMove);
    window.removeEventListener('touchend', onPointerUp);

    if (hasMoved) {
      const appRect = (document.getElementById('app') || document.body).getBoundingClientRect();
      const rect = callPadFab.getBoundingClientRect();
      Storage.set('vpad.callpad_pos', {
        x: rect.left - appRect.left,
        y: rect.top - appRect.top
      });
      setTimeout(() => { hasMoved = false; }, 50);
    }
  };

  const onPointerDown = (e) => {
    isDragging = true;
    hasMoved = false;
    callPadFab.classList.add('is-dragging');
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    startX = clientX;
    startY = clientY;

    const rect = callPadFab.getBoundingClientRect();
    const appRect = (document.getElementById('app') || document.body).getBoundingClientRect();
    origLeft = rect.left - appRect.left;
    origTop = rect.top - appRect.top;

    window.addEventListener('mousemove', onPointerMove, { passive: false });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  };

  callPadFab.addEventListener('mousedown', onPointerDown);
  callPadFab.addEventListener('touchstart', onPointerDown, { passive: false });
  callPadFab.addEventListener('click', () => {
    if (hasMoved) {
      hasMoved = false;
      return;
    }
    toggleCallPad();
  });
}

function switchToType(targetId) {
  activeTypeId = targetId;
  if (typeSelectComponent) {
    typeSelectComponent.val = targetId;
    typeSelectComponent.sync();
  }
  Storage.set('vpad.active', targetId);
  renderForm();
  updateCommentInput();
  const emptyInp = mainForm.querySelector('.mat-input:not([value]), .mat-input[value=""]');
  if (emptyInp) emptyInp.focus();
}

function renderForm() {
  const t = curType();
  if (!t) {
    mainForm.innerHTML = '<div style="padding:24px 16px;text-align:center;color:var(--text-muted);font-size:11px;">No vetting type selected</div>';
    syncPreview();
    return;
  }
  const st = curStatus();

  let html = '';

  html += renderItemList(t.required, 'mandatory', st);

  if (t.optional.length > 0) {
    const minSec = t.minSecondary || 0;
    const dividerTitle = 'Secondary';
    const pillHtml = minSec > 0 ? `<span class="sec-counter-pill" id="secCounterPill">0/${minSec}</span>` : '';
    html += `
      <div class="subtle-divider">
        <span class="subtle-divider-title">${dividerTitle}</span>
        ${pillHtml}
      </div>
    `;
    html += renderItemList(t.optional, 'optional', st);
  }

  html += renderCallbackPanelHtml(t, st);

  mainForm.innerHTML = html;
  bindFormEvents();
  syncAllGuides();
  updateTiedGroupBrackets();
  updateSecondaryCounter();
  setupInfoPopovers();
  renderDiyChips(t);
  syncPreview();
}

function renderDiyChips(t) {
  const diyRow = document.getElementById('diyChipsRow');
  if (!diyRow) return;
  if (!t || !Array.isArray(t.diyActions) || t.diyActions.length === 0) {
    diyRow.style.display = 'none';
    diyRow.innerHTML = '';
    return;
  }

  diyRow.style.display = 'flex';
  const activeIds = activeDiyState[t.id] || [];

  diyRow.innerHTML = t.diyActions.map(diy => {
    const isActive = activeIds.includes(diy.id);
    const linkedTpl = diy.smsId ? quickSmsTemplates.find(s => s.id === diy.smsId) : null;
    return `
      <button type="button" class="diy-chip ${isActive ? 'active' : ''}" data-diy-id="${escapeHtml(diy.id)}" title="${escapeHtml(diy.adviceText || diy.label)}">
        <span class="diy-chip-icon">${isActive ? renderIcon('Check', { size: 10, strokeWidth: 2.5 }) : '+'}</span>
        <span class="diy-chip-text">${escapeHtml(diy.label)}</span>
        ${linkedTpl ? `<span class="diy-sms-badge">${renderIcon('MessageSquare', { size: 8 })} SMS</span>` : ''}
      </button>
    `;
  }).join('');

  diyRow.querySelectorAll<HTMLElement>('.diy-chip').forEach(chipEl => {
    chipEl.onclick = async (e) => {
      e.stopPropagation();
      const diyId = chipEl.dataset.diyId;
      if (!diyId) return;

      if (!activeDiyState[t.id]) activeDiyState[t.id] = [];
      const idx = activeDiyState[t.id].indexOf(diyId);
      const isCurrentlyActive = idx !== -1;

      if (isCurrentlyActive) {
        // Deselect: remove from state, do not copy
        activeDiyState[t.id].splice(idx, 1);
        renderDiyChips(t);
        syncPreview();
        return;
      }

      // Select: add to state
      activeDiyState[t.id].push(diyId);
      renderDiyChips(t);
      syncPreview();

      const diy = t.diyActions?.find(d => d.id === diyId);
      if (!diy || !diy.smsId) return;

      const foundTpl = quickSmsTemplates.find(s => s.id === diy.smsId);
      if (!foundTpl || !foundTpl.text) return;

      let smsText = foundTpl.text;
      const v = curValues();
      const allItems = [...t.required, ...t.optional];
      for (const it of allItems) {
        const val = (v[it.id] || '').trim();
        if (val) {
          const { copy: copyLabel } = parseLabel(it.label);
          smsText = smsText.replace(new RegExp(`\\{${escapeRegExp(copyLabel)}\\}`, 'gi'), val);
          smsText = smsText.replace(new RegExp(`\\{${escapeRegExp(it.label)}\\}`, 'gi'), val);
        }
      }

      const remainingVars = parseTemplateVariables(smsText);
      if (remainingVars.length > 0) {
        openVarFillModal(foundTpl, 'sms');
      } else {
        await writeToClipboard(smsText);
        const updatedChip = diyRow.querySelector<HTMLElement>(`.diy-chip[data-diy-id="${diyId}"]`);
        if (updatedChip) {
          const textEl = updatedChip.querySelector<HTMLElement>('.diy-chip-text');
          const originalLabel = textEl ? textEl.textContent : '';
          if (textEl) textEl.textContent = 'Copied! ✓';
          updatedChip.classList.remove('chip-copied');
          void updatedChip.offsetWidth;
          updatedChip.classList.add('chip-copied');
          setTimeout(() => {
            if (textEl && originalLabel) textEl.textContent = originalLabel;
            updatedChip.classList.remove('chip-copied');
          }, 1500);
        }
      }
    };
  });
}

function createRowHtml(it, kind, _idx) {
  let val = curValues()[it.id];
  const hasStatus = !!curStatus()[it.id];
  if (val === undefined || (val === '' && it.defaultValue && !hasStatus)) {
    val = it.defaultValue || '';
    curValues()[it.id] = val;
  }
  const isFilled = String(val ?? '').trim().length > 0;
  const isMandatory = kind === 'mandatory';
  const st = curStatus()[it.id] || '';
  const isExpanded = isFilled || !!st;

  let underlineHtml = '';
  if (it.len > 0) {
    let slots = '';
    for (let i = 0; i < it.len; i++) {
      slots += `<span class="slot" data-slot-idx="${i}"></span>`;
    }
    underlineHtml = `
      <div class="mat-underline-wrap">
        <div class="mat-underline-track ${st ? 'status-' + st : ''}" id="track_${it.id}">${slots}</div>
        <div class="mat-underline-rest"></div>
      </div>
    `;
  } else {
    underlineHtml = `<div class="mat-underline-continuous"></div>`;
  }

  const { main: lblMain, hint: lblHint } = parseLabel(it.label);
  const lblDisplay = lblHint
    ? `<span class="mat-label-main">${escapeHtml(lblMain)}</span> <span class="mat-label-hint">(${escapeHtml(lblHint)})</span>`
    : `<span class="mat-label-main">${escapeHtml(lblMain)}</span>`;
  const lblTitle = lblHint ? `${lblMain} (${lblHint})` : lblMain;

  const infoBtnHtml = it.info ? `
    <button type="button" class="mat-info-btn" data-info-id="${it.id}" title="SAKA Guideline" aria-label="View SAKA guidelines for ${escapeHtml(lblMain)}">
      ${renderIcon('Info', { size: 10, strokeWidth: 2.6 })}
    </button>
  ` : '';

  const isVetted = isVettingItem(it);
  const statusActionsHtml = isVetted ? `
    <div class="status-actions">
      <button type="button" class="pf-btn fail ${st === 'failed' ? 'active' : ''}" data-status-btn="failed" data-id="${it.id}" title="Mark as Failed" aria-label="Mark ${escapeHtml(lblMain)} as Failed">
        ${renderIcon('Ban', { size: 12, strokeWidth: 2.2 })}
      </button>
    </div>
  ` : `<div class="status-actions"></div>`;

  if (it.itemType === 'policy') {
    const isViolated = st === 'failed';
    return `
      <div class="item-row policy-row ${isViolated ? 'is-violated' : ''}" data-id="${it.id}">
        <div class="policy-left">
          <span class="policy-label-text" title="${escapeHtml(lblTitle)}">${lblDisplay}</span>
          ${infoBtnHtml}
        </div>
        <button type="button" class="policy-flag-btn ${isViolated ? 'active' : ''}" data-policy-flag="${it.id}" title="Toggle Rule Violation">
          ${isViolated ? renderIcon('AlertTriangle', { size: 10, strokeWidth: 2.2 }) : renderIcon('Ban', { size: 10 })}
          <span>${isViolated ? 'Violated' : 'Flag Rule'}</span>
        </button>
      </div>
    `;
  }

  if (it.itemType === 'action') {
    const isDone = st === 'passed' || val === 'Done';
    return `
      <div class="item-row action-row ${isDone ? 'is-done' : ''}" data-id="${it.id}">
        <div class="action-left">
          <span class="action-label-text" title="${escapeHtml(lblTitle)}">${lblDisplay}</span>
          ${infoBtnHtml}
        </div>
        <button type="button" class="btn-action-done ${isDone ? 'active' : ''}" data-action-id="${it.id}" title="Mark SOP action as done">
          ${isDone ? renderIcon('Check', { size: 10, strokeWidth: 2.5 }) : ''}
          <span>Done</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="item-row ${kind}" data-id="${it.id}">
      <div class="field-container">
        <div class="material-field ${isExpanded ? 'expanded' : ''} ${isFilled ? 'has-value' : ''} ${st ? 'status-' + st : ''}">
          <label class="mat-label" for="inp_${it.id}" title="${escapeHtml(lblTitle)}">
            <span class="mat-label-text">${lblDisplay}${isMandatory ? ' <span class="req-mark" title="Required">*</span>' : ''}</span>
            ${infoBtnHtml}
          </label>
          ${it.len > 0 ? `<span class="field-counter" id="cnt_${it.id}"></span>` : ''}
          ${it.multiline
            ? `<textarea class="mat-input vfield-textarea ${it.len > 0 ? 'has-len' : ''}" id="inp_${it.id}" data-id="${it.id}" data-max-lines="${it.maxLines || 4}" rows="1" autocomplete="off" spellcheck="false">${escapeHtml(val)}</textarea>`
            : `<input type="text" class="mat-input ${it.len > 0 ? 'has-len' : ''}" id="inp_${it.id}" data-id="${it.id}" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">`}
          ${underlineHtml}
        </div>
      </div>

      ${statusActionsHtml}

      <button type="button" class="paste-btn" data-paste-id="${it.id}" title="Paste from clipboard" aria-label="Paste ${escapeHtml(lblMain)}">
        ${renderIcon('ClipboardPaste', { size: 12 })}
      </button>
    </div>
  `;
}

function syncAllGuides() {
  const t = curType();
  if (!t) return;
  const allItems = [...t.required, ...t.optional];
  allItems.forEach(it => updateRowGuide(it.id));
}

function updateRowGuide(itemId) {
  const t = curType();
  if (!t) return;
  const it = [...t.required, ...t.optional].find(x => x.id === itemId);
  if (!it) return;
  if (it.itemType === 'policy' || it.itemType === 'action') return;

  const row = mainForm.querySelector(`.item-row[data-id="${itemId}"]`);
  if (!row) return;

  const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>('.mat-input');
  const fieldBox = row.querySelector('.material-field');
  if (!input || !fieldBox) return;

  const track = row.querySelector(`#track_${itemId}`);
  const counter = row.querySelector(`#cnt_${itemId}`);

  const val = input.value;
  const n = val.length;
  const isFocused = document.activeElement === input;
  const hasStatus = !!curStatus()[itemId];

  fieldBox.classList.toggle('has-value', n > 0);
  fieldBox.classList.toggle('expanded', n > 0 || isFocused || hasStatus);

  if (track && it.len > 0) {
    const slots = track.querySelectorAll('.slot');
    slots.forEach((slot, idx) => {
      slot.classList.toggle('filled', idx < n);
      // Only highlight cursor slot if focused and not full, NEVER when empty and blurred!
      slot.classList.toggle('current', isFocused && idx === n && n < it.len);
    });

    if (counter) {
      if (n > 0) {
        counter.classList.add('visible');
        counter.textContent = `${n}/${it.len}${n === it.len ? ' ✓' : ''}`;
        counter.classList.toggle('match', n === it.len);
        counter.classList.toggle('overflow', n > it.len);
      } else {
        counter.classList.remove('visible');
        counter.textContent = '';
      }
    }
  }
}

/* ==========================================================================
   Events & Status Pass / Fail
   ========================================================================== */
function bindFormEvents() {
  mainForm.querySelectorAll('.mat-input').forEach(input => {
    const box = input.closest('.material-field');
    const id = input.dataset.id;

    input.addEventListener('focus', () => {
      box.classList.add('is-focused', 'expanded');
      updateRowGuide(id);
      const t = curType();
      const allItems = t ? [...(t.required || []), ...(t.optional || [])] : [];
      const it = allItems.find(x => x.id === id);
      if (it?.defaultValue && input.value === it.defaultValue) {
        setTimeout(() => {
          if (document.activeElement === input) {
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }, 0);
      }
    });

    input.addEventListener('paste', (e: ClipboardEvent) => {
      const pasteText = e.clipboardData?.getData('text');
      if (!pasteText) return;
      const t = curType();
      const allItems = t ? [...(t.required || []), ...(t.optional || [])] : [];
      const it = allItems.find(x => x.id === id);
      const normalized = normalizePastedValue(it, pasteText);
      if (normalized !== null) {
        e.preventDefault();
        input.value = normalized;
        curValues()[id] = normalized;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    input.addEventListener('blur', () => {
      box.classList.remove('is-focused');
      const val = input.value;
      const hasStatus = !!curStatus()[id];
      if (val.length === 0 && !hasStatus) {
        box.classList.remove('expanded');
      }
      updateRowGuide(id);
    });

    input.addEventListener('input', () => {
      stopAutoClear();
      curValues()[id] = input.value;
      if (input.value.trim().length > 0) {
        recordFillingOrder(id);
      }
      if (curStatus()[id] === 'failed' && input.value.trim().length > 0) {
        curStatus()[id] = null;
        box.classList.remove('status-failed');
        const track = input.closest('.item-row')?.querySelector('.mat-underline-track');
        if (track) track.classList.remove('status-failed');
        const failBtn = input.closest('.item-row')?.querySelector('[data-status-btn="failed"]');
        if (failBtn) failBtn.classList.remove('active');
        renderCallbackPanelOnly();
      }
      updateRowGuide(id);
      updateSecondaryCounter();
      renderCallbackPanelOnly();
      syncPreview();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (input instanceof HTMLTextAreaElement) {
          if (e.shiftKey) {
            setTimeout(() => {
              const expander = autoExpanders.get(input);
              if (expander) expander.adjustHeight();
              else {
                input.style.height = 'auto';
                input.style.height = input.scrollHeight + 'px';
              }
            }, 0);
            return;
          }
        }
        e.preventDefault();
        const inputs = [...mainForm.querySelectorAll('.mat-input')];
        const nextIdx = inputs.indexOf(input) + 1;
        if (nextIdx < inputs.length) {
          inputs[nextIdx].focus();
        } else {
          document.getElementById('commentInput').focus();
        }
      }
    });
  });

  mainForm.querySelectorAll<HTMLTextAreaElement>('textarea.vfield-textarea').forEach(tx => {
    const expander = attachAutoExpand(tx, tx.dataset.maxLines ? parseInt(tx.dataset.maxLines, 10) : 4);
    autoExpanders.set(tx, expander);
  });

  mainForm.querySelectorAll<HTMLElement>('[data-policy-flag]').forEach(btn => {
    btn.onclick = () => {
      stopAutoClear();
      const id = btn.dataset.policyFlag;
      if (!id) return;
      const cur = curStatus()[id];
      const newStatus = cur === 'failed' ? null : 'failed';
      curStatus()[id] = newStatus;
      if (newStatus) recordFillingOrder(id);

      const row = btn.closest('.item-row.policy-row, .item-row.policy-only');
      if (row) {
        row.classList.toggle('is-violated', newStatus === 'failed');
        btn.classList.toggle('active', newStatus === 'failed');
        btn.innerHTML = newStatus === 'failed'
          ? `${renderIcon('AlertTriangle', { size: 10, strokeWidth: 2.2 })} <span>Violated</span>`
          : `${renderIcon('Ban', { size: 10 })} <span>Flag Rule</span>`;
      }

      renderCallbackPanelOnly();
      syncPreview();
    };
  });

  mainForm.querySelectorAll<HTMLElement>('[data-action-id]').forEach(btn => {
    btn.onclick = () => {
      stopAutoClear();
      const id = btn.dataset.actionId;
      if (!id) return;
      const cur = curStatus()[id];
      const newStatus = cur === 'passed' ? null : 'passed';
      curStatus()[id] = newStatus;
      curValues()[id] = newStatus === 'passed' ? 'Done' : '';
      if (newStatus) recordFillingOrder(id);

      const row = btn.closest('.item-row.action-row');
      if (row) {
        row.classList.toggle('is-done', newStatus === 'passed');
        btn.classList.toggle('active', newStatus === 'passed');
        btn.innerHTML = newStatus === 'passed'
          ? `${renderIcon('Check', { size: 10, strokeWidth: 2.5 })} <span>Done</span>`
          : `<span>Done</span>`;
      }

      syncPreview();
    };
  });

  mainForm.querySelectorAll('[data-status-btn]').forEach(btn => {
    btn.onclick = () => {
      stopAutoClear();
      const id = btn.dataset.id;
      const cur = curStatus()[id];

      const newStatus = cur === 'failed' ? null : 'failed';
      curStatus()[id] = newStatus;
      if (newStatus) recordFillingOrder(id);

      const row = btn.closest('.item-row');
      const box = row.querySelector('.material-field');
      const track = row.querySelector('.mat-underline-track');
      const input = row.querySelector('.mat-input');

      box.classList.remove('status-passed', 'status-failed');
      if (track) track.classList.remove('status-passed', 'status-failed');

      if (newStatus) {
        box.classList.add(`status-${newStatus}`, 'expanded');
        if (track) track.classList.add(`status-${newStatus}`);
      } else {
        if (input && input.value.trim().length === 0 && document.activeElement !== input) {
          box.classList.remove('expanded');
        }
      }

      btn.classList.toggle('active', newStatus === 'failed');

      updateTiedGroupBrackets();
      updateSecondaryCounter();
      renderCallbackPanelOnly();
      syncPreview();
    };
  });

  const btnAttempt = document.getElementById('btnToggleAttempt');
  if (btnAttempt) {
    btnAttempt.onclick = () => {
      callAttempt = callAttempt === 1 ? 2 : 1;
      renderCallbackPanelOnly();
      syncPreview();
    };
  }

function normalizePastedValue(item, rawText) {
  if (!item || !rawText) return null;
  const defVal = (item.defaultValue || '').trim().replace(/[\s-]+/g, '');
  const targetLen = item.len || 0;

  if (defVal && targetLen > defVal.length) {
    const cleaned = rawText.replace(/[\s-]+/g, '');
    const isDigitsOnly = /^\d+$/.test(defVal);

    if (isDigitsOnly && /^\d+$/.test(cleaned)) {
      const remainderLen = targetLen - defVal.length;
      if (cleaned.length === remainderLen) {
        return defVal + cleaned;
      }
      for (let k = 1; k < defVal.length; k++) {
        const subPrefix = defVal.slice(k);
        if (cleaned.length === targetLen - k && cleaned.startsWith(subPrefix)) {
          return defVal.slice(0, k) + cleaned;
        }
      }
    }
    if (cleaned.length === targetLen && cleaned.startsWith(defVal)) {
      return cleaned;
    }
  }
  return null;
}

async function smartPasteField(input) {
  if (!input) return false;
  const id = input.dataset.id;
  if (!id) return false;
  try {
    const rawClipboard = await navigator.clipboard.readText();
    const t = curType();
    const allItems = t ? [...(t.required || []), ...(t.optional || [])] : [];
    const item = allItems.find(x => x.id === id);
    const parsedV360 = parseView360Text(rawClipboard);
    const parsedMpesa = parseMpesaTxnText(rawClipboard);

    let textToPaste = '';
    let showUnmappedWarning = false;
    let unmappedType = '';
    const previousVal = input.value;

    if (parsedV360) {
      const mapping = item ? item.v360 : null;
      if (mapping && parsedV360[mapping] !== undefined) {
        textToPaste = parsedV360[mapping] || '';
      } else {
        textToPaste = rawClipboard.replace(/\s*[\r\n]+\s*/g, ' ').trim();
        showUnmappedWarning = true;
        unmappedType = 'View 360';
      }
    } else if (parsedMpesa) {
      const resolved = resolveMpesaPastedFieldValue(item, parsedMpesa);
      if (resolved !== null) {
        textToPaste = resolved;
      } else {
        textToPaste = rawClipboard.replace(/\s*[\r\n]+\s*/g, ' ').trim();
        showUnmappedWarning = true;
        unmappedType = 'M-PESA statement';
      }
    } else {
      textToPaste = rawClipboard.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    }

    const normalized = normalizePastedValue(item, textToPaste);
    if (normalized !== null) {
      textToPaste = normalized;
    }

    input.value = textToPaste;
    curValues()[id] = textToPaste;
    if (textToPaste.trim().length > 0) {
      recordFillingOrder(id);
    }
    stopAutoClear();
    const box = input.closest('.material-field');
    if (box) box.classList.add('expanded');
    updateRowGuide(id);
    updateSecondaryCounter();
    syncPreview();
    input.focus();

    input.style.transition = 'background 0.2s ease';
    input.style.background = 'var(--saf-emerald-soft)';
    setTimeout(() => { input.style.background = 'transparent'; }, 400);

    if (showUnmappedWarning) {
      showBanner(
        `Pasted raw text (no ${unmappedType || 'mapping'} for this field)`,
        'Undo',
        () => {
          input.value = previousVal;
          curValues()[id] = previousVal;
          if (box && previousVal.length === 0 && !curStatus()[id]) {
            box.classList.remove('expanded');
          }
          updateRowGuide(id);
          updateSecondaryCounter();
          syncPreview();
          input.focus();
        },
        4000,
        'warn'
      );
    }
    return true;
  } catch (err) {
    logger.captureError('clipboard', err, { action: 'smartPasteField' });
    showToast('Clipboard access denied', null, null, 2500, 'warn');
    input.focus();
    return false;
  }
}

  mainForm.querySelectorAll('.paste-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.pasteId;
      const input = mainForm.querySelector(`.mat-input[data-id="${id}"]`);
      if (input) {
        const ok = await smartPasteField(input);
        if (ok) {
          const origHtml = btn.innerHTML;
          btn.classList.add('copied-success');
          btn.innerHTML = renderIcon('Check', { size: 12, strokeWidth: 2.5 });
          setTimeout(() => {
            btn.classList.remove('copied-success');
            btn.innerHTML = origHtml;
          }, 1000);
        }
      }
    };
  });
}

/* ==========================================================================
   Comment Handling & Suggestions Dropdown with Instant Deletion
   ========================================================================== */
const commentInput = document.querySelector<HTMLTextAreaElement>('#commentInput');
const commentFieldBox = document.getElementById('commentFieldBox');
const commentSuggestionsMenu = document.getElementById('commentSuggestionsMenu');
const notesLinePicker = document.getElementById('notesLinePicker');

let notesMultilineEnabled = true;
let notesMaxLinesValue = 4;

let commentInputAutoExpand: AutoExpandController | null = attachAutoExpand(commentInput, {
  maxLines: 4,
  onResizeLines: (lines) => {
    notesMaxLinesValue = lines;
    Storage.set('vpad.notes_max_lines', lines);
  }
});

function applyNotesMultilineState(isMulti: boolean, lines: number) {
  if (!commentInput) return;
  if (!isMulti) {
    if (commentInputAutoExpand) {
      commentInputAutoExpand.destroy();
      commentInputAutoExpand = null;
    }
    commentInput.rows = 1;
    commentInput.style.height = '22px';
    commentInput.style.overflowY = 'hidden';
    commentInput.style.resize = 'none';
  } else {
    commentInput.style.resize = 'vertical';
    if (!commentInputAutoExpand) {
      commentInputAutoExpand = attachAutoExpand(commentInput, {
        maxLines: lines,
        onResizeLines: (l) => {
          notesMaxLinesValue = l;
          Storage.set('vpad.notes_max_lines', l);
        }
      });
    } else {
      commentInputAutoExpand.setMaxLines(lines);
    }
    commentInputAutoExpand.adjustHeight();
  }
}

async function loadNotesSettings() {
  const savedMulti = await Storage.get('vpad.notes_multiline', true);
  notesMultilineEnabled = savedMulti === true || savedMulti === 'true' || savedMulti === 1;
  const savedLines = await Storage.get('vpad.notes_max_lines', 4);
  notesMaxLinesValue = parseInt(String(savedLines), 10) || 4;
  applyNotesMultilineState(notesMultilineEnabled, notesMaxLinesValue);
}

async function loadNotesMaxLines() {
  await loadNotesSettings();
}

if (commentInput && notesLinePicker) {
  commentInput.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!notesMultilineEnabled) return;
    const curLines = notesMaxLinesValue;
    notesLinePicker.querySelectorAll<HTMLElement>('.nlp-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.lines || '0', 10) === curLines);
    });
    notesLinePicker.style.display = 'flex';
  });

  document.addEventListener('click', (e) => {
    if (notesLinePicker && e.target instanceof Node && !notesLinePicker.contains(e.target) && e.target !== commentInput) {
      notesLinePicker.style.display = 'none';
    }
  });

  notesLinePicker.querySelectorAll<HTMLElement>('.nlp-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const lines = parseInt(btn.dataset.lines || '0', 10);
      if (lines) {
        notesMaxLinesValue = lines;
        Storage.set('vpad.notes_max_lines', lines);
        applyNotesMultilineState(notesMultilineEnabled, notesMaxLinesValue);
      }
      notesLinePicker.style.display = 'none';
    };
  });
}

let activeSuggestionIdx = -1;
let currentFilteredSuggestions = [];

function highlightCommentMatch(text, query) {
  if (!query) return escapeHtml(text);
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<mark style="background:none;color:var(--saf-emerald);font-weight:700;">${match}</mark>${after}`;
}

function renderCommentSuggestions(filterQuery = '') {
  if (!commentSuggestionsMenu) return;
  const q = filterQuery.trim().toLowerCase();
  const typeComments = curComments();
  currentFilteredSuggestions = q
    ? typeComments.filter(c => c.toLowerCase().includes(q))
    : [...typeComments];

  if (currentFilteredSuggestions.length === 0) {
    closeCommentSuggestions();
    return;
  }

  activeSuggestionIdx = -1;
  commentSuggestionsMenu.innerHTML = currentFilteredSuggestions.map((c, idx) => `
    <li role="option" data-idx="${idx}" data-val="${escapeHtml(c)}">
      <span class="cs-text" title="${escapeHtml(c)}">${highlightCommentMatch(c, filterQuery.trim())}</span>
      <button type="button" class="cs-del" data-del-comment="${escapeHtml(c)}" title="Remove this suggestion" aria-label="Delete ${escapeHtml(c)}">
        ${renderIcon('X', { size: 10, strokeWidth: 2.5 })}
      </button>
    </li>
  `).join('');

  commentSuggestionsMenu.classList.add('open');
}

function closeCommentSuggestions() {
  if (!commentSuggestionsMenu) return;
  commentSuggestionsMenu.classList.remove('open');
  commentSuggestionsMenu.innerHTML = '';
  activeSuggestionIdx = -1;
  currentFilteredSuggestions = [];
}

// Handle clicks inside suggestion menu (selection vs delete)
if (commentSuggestionsMenu) {
  // Use pointerdown to intercept before commentInput blur
  commentSuggestionsMenu.addEventListener('pointerdown', (e) => {
    const delBtn = e.target.closest('.cs-del');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const commentToDelete = delBtn.dataset.delComment;
      const t = curType();
      if (t && Array.isArray(t.comments)) {
        const idx = t.comments.indexOf(commentToDelete);
        if (idx !== -1) {
          t.comments.splice(idx, 1);
          saveTypes();
          renderCommentSuggestions(commentInput.value);
        }
      }
      return;
    }

    const li = e.target.closest('li[data-val]');
    if (li) {
      e.preventDefault();
      stopAutoClear();
      const val = li.dataset.val;
      commentInput.value = val;
      curValues()._comment = val;
      const hasVal = val.length > 0;
      commentFieldBox.classList.toggle('has-value', hasVal);
      commentFieldBox.classList.toggle('expanded', hasVal);
      closeCommentSuggestions();
      syncPreview();
      commentInput.focus();
    }
  });
}

// Close suggestion menu if clicking outside
document.addEventListener('pointerdown', (e) => {
  if (commentSuggestionsMenu && commentSuggestionsMenu.classList.contains('open')) {
    if (!commentFieldBox.contains(e.target) && !commentSuggestionsMenu.contains(e.target)) {
      closeCommentSuggestions();
    }
  }
});

commentInput.addEventListener('focus', () => {
  commentFieldBox.classList.add('is-focused', 'expanded');
  renderCommentSuggestions(commentInput.value);
});

commentInput.addEventListener('blur', () => {
  commentFieldBox.classList.remove('is-focused');
  if (commentInput.value.trim().length === 0) {
    commentFieldBox.classList.remove('expanded');
  }
  // Delay close to allow pointer events on menu to resolve
  setTimeout(() => {
    if (!commentSuggestionsMenu.matches(':hover')) {
      closeCommentSuggestions();
    }
  }, 120);
});

commentInput.addEventListener('input', () => {
  stopAutoClear();
  curValues()._comment = commentInput.value;
  const hasVal = commentInput.value.length > 0;
  commentFieldBox.classList.toggle('has-value', hasVal);
  commentFieldBox.classList.toggle('expanded', hasVal || document.activeElement === commentInput);
  renderCommentSuggestions(commentInput.value);
  syncPreview();
});

commentInput.addEventListener('keydown', (e) => {
  if (commentSuggestionsMenu && commentSuggestionsMenu.classList.contains('open') && currentFilteredSuggestions.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSuggestionIdx = (activeSuggestionIdx + 1) % currentFilteredSuggestions.length;
      updateSuggestionHighlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSuggestionIdx = (activeSuggestionIdx - 1 + currentFilteredSuggestions.length) % currentFilteredSuggestions.length;
      updateSuggestionHighlight();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommentSuggestions();
      return;
    }
    if (e.key === 'Enter') {
      if (activeSuggestionIdx >= 0 && activeSuggestionIdx < currentFilteredSuggestions.length) {
        e.preventDefault();
        stopAutoClear();
        const selectedVal = currentFilteredSuggestions[activeSuggestionIdx];
        commentInput.value = selectedVal;
        curValues()._comment = selectedVal;
        const hasVal = selectedVal.length > 0;
        commentFieldBox.classList.toggle('has-value', hasVal);
        commentFieldBox.classList.toggle('expanded', hasVal);
        closeCommentSuggestions();
        syncPreview();
        return;
      }
    }
  }

  if (e.key === 'Enter') {
    if (e.shiftKey && notesMultilineEnabled) {
      setTimeout(() => {
        if (commentInputAutoExpand) commentInputAutoExpand.adjustHeight();
      }, 0);
      return;
    }
    e.preventDefault();
    closeCommentSuggestions();
    doCopy();
  }
});

function updateSuggestionHighlight() {
  if (!commentSuggestionsMenu) return;
  const items = commentSuggestionsMenu.querySelectorAll('li[data-idx]');
  items.forEach((item, idx) => {
    if (idx === activeSuggestionIdx) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function updateCommentInput() {
  const v = curValues()._comment || '';
  commentInput.value = v;
  const hasVal = v.length > 0;
  commentFieldBox.classList.toggle('has-value', hasVal);
  commentFieldBox.classList.toggle('expanded', hasVal || document.activeElement === commentInput);
  if (commentInputAutoExpand) commentInputAutoExpand.adjustHeight();
  closeCommentSuggestions();
}

/* ==========================================================================
   Preview & Actions
   ========================================================================== */
const previewDrawer = document.getElementById('previewDrawer');
const previewText = document.getElementById('previewText');
const btnTogglePreview = document.getElementById('btnTogglePreview');

btnTogglePreview.onclick = () => {
  previewOpen = !previewOpen;
  btnTogglePreview.classList.toggle('active', previewOpen);
  previewDrawer.classList.toggle('open', previewOpen);
  syncPreview();
};

function syncPreview() {
  const txt = buildCopyText(curType());
  if (txt) {
    previewText.textContent = txt;
    previewText.classList.remove('empty');
  } else {
    previewText.textContent = 'Nothing filled in yet';
    previewText.classList.add('empty');
  }
  updateMiddleActionButton();
}

const btnCopy = document.getElementById('btnCopy');

function hasFormContent(t) {
  if (!t) return false;
  const v = curValues();
  const st = curStatus();
  const allItems = [...(t.required || []), ...(t.optional || [])];
  const itemMap = new Map(allItems.map(it => [it.id, it]));

  const hasValues = Object.entries(v).some(([k, val]) => {
    if (k === '_comment' || val === undefined || val === null || String(val).trim().length === 0) return false;
    const it = itemMap.get(k);
    if (it && it.defaultValue && it.omitDefault && String(val).trim() === it.defaultValue.trim() && !st[k]) {
      return false;
    }
    return true;
  });
  const hasStatus = Object.values(st).some(Boolean);
  const hasComment = Boolean((v._comment || '').trim());
  const hasDiy = (activeDiyState[t.id] || []).length > 0;
  return hasValues || hasStatus || hasComment || hasDiy;
}

async function doCopy() {
  const t = curType();
  if (!t || !hasFormContent(t)) {
    morphButton(btnCopy, 'Empty!', 'AlertCircle', 'error', 1200);
    shakeForm();
    return;
  }

  const text = buildCopyText(t);
  if (!text) {
    morphButton(btnCopy, 'Empty!', 'AlertCircle', 'error', 1200);
    shakeForm();
    return;
  }

  const ok = await writeToClipboard(text);
  if (!ok) {
    morphButton(btnCopy, 'Failed', 'AlertCircle', 'error', 1500);
    return;
  }

  const c = (curValues()._comment || '').trim();
  if (c && t) {
    if (!Array.isArray(t.comments)) t.comments = [];
    if (!t.comments.includes(c)) {
      t.comments.unshift(c);
      if (t.comments.length > 20) t.comments.pop();
      saveTypes();
      updateCommentInput();
    }
  }

  morphButton(btnCopy, 'Copied', 'Check', 'success', 1200);

  if (t) {
    const allItems = [...(t.required || []), ...(t.optional || [])];
    const pendingActions = allItems.filter(it => it.itemType === 'action' && st[it.id] !== 'passed' && v[it.id] !== 'Done');
    if (pendingActions.length > 0) {
      const act = pendingActions[0];
      const { copy: actLabel } = parseLabel(act.label);
      showToast(
        `Action Reminder: Remember to ${actLabel.toLowerCase()} on CRM`,
        'Mark Done',
        async () => {
          st[act.id] = 'passed';
          v[act.id] = 'Done';
          recordFillingOrder(act.id);
          const actionBtn = mainForm.querySelector<HTMLElement>(`[data-action-id="${act.id}"]`);
          if (actionBtn) {
            actionBtn.classList.add('active');
            actionBtn.innerHTML = `${renderIcon('Check', { size: 10, strokeWidth: 2.5 })} <span>Done</span>`;
            const row = actionBtn.closest('.item-row.action-row');
            if (row) row.classList.add('is-done');
          }
          syncPreview();
          const updatedText = buildCopyText(t);
          await writeToClipboard(updatedText);
          showToast('Updated notes copied to clipboard!', null, null, 2500, 'info');
        },
        7000,
        'warn'
      );
    }
    startAutoClear(t.id);
  }
}
if (btnCopy) btnCopy.onclick = doCopy;

const btnPaste = document.getElementById('btnPaste');
let pasteCooldown = false;
let pasteBtnTimer: ReturnType<typeof setTimeout> | null = null;

function resetPasteBtn() {
  if (pasteBtnTimer) {
    clearTimeout(pasteBtnTimer);
    pasteBtnTimer = null;
  }
  if (btnPaste) {
    btnPaste.classList.remove('copied-success', 'morph-success', 'morph-error');
    btnPaste.innerHTML = `${renderIcon('ClipboardPaste', { size: 12 })}<span id="pasteBtnText">Paste</span>`;
  }
}

let lastDetectedClipboardPasteable = false;

function updateMiddleActionButton(forceMode?: string) {
  if (!btnPaste || !btnClear) return;
  const wrap = btnClear.closest<HTMLElement>('.middle-action-wrap');
  const t = curType();
  const canClear = hasFormContent(t);

  if (canClear) {
    if (wrap) wrap.style.display = '';
    resetPasteBtn();
    btnPaste.style.display = 'none';
    btnPaste.classList.add('flip-hidden');
    btnPaste.classList.remove('flip-visible');
    btnClear.style.display = '';
    btnClear.classList.add('flip-visible');
    btnClear.classList.remove('flip-hidden');
    return;
  }

  const canPaste = forceMode === 'paste' || lastDetectedClipboardPasteable;
  if (canPaste) {
    if (wrap) wrap.style.display = '';
    resetPasteBtn();
    pasteCooldown = true;
    setTimeout(() => { pasteCooldown = false; }, 350);
    btnClear.style.display = 'none';
    btnClear.classList.add('flip-hidden');
    btnClear.classList.remove('flip-visible');
    btnPaste.style.display = '';
    btnPaste.classList.add('flip-visible');
    btnPaste.classList.remove('flip-hidden');
    return;
  }

  resetPasteBtn();
  btnClear.style.display = 'none';
  btnPaste.style.display = 'none';
  if (wrap) wrap.style.display = 'none';
}

function setMiddleActionButton(mode) {
  if (mode === 'paste') {
    lastDetectedClipboardPasteable = true;
  } else if (mode === 'clear') {
    lastDetectedClipboardPasteable = false;
  }
  updateMiddleActionButton(mode);
}

async function doPasteWholeVetting(clipText = null) {
  let text = clipText;
  if (!text) {
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        text = await navigator.clipboard.readText();
      } catch (err) {
        logger.captureError('clipboard', err, { action: 'doPasteWholeVetting' });
        morphButton(btnPaste, 'Denied', 'AlertCircle', 'error', 1500);
        return;
      }
    }
  }

  if (!text || !text.trim()) {
    morphButton(btnPaste, 'Empty', 'AlertCircle', 'error', 1200);
    return;
  }

  const parsed = parseVettingText(text, types, activeTypeId);
  if (parsed.typeId && parsed.typeId !== activeTypeId) {
    switchToType(parsed.typeId);
  }

  const v = curValues();
  const st = curStatus();
  Object.assign(v, parsed.values);
  if (parsed.comment) {
    v._comment = parsed.comment;
  }
  Object.assign(st, parsed.status);

  renderForm();
  updateCommentInput();
  syncPreview();

  const count = Object.keys(parsed.values).length;
  morphButton(btnPaste, `Pasted (${count})`, 'Check', 'success', 1400);
  setTimeout(() => {
    setMiddleActionButton('clear');
  }, 1400);
}

if (btnPaste) {
  btnPaste.onclick = () => {
    if (pasteCooldown) return;
    doPasteWholeVetting();
  };
}

let lastCheckedClip = null;

async function checkClipboardForVetting(showPromptBanner = false) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      lastDetectedClipboardPasteable = false;
      updateMiddleActionButton();
      return;
    }
    const clip = await navigator.clipboard.readText();
    if (!clip || !clip.trim()) {
      lastDetectedClipboardPasteable = false;
      updateMiddleActionButton();
      return;
    }
    const isVetting = isVettingClipboardText(clip, types);
    if (isVetting) {
      lastDetectedClipboardPasteable = true;
      updateMiddleActionButton('paste');
      if (showPromptBanner && clip !== lastCheckedClip) {
        lastCheckedClip = clip;
        showBanner(
          'Vetting data on clipboard detected',
          'Paste All',
          () => {
            doPasteWholeVetting(clip);
          },
          5000,
          'info'
        );
      } else if (!showPromptBanner) {
        lastCheckedClip = clip;
      }
    } else {
      lastDetectedClipboardPasteable = false;
      updateMiddleActionButton();
    }
  } catch (e) {
    logger.captureError('clipboard', e, { action: 'checkClipboardForVetting' });
    lastDetectedClipboardPasteable = false;
    updateMiddleActionButton();
  }
}

window.addEventListener('focus', () => checkClipboardForVetting(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkClipboardForVetting(false);
});

/* ==========================================================================
   Mount CreatableSelect for Vetting Types
   ========================================================================== */
const typeSelectMount = document.getElementById('typeSelectMount');

function initTypeSelect() {
  const options = types.map(t => ({ value: t.id, label: t.name }));
  typeSelectComponent = new CreatableSelect(typeSelectMount, {
    options,
    value: activeTypeId,
    placeholder: 'Vetting type... (Ctrl+K)',
    onChange: (val) => {
      switchToType(val);
    },
    onCreate: (opt) => {
      const newTypeObj = {
        id: opt.value,
        name: opt.label,
        required: [
          { id: uid(), label: 'Full Name', len: 0 },
          { id: uid(), label: 'ID Number', len: 8 },
          { id: uid(), label: 'Line Number', len: 10 }
        ],
        optional: []
      };
      types.push(newTypeObj);
      switchToType(newTypeObj.id);
      openEditView();
    }
  });
}

function refreshTypeSelect() {
  if (typeSelectComponent) {
    const options = types.map(t => ({ value: t.id, label: t.name }));
    typeSelectComponent.setOptions(options, activeTypeId);
  }
}

/* ==========================================================================
   Edit Vetting Items Screen
   ========================================================================== */
const editView = document.getElementById('editView');
const btnEditType = document.getElementById('btnEditType');
const btnBackEdit = document.getElementById('btnBackEdit');
const editPane = document.getElementById('editPane');

if (btnEditType) {
  btnEditType.onclick = () => {
    openEditView();
  };
}
btnBackEdit.onclick = () => closeEditView();

function openEditView() {
  editView.style.display = 'flex';
  renderEditView();
}
function closeEditView() {
  editView.style.display = 'none';
  saveTypes();
  refreshTypeSelect();
  // Scrub '' entries for items that now have a defaultValue so renderForm re-applies defaults
  const t = curType();
  if (t) {
    const v = curValues();
    [...(t.required || []), ...(t.optional || [])].forEach(it => {
      if (it.defaultValue && (v[it.id] === '' || v[it.id] === undefined)) {
        delete v[it.id];
      }
    });
  }
  renderForm();
}

function renderEditView() {
  const t = curType();
  let html = `
    <div class="section-head" style="margin-top:0;">Vetting Type Name</div>
    <div class="material-field has-value" style="margin-bottom:8px;">
      <input type="text" class="mat-input" id="editTypeName" value="${escapeHtml(t.name)}" placeholder="e.g. SIM Swap">
      <div class="mat-underline-continuous" style="height:2px;background:var(--saf-emerald)"></div>
    </div>

    <div class="edit-type-meta-row">
      <span class="meta-label">Min Secondary Passes:</span>
      <input type="number" id="editMinSecondary" min="0" max="10" value="${t.minSecondary || 0}" class="el-min-sec" title="Minimum secondary questions required to pass (e.g. 2 for Enhanced Vetting)">
    </div>

    <div class="section-head">
      <span>Primary Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Use ▲▼ to Reorder</span>
    </div>
    <div id="editReqList">
      ${t.required.map((it, i) => createEditRowHtml(it, 'required', i, t.required.length, t.required)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddReq">+ Add Primary Item</button>

    <div class="section-head" style="margin-top:14px;">
      <span>Secondary Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Use ▲▼ or Alt+↑/↓ to Reorder</span>
    </div>
    <div id="editOptList">
      ${t.optional.map((it, i) => createEditRowHtml(it, 'optional', i, t.optional.length, t.optional)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddOpt">+ Add Secondary Item</button>

    <div class="section-head" style="margin-top:14px;">
      <span>DIY & Advice Actions</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Chips for Post-Vetting Guidance</span>
    </div>
    <div id="editDiyList">
      ${((t.diyActions) || []).map((diy, i) => `
        <div class="diy-editor-card" data-diy-idx="${i}">
          <div class="diy-card-header">
            <div class="diy-card-header-left">
              <span class="diy-card-pill">Action #${i + 1}</span>
              <span class="diy-card-header-title">${escapeHtml(diy.label || 'New Action')}</span>
            </div>
            <button type="button" class="ibtn btn-del-diy" data-diy-idx="${i}" title="Delete Action">
              ${renderIcon('Trash2', { size: 11 })}
            </button>
          </div>

          <div class="diy-form-field">
            <div class="diy-label-row">
              <span class="diy-label-tag">Chip Button Label</span>
            </div>
            <input type="text" class="diy-input diy-edit-label" data-diy-idx="${i}" value="${escapeHtml(diy.label)}" placeholder="e.g. Hakikisha, Lipa na M-PESA">
          </div>

          <div class="diy-form-field">
            <div class="diy-label-row">
              <span class="diy-label-tag">Siebel Advice Summary</span>
            </div>
            <input type="text" class="diy-input diy-edit-advice" data-diy-idx="${i}" value="${escapeHtml(diy.adviceText)}" placeholder="e.g. Educated customer on Hakikisha">
          </div>

          <div class="diy-form-field">
            <div class="diy-label-row">
              <span class="diy-label-tag">Linked Customer SMS</span>
            </div>
            <div class="diy-select-row">
              <div class="c-select diy-c-select-mount" data-diy-idx="${i}"></div>
              <button type="button" class="btn-edit-linked-sms" data-sms-id="${escapeHtml(diy.smsId || '')}" title="Open template in Quick SMS" ${!diy.smsId ? 'style="display:none;"' : ''}>
                ${renderIcon('ExternalLink', { size: 13 })}
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddDiy">+ Add DIY Action</button>

    <button class="btn-action" id="btnDeleteType" style="width:100%;margin-top:20px;color:var(--color-danger);border-color:var(--border-line);">
      Delete this Vetting Type
    </button>
  `;

  editPane.innerHTML = html;
  bindEditEvents();
}

function createEditRowHtml(it, kind, idx, total, list) {
  const hasRich = !!(it.article || it.info || it.v360 || it.mpesaTxn || it.defaultValue || it.excludeFromCount || it.multiline);
  const isTied = !!it.group;
  let canMoveUp = idx > 0;
  let canMoveDown = idx < total - 1;

  if (isTied && list) {
    let startIdx = idx;
    while (startIdx > 0 && list[startIdx - 1].group === it.group) startIdx--;
    let endIdx = idx;
    while (endIdx < list.length - 1 && list[endIdx + 1].group === it.group) endIdx++;
    canMoveUp = startIdx > 0;
    canMoveDown = endIdx < list.length - 1;
  }

  return `
    <div class="edit-item-group ${isTied ? 'is-tied' : ''}" data-id="${it.id}" data-kind="${kind}">
      <div class="edit-row">
        <div class="arrows-col">
          <button type="button" class="arr-btn" data-move="-1" title="Move Up (Alt+↑)" aria-label="Move Up" ${canMoveUp ? '' : 'disabled'}>▲</button>
          <button type="button" class="arr-btn" data-move="1" title="Move Down (Alt+↓)" aria-label="Move Down" ${canMoveDown ? '' : 'disabled'}>▼</button>
        </div>
        <input type="text" class="el-label" value="${escapeHtml(it.label)}" placeholder="Label // hint" title="Label name (use // for uncopied hint, e.g. Name // If 3rd Party)">
        <input type="number" class="el-len" value="${it.len || ''}" placeholder="len" title="Guide length in characters">
        <button type="button" class="ibtn btn-toggle-drawer ${hasRich ? 'has-rich' : ''}" data-drawer-btn="${it.id}" title="Details, View 360 & M-PESA mapping" aria-label="Field details">
          ${renderIcon('ChevronDown', { size: 12, class: 'drawer-chevron-icon' })}
        </button>
        <button type="button" class="ibtn btn-tie-pair ${isTied ? 'is-tied' : ''}" data-tie-id="${it.id}" title="${isTied ? 'Tied pair (counts as 1 pass). Click to unlink.' : 'Click to tie with adjacent item as 1 pass count'}" aria-label="Tie pair">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 4h-4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4"/>
            <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
            <circle cx="8" cy="16" r="1.5" fill="currentColor"/>
          </svg>
        </button>
        <button type="button" class="ibtn" data-del="true" title="Remove item" style="width:20px;height:20px;color:var(--color-danger);">
          ${renderIcon('X', { size: 11, strokeWidth: 2.5 })}
        </button>
      </div>
      <div class="edit-item-drawer" id="drawer_${it.id}" style="display:none;">
        <div class="drawer-field">
          <span class="drawer-label">View 360 Auto-fill:</span>
          <select class="el-v360">
            <option value="" ${!it.v360 ? 'selected' : ''}>-- None (Manual) --</option>
            <option value="fullName" ${it.v360 === 'fullName' ? 'selected' : ''}>Full Name (First + Middle + Last)</option>
            <option value="firstName" ${it.v360 === 'firstName' ? 'selected' : ''}>First Name</option>
            <option value="middleName" ${it.v360 === 'middleName' ? 'selected' : ''}>Second / Middle Name</option>
            <option value="lastName" ${it.v360 === 'lastName' ? 'selected' : ''}>Third / Last Name</option>
            <option value="idNumber" ${it.v360 === 'idNumber' ? 'selected' : ''}>ID Number</option>
            <option value="yob" ${it.v360 === 'yob' ? 'selected' : ''}>Year of Birth (YOB)</option>
            <option value="dob" ${it.v360 === 'dob' ? 'selected' : ''}>Date of Birth (Full D.O.B)</option>
            <option value="gender" ${it.v360 === 'gender' ? 'selected' : ''}>Gender</option>
            <option value="docType" ${it.v360 === 'docType' ? 'selected' : ''}>Document Type</option>
          </select>
        </div>
        <div class="drawer-field">
          <span class="drawer-label">M-PESA Statement Auto-fill:</span>
          <select class="el-mpesa-txn">
            <option value="" ${!it.mpesaTxn ? 'selected' : ''}>-- None (Manual) --</option>
            <option value="txn1" ${it.mpesaTxn === 'txn1' ? 'selected' : ''}>Self-Txn 1 (Compact Delimiter)</option>
            <option value="txn2" ${it.mpesaTxn === 'txn2' ? 'selected' : ''}>Self-Txn 2 (Compact Delimiter)</option>
            <option value="tid" ${it.mpesaTxn === 'tid' ? 'selected' : ''}>Transaction ID / Receipt</option>
            <option value="amount" ${it.mpesaTxn === 'amount' ? 'selected' : ''}>Amount</option>
            <option value="dateTime" ${it.mpesaTxn === 'dateTime' ? 'selected' : ''}>Date & Time</option>
            <option value="recipient" ${it.mpesaTxn === 'recipient' ? 'selected' : ''}>Recipient (Full Name & Till/Number)</option>
            <option value="recipientNumber" ${it.mpesaTxn === 'recipientNumber' ? 'selected' : ''}>Recipient Number / Till Only</option>
            <option value="recipientName" ${it.mpesaTxn === 'recipientName' ? 'selected' : ''}>Recipient Name Only</option>
            <option value="type" ${it.mpesaTxn === 'type' ? 'selected' : ''}>Transaction / Reversal Type</option>
            <option value="msisdn" ${it.mpesaTxn === 'msisdn' ? 'selected' : ''}>Calling Number / Sender MSISDN</option>
            <option value="customerName" ${it.mpesaTxn === 'customerName' ? 'selected' : ''}>Customer / Sender Name</option>
          </select>
        </div>
        <div class="drawer-field">
          <span class="drawer-label">Default Value (Pre-fill):</span>
          <input type="text" class="el-default" value="${escapeHtml(it.defaultValue || '')}" placeholder="Optional pre-filled value">
        </div>
        <div class="drawer-field drawer-field-checkbox">
          <label class="drawer-check-label">
            <input type="checkbox" class="el-omit-default" ${it.omitDefault ? 'checked' : ''}>
            <span>Omit from copy if unchanged from default</span>
          </label>
        </div>
        <div class="drawer-field">
          <span class="drawer-label">Item Type:</span>
          <select class="el-item-type">
            <option value="input" ${(!it.itemType || it.itemType === 'input') ? 'selected' : ''}>Standard Input (Text Field)</option>
            <option value="policy" ${it.itemType === 'policy' ? 'selected' : ''}>Policy Rule (Flag / Violated)</option>
            <option value="action" ${it.itemType === 'action' ? 'selected' : ''}>SOP Action (Checklist Done)</option>
          </select>
        </div>
        <div class="drawer-field el-violation-row" id="violation_row_${it.id}" style="${it.itemType === 'policy' ? '' : 'display:none;'}">
          <span class="drawer-label">Violation Directive (SAKA Referral):</span>
          <input type="text" class="el-violation-advice" value="${escapeHtml(it.violationAdvice || '')}" placeholder="e.g. Refer customer to Retail Center...">
        </div>
        <div class="drawer-field drawer-field-checkbox">
          <label class="drawer-check-label">
            <input type="checkbox" class="el-exclude-count" ${it.excludeFromCount ? 'checked' : ''}>
            <span>Exclude from Secondary Count</span>
          </label>
        </div>
        <div class="drawer-field drawer-field-checkbox">
          <label class="drawer-check-label">
            <input type="checkbox" class="el-multiline" ${it.multiline ? 'checked' : ''}>
            <span>Multiline field (expandable)</span>
          </label>
        </div>
        <div class="drawer-field el-maxlines-row" id="maxlines_row_${it.id}" style="${it.multiline ? '' : 'display:none;'}">
          <span class="drawer-label">Max Lines (auto-expand):</span>
          <input type="number" class="el-maxlines" min="2" max="10" value="${it.maxLines || 4}">
        </div>
        <div class="drawer-field">
          <span class="drawer-label">SAKA Article:</span>
          <input type="text" class="el-article" value="${escapeHtml(it.article || '')}" placeholder="e.g. VMDA-0001">
        </div>
        <div class="drawer-field">
          <span class="drawer-label">Guidelines / Popover Info:</span>
          <textarea class="el-info" rows="2" placeholder="SAKA instruction or verification rule">${escapeHtml(it.info || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

function moveItemInList(list, idx, step) {
  if (idx < 0 || idx >= list.length || !step) return false;
  const it = list[idx];
  if (it.group) {
    let startIdx = idx;
    while (startIdx > 0 && list[startIdx - 1].group === it.group) startIdx--;
    let endIdx = idx;
    while (endIdx < list.length - 1 && list[endIdx + 1].group === it.group) endIdx++;

    if (step < 0) {
      if (startIdx <= 0) return false;
      const prevItem = list.splice(startIdx - 1, 1)[0];
      list.splice(endIdx, 0, prevItem);
      return true;
    } else if (step > 0) {
      if (endIdx >= list.length - 1) return false;
      const nextItem = list.splice(endIdx + 1, 1)[0];
      list.splice(startIdx, 0, nextItem);
      return true;
    }
  } else {
    const targetIdx = idx + step;
    if (targetIdx >= 0 && targetIdx < list.length) {
      [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
      return true;
    }
  }
  return false;
}

function bindEditEvents() {
  const t = curType();
  const nameInput = document.getElementById('editTypeName');
  if (nameInput) {
    nameInput.oninput = () => {
      t.name = nameInput.value || 'Untitled';
      saveTypes();
      refreshTypeSelect();
    };
  }

  const minSecInput = document.getElementById('editMinSecondary');
  if (minSecInput) {
    minSecInput.oninput = () => {
      t.minSecondary = Math.max(0, parseInt(minSecInput.value, 10) || 0);
      saveTypes();
    };
  }

  editPane.onclick = async (e) => {
    const drawerBtn = e.target.closest('[data-drawer-btn]');
    if (drawerBtn) {
      const id = drawerBtn.dataset.drawerBtn;
      const drawer = document.getElementById(`drawer_${id}`);
      if (drawer) {
        const isHidden = drawer.style.display === 'none' || !drawer.style.display;
        drawer.style.display = isHidden ? 'block' : 'none';
        drawerBtn.classList.toggle('active', isHidden);
      }
      return;
    }

    const group = e.target.closest('.edit-item-group');
    if (!group) {
      if (e.target.id === 'btnAddReq') {
        t.required.push({ id: uid(), label: 'New Required', len: 0 });
        renderEditView();
      } else if (e.target.id === 'btnAddOpt') {
        t.optional.push({ id: uid(), label: 'New Optional', len: 0 });
        renderEditView();
      } else if (e.target.id === 'btnAddDiy' || e.target.closest('#btnAddDiy')) {
        if (!Array.isArray(t.diyActions)) t.diyActions = [];
        t.diyActions.push({
          id: 'diy_' + Date.now(),
          label: 'New Action',
          adviceText: 'Educated customer on DIY self-service',
          smsId: undefined
        });
        saveTypes();
        renderEditView();
      } else if (e.target instanceof HTMLElement && e.target.closest('.btn-edit-linked-sms')) {
        const btn = e.target.closest<HTMLElement>('.btn-edit-linked-sms');
        const smsId = btn?.dataset.smsId;
        if (smsId) {
          const tpl = quickSmsTemplates.find(s => s.id === smsId);
          if (tpl) {
            if (quickSmsView) {
              quickSmsView.style.display = 'flex';
              renderQuickSmsList();
            }
            openTemplateEditModal(tpl, 'sms');
          }
        }
      } else if (e.target.closest('.btn-del-diy')) {
        const delBtn = e.target.closest('.btn-del-diy');
        const dIdx = parseInt(delBtn.dataset.diyIdx, 10);
        if (t.diyActions && t.diyActions[dIdx]) {
          t.diyActions.splice(dIdx, 1);
          saveTypes();
          renderEditView();
        }
      } else if (e.target.id === 'btnDeleteType') {
        if (types.length <= 1) {
          showToast('Cannot delete the last vetting type', null, null, 2500, 'warn');
          return;
        }
        const ok = await AppDialog.confirm({
          title: 'Delete Vetting Type',
          message: `Are you sure you want to delete "${t.name}"? This cannot be undone.`,
          confirmText: 'Delete',
          danger: true
        });
        if (ok) {
          types = types.filter(x => x.id !== t.id);
          delete formValues[t.id];
          delete itemStatus[t.id];
          activeTypeId = types[0].id;
          saveTypes();
          refreshTypeSelect();
          closeEditView();
        }
      }
      return;
    }

    const kind = group.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const itemId = group.dataset.id;
    const idx = list.findIndex(x => x.id === itemId);

    const tieBtn = e.target.closest('[data-tie-id]');
    if (tieBtn) {
      const it = list[idx];
      if (!it) return;
      if (it.group) {
        const grpId = it.group;
        list.forEach(x => {
          if (x.group === grpId) delete x.group;
        });
      } else {
        let partner = null;
        if (idx < list.length - 1) {
          partner = list[idx + 1];
        } else if (idx > 0) {
          partner = list[idx - 1];
        }
        if (partner) {
          const newGrp = 'grp_' + uid();
          it.group = newGrp;
          partner.group = newGrp;
        }
      }
      saveTypes();
      renderEditView();
      return;
    }

    if (e.target.closest('[data-del]')) {
      const it = list[idx];
      list.splice(idx, 1);
      if (it && it.group) {
        const remaining = list.filter(x => x.group === it.group);
        if (remaining.length <= 1) {
          remaining.forEach(r => delete r.group);
        }
      }
      saveTypes();
      renderEditView();
      return;
    } else if (e.target.closest('[data-move]')) {
      const step = parseInt(e.target.closest('[data-move]').dataset.move, 10);
      if (moveItemInList(list, idx, step)) {
        saveTypes();
        renderEditView();
        const newGroup = editPane.querySelector(`.edit-item-group[data-id="${itemId}"]`);
        if (newGroup) {
          const btn = newGroup.querySelector(`[data-move="${step}"]`) || newGroup.querySelector('.arr-btn');
          if (btn && !btn.disabled) btn.focus();
        }
      }
      return;
    }
  };

  // Keyboard reordering: Alt+↑ / Alt+↓ anywhere on row, plain ↑ / ↓ on arr-btn
  editPane.onkeydown = (e) => {
    const group = e.target.closest('.edit-item-group');
    if (!group) return;

    const isAltUp = e.altKey && e.key === 'ArrowUp';
    const isAltDown = e.altKey && e.key === 'ArrowDown';
    const isArrBtn = e.target.classList.contains('arr-btn');
    const isPlainUp = isArrBtn && e.key === 'ArrowUp';
    const isPlainDown = isArrBtn && e.key === 'ArrowDown';

    if (isAltUp || isAltDown || isPlainUp || isPlainDown) {
      e.preventDefault();
      const step = (isAltUp || isPlainUp) ? -1 : 1;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const itemId = group.dataset.id;
      const idx = list.findIndex(x => x.id === itemId);

      if (moveItemInList(list, idx, step)) {
        saveTypes();
        renderEditView();
        const newGroup = editPane.querySelector(`.edit-item-group[data-id="${itemId}"]`);
        if (newGroup) {
          if (isArrBtn) {
            const btn = newGroup.querySelector(`[data-move="${step}"]`) || newGroup.querySelector('.arr-btn');
            if (btn && !btn.disabled) btn.focus();
          } else {
            const cls = e.target.className.split(' ')[0];
            const el = cls ? newGroup.querySelector(`.${cls}`) : null;
            if (el) el.focus();
            else newGroup.querySelector('.el-label')?.focus();
          }
        }
      }
    }
  };

  editPane.oninput = (e: Event) => {
    if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) return;
    if (e.target.classList.contains('diy-edit-label')) {
      const dIdx = parseInt(e.target.dataset.diyIdx, 10);
      if (t.diyActions && t.diyActions[dIdx]) {
        t.diyActions[dIdx].label = e.target.value;
        saveTypes();
        const card = e.target.closest('.diy-editor-card');
        const titleEl = card?.querySelector('.diy-card-header-title');
        if (titleEl) {
          titleEl.textContent = e.target.value || 'New Action';
        }
      }
      return;
    }
    if (e.target.classList.contains('diy-edit-advice')) {
      const dIdx = parseInt(e.target.dataset.diyIdx, 10);
      if (t.diyActions && t.diyActions[dIdx]) {
        t.diyActions[dIdx].adviceText = e.target.value;
        saveTypes();
      }
      return;
    }

    const group = e.target.closest('.edit-item-group');
    if (!group) return;
    const kind = group.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const item = list.find(x => x.id === group.dataset.id);
    if (!item) return;

    if (e.target.classList.contains('el-label')) item.label = e.target.value;
    else if (e.target.classList.contains('el-len')) item.len = Math.max(0, parseInt(e.target.value, 10) || 0);
    else if (e.target.classList.contains('el-article')) {
      item.article = e.target.value.trim();
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.excludeFromCount));
    }
    else if (e.target.classList.contains('el-info')) {
      item.info = e.target.value;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360));
    }
    else if (e.target.classList.contains('el-v360')) {
      item.v360 = e.target.value || null;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.mpesaTxn || item.defaultValue));
    }
    else if (e.target.classList.contains('el-mpesa-txn')) {
      item.mpesaTxn = e.target.value || undefined;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.mpesaTxn || item.defaultValue));
    }
    else if (e.target.classList.contains('el-default')) {
      item.defaultValue = e.target.value.trim() || undefined;
      // Immediately apply to the live form value if the field hasn't been filled yet
      const liveVal = curValues()[item.id];
      if (liveVal === '' || liveVal === undefined) {
        if (item.defaultValue) curValues()[item.id] = item.defaultValue;
        else delete curValues()[item.id]; // allow createRowHtml to re-init as ''
      }
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.mpesaTxn || item.defaultValue));
    }
    saveTypes();
  };

  editPane.onchange = (e) => {
    if (e.target.classList.contains('el-v360')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      item.v360 = e.target.value || null;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.mpesaTxn || item.defaultValue));
      saveTypes();
    } else if (e.target.classList.contains('el-mpesa-txn')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      item.mpesaTxn = e.target.value || undefined;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.mpesaTxn || item.defaultValue));
      saveTypes();
    } else if (e.target.classList.contains('el-omit-default')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      item.omitDefault = e.target.checked || undefined;
      saveTypes();
    } else if (e.target.classList.contains('el-exclude-count')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      item.excludeFromCount = e.target.checked || undefined;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue || item.excludeFromCount || item.multiline));
      saveTypes();
    } else if (e.target.classList.contains('el-multiline')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      item.multiline = e.target.checked || undefined;
      const maxRow = group.querySelector(`#maxlines_row_${item.id}`);
      if (maxRow) maxRow.style.display = item.multiline ? 'flex' : 'none';
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue || item.excludeFromCount || item.multiline));
      saveTypes();
    } else if (e.target.classList.contains('el-maxlines')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      const val = parseInt(e.target.value, 10);
      item.maxLines = Math.min(Math.max(isNaN(val) ? 4 : val, 2), 10);
      e.target.value = item.maxLines;
      saveTypes();
    } else if (e.target.classList.contains('el-item-type')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      const val = e.target.value;
      item.itemType = val === 'policy' ? 'policy' : val === 'action' ? 'action' : undefined;
      if (item.itemType === 'policy' || item.itemType === 'action') {
        item.excludeFromCount = true;
      }
      const violRow = group.querySelector<HTMLElement>(`#violation_row_${item.id}`);
      if (violRow) violRow.style.display = item.itemType === 'policy' ? 'flex' : 'none';
      const exclCountBox = group.querySelector<HTMLInputElement>('.el-exclude-count');
      if (exclCountBox && item.excludeFromCount) exclCountBox.checked = true;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue || item.excludeFromCount || item.multiline || item.itemType));
      saveTypes();
    } else if (e.target.classList.contains('el-violation-advice')) {
      const group = e.target.closest('.edit-item-group');
      if (!group) return;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const item = list.find(x => x.id === group.dataset.id);
      if (!item) return;
      item.violationAdvice = e.target.value.trim() || undefined;
      saveTypes();
    }
  };

  // Mount custom searchable select for DIY Linked Customer SMS
  editPane.querySelectorAll<HTMLElement>('.diy-c-select-mount').forEach(mount => {
    const dIdx = parseInt(mount.dataset.diyIdx || '0', 10);
    const diy = t.diyActions?.[dIdx];
    if (!diy) return;

    const selectOptions = [
      { value: '', label: '-- No Linked SMS --' },
      ...quickSmsTemplates.map(s => ({ value: s.id, label: s.title }))
    ];

    new CreatableSelect(mount, {
      options: selectOptions,
      value: diy.smsId || '',
      placeholder: 'Search SMS template...',
      onChange: (val: string) => {
        const cleanVal = val ? val.trim() : '';
        diy.smsId = cleanVal || undefined;
        saveTypes();
        const extBtn = mount.parentElement?.querySelector<HTMLElement>('.btn-edit-linked-sms');
        if (extBtn) {
          extBtn.dataset.smsId = cleanVal || '';
          extBtn.style.display = cleanVal ? '' : 'none';
        }
      },
      onCreate: (opt: { value: string; label: string }) => {
        const newTpl: QuickSmsTemplate = {
          id: opt.value,
          title: opt.label,
          text: ''
        };
        quickSmsTemplates.push(newTpl);
        saveQuickSmsTemplates();
        diy.smsId = opt.value;
        saveTypes();
        const extBtn = mount.parentElement?.querySelector<HTMLElement>('.btn-edit-linked-sms');
        if (extBtn) {
          extBtn.dataset.smsId = opt.value;
          extBtn.style.display = '';
        }
        showToast(`Created SMS template "${opt.label}"`, null, null, 2000, 'info');
      }
    });
  });
}

/* ==========================================================================
   Hamburger Menu, Quick SMS, Quick Interaction & Break Notifier
   ========================================================================== */
const btnMenu = document.getElementById('btnMenu');
const menuDropdown = document.getElementById('menuDropdown');
const menuItemNotes = document.getElementById('menuItemNotes');
const menuItemEditType = document.getElementById('menuItemEditType');
const menuItemQuickSms = document.getElementById('menuItemQuickSms');
const menuItemQuickInteraction = document.getElementById('menuItemQuickInteraction');
const menuItemSettings = document.getElementById('menuItemSettings');
const menuItemBreakNotifier = document.getElementById('menuItemBreakNotifier');

const quickSmsView = document.getElementById('quickSmsView');
const quickInteractionView = document.getElementById('quickInteractionView');
const breakNotifierView = document.getElementById('breakNotifierView');

const btnBackQuickSms = document.getElementById('btnBackQuickSms');
const btnBackQuickInteraction = document.getElementById('btnBackQuickInteraction');
const btnBackBreakNotifier = document.getElementById('btnBackBreakNotifier');

const settingsView = document.getElementById('settingsView');
const btnSettings = document.getElementById('btnSettings');
const btnBackSettings = document.getElementById('btnBackSettings');

function toggleMenu(show) {
  if (!menuDropdown) return;
  const isCurrentlyOpen = menuDropdown.style.display !== 'none';
  const shouldOpen = (typeof show === 'boolean') ? show : !isCurrentlyOpen;
  menuDropdown.style.display = shouldOpen ? 'flex' : 'none';
}

function closeMenu() {
  if (menuDropdown) menuDropdown.style.display = 'none';
}

function initMenu() {
  if (btnMenu) {
    btnMenu.onclick = (e) => {
      e.stopPropagation();
      toggleMenu();
    };
  }

  if (btnSettings) {
    btnSettings.onclick = () => {
      if (settingsView) settingsView.style.display = 'flex';
      renderSettingsView();
    };
  }

  document.addEventListener('click', (e) => {
    if (menuDropdown && menuDropdown.style.display !== 'none') {
      if (!menuDropdown.contains(e.target) && e.target !== btnMenu && !btnMenu?.contains(e.target)) {
        closeMenu();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      closeVarFillModal();
      closeTemplateEditModal();
    }
  });

  if (menuItemNotes) {
    menuItemNotes.onclick = () => {
      closeMenu();
      openNotesView();
    };
  }

  if (menuItemEditType) {
    menuItemEditType.onclick = () => {
      closeMenu();
      openEditView();
    };
  }

  if (menuItemQuickSms) {
    menuItemQuickSms.onclick = () => {
      closeMenu();
      if (quickSmsView) quickSmsView.style.display = 'flex';
      renderQuickSmsList();
      setTimeout(() => {
        const searchInp = document.getElementById('smsSearchInput');
        if (searchInp) searchInp.focus();
      }, 50);
    };
  }

  if (menuItemQuickInteraction) {
    menuItemQuickInteraction.onclick = () => {
      closeMenu();
      if (quickInteractionView) quickInteractionView.style.display = 'flex';
      renderQuickInteractionList();
    };
  }

  if (menuItemSettings) {
    menuItemSettings.onclick = () => {
      closeMenu();
      if (settingsView) settingsView.style.display = 'flex';
      renderSettingsView();
    };
  }

  if (menuItemBreakNotifier) {
    menuItemBreakNotifier.onclick = () => {
      closeMenu();
      if (breakNotifierView) breakNotifierView.style.display = 'flex';
      renderBreakNotifierView();
    };
  }

  const menuItemShortcuts = document.getElementById('menuItemShortcuts');
  if (menuItemShortcuts) {
    menuItemShortcuts.onclick = () => {
      closeMenu();
      showShortcutsDialog();
    };
  }

  if (btnBackSettings) {
    btnBackSettings.onclick = () => {
      if (settingsView) settingsView.style.display = 'none';
    };
  }

  if (btnBackQuickSms) {
    btnBackQuickSms.onclick = () => {
      if (quickSmsView) quickSmsView.style.display = 'none';
      clearQuickSmsSearch();
    };
  }

  if (btnBackQuickInteraction) {
    btnBackQuickInteraction.onclick = () => {
      if (quickInteractionView) quickInteractionView.style.display = 'none';
    };
  }

  if (btnBackBreakNotifier) {
    btnBackBreakNotifier.onclick = () => {
      if (breakNotifierView) breakNotifierView.style.display = 'none';
    };
  }
}

/* ==========================================================================
   Quick SMS & Quick Interaction Templates
   ========================================================================== */
const DEFAULT_QUICK_SMS = [
  {
    id: 'sms_paybill_rev',
    title: 'Paybill Merchant Contact Details',
    text: 'Jambo, kindly contact {ORGANIZATION} on {PHONE} for reversal request of transaction {TXN CODE}. Safaricom.'
  },
  {
    id: 'sms_rev_456',
    title: 'M-PESA Self-Service Reversal (456)',
    text: 'Jambo, you can reverse a wrong M-PESA transaction by forwarding the M-PESA transaction message to 456. Safaricom.'
  },
  {
    id: 'sms_pin_334',
    title: 'M-PESA Self PIN Unlock (*334#)',
    text: 'Jambo, to unlock your M-PESA PIN, dial *334# > My Account > Unlock M-PESA PIN > Enter your ID Number. Safaricom.'
  },
  {
    id: 'sms_puk_100',
    title: 'Self-Service PUK Retrieval (*100# / *456#)',
    text: 'Jambo, to get PUK for a blocked line, dial *100# or *456# from another line > Get PUK > Enter mobile number > Enter ID number. Safaricom.'
  },
  {
    id: 'sms_puk_issuance',
    title: 'PUK Number Issuance to Caller',
    text: 'Jambo, your PUK number for {MSISDN} is {PUK}. Do not share your PIN or PUK with anyone. Safaricom.'
  },
  {
    id: 'sms_pin_manager_334',
    title: 'M-PESA PIN Manager (*334#)',
    text: 'Jambo, to set security questions or reset your forgotten M-PESA PIN, dial *334# > My Account > M-PESA PIN Manager and follow the prompts. Safaricom.'
  },
  {
    id: 'sms_till_rev_100',
    title: 'Buy Goods / Till Reversal (*100#)',
    text: 'Jambo, to reverse a wrong Buy Goods transaction, dial *100# > Mpesa/Reversal > Reverse Buy Goods Transaction and follow the prompts. Safaricom.'
  },
  {
    id: 'sms_agent_rev_2530',
    title: 'Agent Self-Reversal (2530)',
    text: 'Jambo, M-PESA agents can reverse wrong customer deposits and withdrawals within 1 hour by forwarding the transaction SMS to 2530. Safaricom.'
  },
  {
    id: 'sms_till_sim_swap_234',
    title: 'Till Self SIM Swap (*234#)',
    text: 'Jambo, to swap your Till notification SIM, dial *234# from the Nominated Number > M-PESA Business Till > Account Services > SIM Swap, or use the M-PESA Business App. Safaricom.'
  },
  {
    id: 'sms_statement_334',
    title: 'M-PESA Statement DIY (*334# / App)',
    text: 'Jambo, to get your M-PESA statement, dial *334# > My Account > M-PESA Statement or download it via the M-PESA App / MySafaricom App. Safaricom.'
  },
  {
    id: 'sms_stop_promo_456',
    title: 'Stop Promotional SMS (*456*9# / 40044)',
    text: 'Jambo, to stop unwanted marketing SMS or manage subscriptions, dial *456*9# > Stop Promotional Messages or send STOP to 40044. Safaricom.'
  },
  {
    id: 'sms_report_fraud_333',
    title: 'Report Fraud or Scam (333)',
    text: 'Dear Customer, to report fraud or con messages, forward the message or caller number via SMS to 333 for investigation. Safaricom.'
  },
  {
    id: 'sms_pooled_reactivation',
    title: 'Pooled Line Reactivation (*100# / *456#)',
    text: 'Jambo, to recreate your pooled line, dial *100# > SIM Card Queries > SIM Card Reactivation or *456# from another line and enter your ID and Old SIM serial. Top up within 7 days. Safaricom.'
  },
  {
    id: 'sms_inaudible_call',
    title: 'Inaudible Call / Voice Break Reversal',
    text: 'Jambo, sorry we cannot hear you on call. Dial 100, 200 or 234 for assistance or call us from a different phone. To reverse M-PESA forward the message to 456. Thank you.'
  }
];

const _DEFAULT_QUICK_INTERACTION = [];

let quickSmsTemplates = [];
let quickInteractionTemplates = [];
let varHistory = [];
let varPreferences = { remember: {}, usageValues: {}, ignoredWarnings: {} };

const quickSmsListEl = document.getElementById('quickSmsList');
const quickInteractionListEl = document.getElementById('quickInteractionList');
const btnNewSmsTemplate = document.getElementById('btnNewSmsTemplate');
const btnNewInteractionTemplate = document.getElementById('btnNewInteractionTemplate');

async function loadQuickTemplates() {
  const savedSms = await Storage.get('vpad.quick_sms', null);
  if (Array.isArray(savedSms) && savedSms.length > 0) {
    quickSmsTemplates = savedSms;
    let modified = false;

    // Purge stale or inaccurate legacy SMS templates
    const staleIds = ['sms_hakikisha', 'sms_rev_334'];
    const originalLen = quickSmsTemplates.length;
    quickSmsTemplates = quickSmsTemplates.filter(s => !staleIds.includes(s.id));
    if (quickSmsTemplates.length !== originalLen) {
      modified = true;
    }

    // Seed missing default templates or update legacy default texts
    for (const defSms of DEFAULT_QUICK_SMS) {
      const existing = quickSmsTemplates.find(s => s.id === defSms.id);
      if (!existing) {
        quickSmsTemplates.push({ ...defSms });
        modified = true;
      } else if (defSms.id === 'sms_paybill_rev' && (existing.text.includes('during working hours') || existing.text.includes('{Phone Number}'))) {
        existing.title = defSms.title;
        existing.text = defSms.text;
        modified = true;
      } else if (defSms.id === 'sms_pin_334' && existing.text.includes('> Unlock PIN')) {
        existing.title = defSms.title;
        existing.text = defSms.text;
        modified = true;
      } else if (defSms.id === 'sms_puk_100' && existing.text.includes('safaricomapp.page.link')) {
        existing.title = defSms.title;
        existing.text = defSms.text;
        modified = true;
      }
    }
    if (modified) {
      Storage.set('vpad.quick_sms', quickSmsTemplates);
    }
  } else {
    quickSmsTemplates = JSON.parse(JSON.stringify(DEFAULT_QUICK_SMS));
    Storage.set('vpad.quick_sms', quickSmsTemplates);
  }

  const savedInteraction = await Storage.get('vpad.quick_interaction', null);
  if (Array.isArray(savedInteraction)) {
    // Purge old default dummy interactions if any were saved
    quickInteractionTemplates = savedInteraction.filter(item => item.id !== 'int_rev_followup' && item.id !== 'int_gen_query');
    Storage.set('vpad.quick_interaction', quickInteractionTemplates);
  } else {
    quickInteractionTemplates = [];
    Storage.set('vpad.quick_interaction', quickInteractionTemplates);
  }

  // Variable Store: Sunset legacy vpad.remembered_vars into vpad.var_history and vpad.var_prefs
  const legacyRemembered = await Storage.get('vpad.remembered_vars', null);
  varHistory = (await Storage.get('vpad.var_history', [])) || [];
  varPreferences = (await Storage.get('vpad.var_prefs', { remember: {}, usageValues: {}, ignoredWarnings: {} })) || { remember: {}, usageValues: {}, ignoredWarnings: {} };
  if (!varPreferences.ignoredWarnings) varPreferences.ignoredWarnings = {};
  if (!varPreferences.usageValues) varPreferences.usageValues = {};
  if (!varPreferences.remember) varPreferences.remember = {};

  if (legacyRemembered && typeof legacyRemembered === 'object' && Object.keys(legacyRemembered).length > 0) {
    if (varHistory.length === 0) {
      varHistory = migrateLegacyVars(legacyRemembered);
      Storage.set('vpad.var_history', varHistory);
    }
    for (const [k, v] of Object.entries(legacyRemembered)) {
      if (typeof v === 'string' && v) {
        varPreferences.remember[k] = true;
        if (!varPreferences.usageValues[k]) varPreferences.usageValues[k] = v;
      }
    }
    persistVarHistory();
    await Storage.remove('vpad.remembered_vars');
  }
}

function saveQuickSmsTemplates() {
  Storage.set('vpad.quick_sms', quickSmsTemplates);
}

function saveQuickInteractionTemplates() {
  Storage.set('vpad.quick_interaction', quickInteractionTemplates);
}

function persistVarHistory() {
  Storage.set('vpad.var_history', varHistory);
  Storage.set('vpad.var_prefs', varPreferences);
}

function parseTemplateVariables(text) {
  if (!text) return [];
  const regex = /\{([^{}]+)\}/g;
  const vars = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const v = match[1].trim();
    if (v && !vars.includes(v)) {
      vars.push(v);
    }
  }
  return vars;
}

function highlightVariables(text) {
  if (!text) return '';
  return escapeHtml(text).replace(/\{([^{}]+)\}/g, '<span class="template-var-badge">{$1}</span>');
}

let quickSmsFilter: 'all' | 'diy' | 'custom' = 'all';

function triggerSmsCardCopyFeedback(card: HTMLElement, textToCopy: string) {
  writeToClipboard(textToCopy);

  // Remove existing pop badge if present
  card.querySelectorAll('.sms-copied-pop').forEach(el => el.remove());

  // Create visible floating pop badge
  const pop = document.createElement('div');
  pop.className = 'sms-copied-pop';
  pop.innerHTML = `${renderIcon('Check', { size: 12, strokeWidth: 2.5 })}<span>Copied to Clipboard!</span>`;
  card.appendChild(pop);

  // Pulse & glow card
  card.classList.remove('card-copied');
  void card.offsetWidth;
  card.classList.add('card-copied');

  // Morph copy button
  const btnCopy = card.querySelector<HTMLElement>('.copy-tpl-btn');
  if (btnCopy) {
    btnCopy.classList.add('copied');
    btnCopy.innerHTML = renderIcon('Check', { size: 11, strokeWidth: 2.5 });
  }

  // Morph footer action hint
  const hint = card.querySelector<HTMLElement>('.sms-action-hint');
  const originalHintText = hint?.getAttribute('data-orig-hint') || hint?.textContent || 'Click to copy';
  if (hint) {
    if (!hint.hasAttribute('data-orig-hint')) {
      hint.setAttribute('data-orig-hint', originalHintText);
    }
    hint.classList.add('copied');
    hint.textContent = '✓ Copied to clipboard!';
  }

  // Clear existing timer if any
  const existingTimer = copyFeedbackTimers.get(card);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pop.remove();
    card.classList.remove('card-copied');
    if (btnCopy) {
      btnCopy.classList.remove('copied');
      btnCopy.innerHTML = renderIcon('Copy', { size: 11 });
    }
    if (hint) {
      hint.classList.remove('copied');
      hint.textContent = hint.getAttribute('data-orig-hint') || originalHintText;
    }
    copyFeedbackTimers.delete(card);
  }, 1350);
  copyFeedbackTimers.set(card, timer);
}

function renderTemplateCards(container, list, type) {
  if (!container) return;
  if (!list || list.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:24px 10px;font-size:11px;color:var(--text-muted);">No templates yet. Click '+' above to create one.</div>`;
    return;
  }

  container.innerHTML = list.map(item => {
    const usages: { typeId: string; typeName: string; chipLabel: string }[] = [];
    if (type === 'sms') {
      for (const vt of types) {
        if (Array.isArray(vt.diyActions)) {
          for (const diy of vt.diyActions) {
            if (diy.smsId === item.id) {
              const cleanTypeName = (vt.name || '').replace(/\s*\([^)]*\)/g, '').trim();
              usages.push({
                typeId: vt.id,
                typeName: cleanTypeName || vt.name,
                chipLabel: diy.label || 'Action'
              });
            }
          }
        }
      }
    }

    const textLen = (item.text || '').length;
    const smsSegments = textLen === 0 ? 0 : textLen <= 160 ? 1 : Math.ceil(textLen / 153);
    const vars = parseTemplateVariables(item.text || '');
    const isDiy = usages.length > 0;

    return `
      <div class="template-card ${isDiy ? 'is-diy-linked' : ''}" data-template-id="${escapeHtml(item.id)}">
        <div class="template-card-header">
          <span class="template-card-title">${escapeHtml(item.title)}</span>
          <div class="template-card-actions">
            <button type="button" class="ibtn copy-tpl-btn" data-template-id="${escapeHtml(item.id)}" title="${vars.length > 0 ? 'Fill variables & copy' : 'Copy SMS directly'}" aria-label="Copy template">
              ${renderIcon('Copy', { size: 11 })}
            </button>
            <button type="button" class="ibtn edit-tpl-btn" data-template-id="${escapeHtml(item.id)}" title="Edit template" aria-label="Edit template">
              ${renderIcon('Pencil', { size: 11 })}
            </button>
            <button type="button" class="ibtn del-tpl-btn" data-template-id="${escapeHtml(item.id)}" title="Delete template" aria-label="Delete template">
              ${renderIcon('Trash2', { size: 11 })}
            </button>
          </div>
        </div>
        ${usages.length > 0 ? `
          <div class="sms-diy-tag-row">
            ${usages.map(u => `
              <button type="button" class="sms-diy-chip" data-type-id="${escapeHtml(u.typeId)}" title="Linked to DIY chip in '${escapeHtml(u.typeName)}'. Click to switch to this vetting type.">
                ${renderIcon('Zap', { size: 10, strokeWidth: 2.2 })}
                <span>${escapeHtml(u.typeName)}: ${escapeHtml(u.chipLabel)}</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
        <div class="template-card-body">${highlightVariables(item.text)}</div>
        <div class="template-card-footer">
          <div class="sms-meta-info">
            <span class="sms-char-badge">${textLen} chars · ${smsSegments} SMS</span>
            ${vars.length > 0 ? `<span class="sms-vars-badge">${vars.length} variable${vars.length > 1 ? 's' : ''}</span>` : ''}
          </div>
          <span class="sms-action-hint">${vars.length > 0 ? 'Click to fill & send' : 'Click to copy'}</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll<HTMLElement>('.template-card').forEach(card => {
    const id = card.dataset.templateId;
    const tpl = list.find(t => t.id === id);
    if (!tpl) return;

    const vars = parseTemplateVariables(tpl.text || '');

    // Card click: instant copy if no vars, else open fill modal
    card.onclick = (e) => {
      if (e.target instanceof HTMLElement) {
        if (e.target.closest('.copy-tpl-btn') || e.target.closest('.edit-tpl-btn') || e.target.closest('.del-tpl-btn') || e.target.closest('.sms-diy-chip')) return;
      }
      if (vars.length > 0) {
        openVarFillModal(tpl, type);
      } else {
        triggerSmsCardCopyFeedback(card, tpl.text || '');
      }
    };

    // Copy button click
    const btnCopy = card.querySelector<HTMLElement>('.copy-tpl-btn');
    if (btnCopy) {
      btnCopy.onclick = (e) => {
        e.stopPropagation();
        if (vars.length > 0) {
          openVarFillModal(tpl, type);
        } else {
          triggerSmsCardCopyFeedback(card, tpl.text || '');
        }
      };
    }

    // DIY Chip click: Switch directly to that vetting type
    card.querySelectorAll<HTMLElement>('.sms-diy-chip').forEach(diyBtn => {
      diyBtn.onclick = (e) => {
        e.stopPropagation();
        const typeId = diyBtn.dataset.typeId;
        if (typeId && types.some(t => t.id === typeId)) {
          activeTypeId = typeId;
          saveTypes();
          refreshTypeSelect();
          renderForm();
          if (quickSmsView) quickSmsView.style.display = 'none';
          showToast(`Switched to ${types.find(t => t.id === typeId)?.name}`, null, null, 1800, 'info');
        }
      };
    });

    const btnEdit = card.querySelector<HTMLElement>('.edit-tpl-btn');
    if (btnEdit) {
      btnEdit.onclick = (e) => {
        e.stopPropagation();
        openTemplateEditModal(tpl, type);
      };
    }

    const btnDel = card.querySelector<HTMLElement>('.del-tpl-btn');
    if (btnDel) {
      btnDel.onclick = async (e) => {
        e.stopPropagation();
        await deleteTemplate(id, type);
      };
    }
  });
}

function matchesTemplateSearch(t: QuickSmsTemplate | QuickInteractionTemplate, query: string): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  // Build a rich search token corpus for this template
  const corpusParts: string[] = [
    t.title || '',
    t.text || '',
    t.id || ''
  ];

  // 1. Template Variables (raw and sanitized)
  const vars = parseTemplateVariables(t.text || '');
  for (const v of vars) {
    corpusParts.push(v);
    corpusParts.push(v.replace(/[{}]/g, ''));
  }

  // 2. DIY Actions, Advice summaries, Vetting Types, Field labels & Field Hints
  for (const vt of types) {
    let isLinked = false;
    if (Array.isArray(vt.diyActions)) {
      for (const diy of vt.diyActions) {
        if (diy.smsId === t.id) {
          isLinked = true;
          corpusParts.push(diy.label || '');
          corpusParts.push(diy.adviceText || '');
          if (diy.id) corpusParts.push(diy.id);
        }
      }
    }

    if (isLinked) {
      corpusParts.push(vt.name || '');
      if (vt.description) corpusParts.push(vt.description);

      // Collect all field hints, labels, articles, and info from this linked vetting type
      const fields = [...(vt.required || []), ...(vt.optional || [])];
      for (const f of fields) {
        if (f.label) {
          corpusParts.push(f.label);
          if (f.label.includes('//')) {
            const parts = f.label.split('//');
            corpusParts.push(parts[0].trim());
            corpusParts.push(parts[1].trim());
          }
        }
        if (f.info) corpusParts.push(f.info);
        if (f.article) corpusParts.push(f.article);
        if (f.v360) corpusParts.push(f.v360);
      }
    }
  }

  const corpus = corpusParts.join(' ').toLowerCase();

  // Every term in multi-word query must match somewhere in the corpus
  return terms.every(term => corpus.includes(term));
}

function renderQuickSmsList() {
  const query = (quickSmsSearchQuery || '').trim();

  // Evaluate matches across all templates with full corpus
  const allFiltered = quickSmsTemplates.filter(t => matchesTemplateSearch(t, query));
  const diyFiltered = allFiltered.filter(t =>
    types.some(vt => Array.isArray(vt.diyActions) && vt.diyActions.some(d => d.smsId === t.id))
  );
  const customFiltered = allFiltered.filter(t =>
    !types.some(vt => Array.isArray(vt.diyActions) && vt.diyActions.some(d => d.smsId === t.id))
  );

  // Update tab counters & active states
  const tabAll = document.querySelector('#smsFilterTabs [data-filter="all"]');
  const tabDiy = document.querySelector('#smsFilterTabs [data-filter="diy"]');
  const tabCustom = document.querySelector('#smsFilterTabs [data-filter="custom"]');
  if (tabAll) tabAll.textContent = `All (${allFiltered.length})`;
  if (tabDiy) tabDiy.innerHTML = `${renderIcon('Zap', { size: 10 })} <span>DIY Actions (${diyFiltered.length})</span>`;
  if (tabCustom) tabCustom.textContent = `Custom (${customFiltered.length})`;

  document.querySelectorAll<HTMLElement>('#smsFilterTabs .sms-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === quickSmsFilter);
  });

  let list = allFiltered;
  if (quickSmsFilter === 'diy') {
    list = diyFiltered;
  } else if (quickSmsFilter === 'custom') {
    list = customFiltered;
  }

  if (list.length === 0) {
    if (quickSmsListEl) {
      if (query) {
        if (allFiltered.length > 0) {
          quickSmsListEl.innerHTML = `
            <div style="text-align:center;padding:24px 10px;font-size:11px;color:var(--text-muted);">
              <p>No matches in <b>${quickSmsFilter === 'diy' ? 'DIY Actions' : 'Custom'}</b>, but found <b>${allFiltered.length}</b> in other tabs.</p>
              <button type="button" class="btn-action primary" id="btnShowAllSmsMatches" style="margin-top:8px;">Show All Matches</button>
            </div>
          `;
          const btnShowAll = quickSmsListEl.querySelector('#btnShowAllSmsMatches');
          if (btnShowAll) {
            btnShowAll.onclick = () => {
              quickSmsFilter = 'all';
              renderQuickSmsList();
            };
          }
        } else {
          quickSmsListEl.innerHTML = `
            <div style="text-align:center;padding:24px 10px;font-size:11px;color:var(--text-muted);">
              <p>No SMS templates matching "<b>${escapeHtml(query)}</b>"</p>
              <button type="button" class="btn-action" id="btnClearSmsSearch" style="margin-top:8px;">Clear Search</button>
            </div>
          `;
          const btnClearSearch = quickSmsListEl.querySelector('#btnClearSmsSearch');
          if (btnClearSearch) {
            btnClearSearch.onclick = () => {
              clearQuickSmsSearch();
            };
          }
        }
      } else if (quickSmsFilter === 'diy') {
        quickSmsListEl.innerHTML = `
          <div style="text-align:center;padding:24px 10px;font-size:11px;color:var(--text-muted);">
            <p>No templates currently linked to DIY actions.</p>
            <p style="font-size:10px;color:var(--text-dim);margin-top:4px;">Link SMS templates in Settings > Edit Vetting Types > DIY & Advice Actions.</p>
          </div>
        `;
      } else {
        quickSmsListEl.innerHTML = `<div style="text-align:center;padding:24px 10px;font-size:11px;color:var(--text-muted);">No templates found.</div>`;
      }
    }
    return;
  }

  renderTemplateCards(quickSmsListEl, list, 'sms');
}

function clearQuickSmsSearch() {
  quickSmsSearchQuery = '';
  const searchInput = document.getElementById('smsSearchInput');
  const searchClear = document.getElementById('smsSearchClear');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  if (searchClear) searchClear.style.display = 'none';
  renderQuickSmsList();
}

function initQuickSmsSearch() {
  const searchInput = document.getElementById('smsSearchInput');
  const searchClear = document.getElementById('smsSearchClear');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      quickSmsSearchQuery = searchInput.value;
      if (searchClear) searchClear.style.display = searchInput.value ? 'inline-flex' : 'none';
      renderQuickSmsList();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (searchInput.value) {
          e.stopPropagation();
          clearQuickSmsSearch();
        }
      }
    });
  }

  if (searchClear) {
    searchClear.onclick = () => {
      clearQuickSmsSearch();
    };
  }

  const filterTabs = document.getElementById('smsFilterTabs');
  if (filterTabs) {
    filterTabs.onclick = (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      const tab = e.target.closest<HTMLElement>('.sms-filter-tab');
      const filter = tab?.dataset.filter;
      if (filter === 'all' || filter === 'diy' || filter === 'custom') {
        quickSmsFilter = filter;
        renderQuickSmsList();
      }
    };
  }
}

function renderQuickInteractionList() {
  renderTemplateCards(quickInteractionListEl, quickInteractionTemplates, 'interaction');
}

async function deleteTemplate(id, type) {
  if (type === 'sms') {
    const linkedUsages: string[] = [];
    for (const vt of types) {
      if (Array.isArray(vt.diyActions)) {
        for (const diy of vt.diyActions) {
          if (diy.smsId === id) {
            linkedUsages.push(`${vt.name} (${diy.label || 'Action'})`);
          }
        }
      }
    }

    if (linkedUsages.length > 0) {
      const confirmed = await AppDialog.confirm({
        title: 'Delete Linked SMS Template?',
        message: 'This SMS template is currently linked to the following DIY checklist action(s):',
        items: linkedUsages,
        footer: 'Deleting it will remove the template and detach it from these actions. Do you want to proceed?',
        confirmText: 'Delete & Detach',
        danger: true
      });
      if (!confirmed) return;

      // Auto-detach from affected DIY actions
      let typesModified = false;
      for (const vt of types) {
        if (Array.isArray(vt.diyActions)) {
          for (const diy of vt.diyActions) {
            if (diy.smsId === id) {
              delete diy.smsId;
              typesModified = true;
            }
          }
        }
      }
      if (typesModified) {
        saveTypes();
        const curType = types.find(t => t.id === activeTypeId);
        if (curType) renderDiyChips(curType);
      }
    }

    quickSmsTemplates = quickSmsTemplates.filter(t => t.id !== id);
    saveQuickSmsTemplates();
    renderQuickSmsList();
  } else {
    quickInteractionTemplates = quickInteractionTemplates.filter(t => t.id !== id);
    saveQuickInteractionTemplates();
    renderQuickInteractionList();
  }
}

/* ==========================================================================
   Variable Fill Modal Logic
   ========================================================================== */
const varFillOverlay = document.getElementById('varFillOverlay');
const varFillModal = document.getElementById('varFillModal');
const varFillTitle = document.getElementById('varFillTitle');
const varFillClose = document.getElementById('varFillClose');
const varInputsList = document.getElementById('varInputsList');
const varPreviewText = document.getElementById('varPreviewText');
const btnCopyResolved = document.getElementById('btnCopyResolved');

let _activeVarTemplate: unknown = null;
let isCopyingResolved = false;
let copyResolvedTimer = null;

function resetCopyResolvedBtn() {
  if (copyResolvedTimer) {
    clearTimeout(copyResolvedTimer);
    copyResolvedTimer = null;
  }
  isCopyingResolved = false;
  if (btnCopyResolved) {
    btnCopyResolved.classList.remove('copied-success');
    btnCopyResolved.innerHTML = `${renderIcon('Copy', { size: 12 })}<span>Copy Text</span>`;
  }
}

function resolveTemplateText(tplText, varValues) {
  if (!tplText) return '';
  return tplText.replace(/\{([^{}]+)\}/g, (match, p1) => {
    const key = p1.trim();
    return (varValues[key] !== undefined && varValues[key] !== '') ? varValues[key] : match;
  });
}

function highlightVarQuery(label, query) {
  const q = (query || '').trim();
  if (!q) return escapeHtml(label);
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return escapeHtml(label);
  let escaped = escapeHtml(label);
  terms.forEach(term => {
    const reg = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    escaped = escaped.replace(reg, '<mark>$1</mark>');
  });
  return escaped;
}

function openVarFillModal(tpl, _type) {
  const vars = parseTemplateVariables(tpl.text);
  if (vars.length === 0) {
    const card = document.querySelector<HTMLElement>(`.template-card[data-template-id="${tpl.id}"]`);
    if (card) {
      triggerSmsCardCopyFeedback(card, tpl.text);
    } else {
      writeToClipboard(tpl.text);
    }
    return;
  }

  _activeVarTemplate = tpl;
  resetCopyResolvedBtn(); // Always start with a clean button
  if (varFillTitle) varFillTitle.textContent = tpl.title;
  if (varFillOverlay) varFillOverlay.style.display = 'block';
  if (varFillModal) varFillModal.style.display = 'flex';

  const currentValues = {};
  const manualEdits = new Set();

  // Variable inputs always start fresh and blank for each session
  vars.forEach(v => {
    currentValues[v] = '';
  });

  const updatePreview = () => {
    if (varPreviewText) {
      varPreviewText.textContent = resolveTemplateText(tpl.text, currentValues);
    }
  };

  if (varInputsList) {
    varInputsList.innerHTML = vars.map(v => {
      const isRem = isVarRemembered(v, varPreferences);
      const isChurn = isVarHighChurn(varHistory, v, varPreferences);
      return `
        <div class="var-input-row ${isRem ? '' : 'transient'}" data-var-name="${escapeHtml(v)}">
          <div class="var-input-header">
            <div class="var-input-title-group">
              <label class="var-input-label" title="${escapeHtml(v)}">${escapeHtml(v)}</label>
              ${isChurn ? `
                <button type="button" class="var-churn-btn" data-var-name="${escapeHtml(v)}"
                  title="Frequently changing field detected (click to review)">
                  ${renderIcon('AlertCircle', { size: 12 })}
                </button>
              ` : ''}
            </div>
            <button type="button" class="var-pin-btn ${isRem ? 'active' : ''}" data-var-name="${escapeHtml(v)}"
              aria-pressed="${isRem}"
              title="${isRem ? 'Pinned to history (click to unpin)' : 'Unpinned — not saved to history (click to pin)'}">
              ${renderIcon('Pin', { size: 12 })}
            </button>
          </div>
          <div class="var-input-field-wrap">
            <input type="text" class="var-input" value="${escapeHtml(currentValues[v])}" placeholder="${escapeHtml(v)}..." autocomplete="off" spellcheck="false">
            <button type="button" class="var-paste-btn" title="Paste from clipboard">
              ${renderIcon('ClipboardPaste', { size: 11 })}
            </button>
            <ul class="var-suggestions-dropdown" style="display:none;" role="listbox"></ul>
          </div>
        </div>
      `;
    }).join('');

    varInputsList.querySelectorAll('.var-input-row').forEach(row => {
      const v = row.dataset.varName;
      const inp = row.querySelector('.var-input');
      const btnPaste = row.querySelector('.var-paste-btn');
      const btnPin = row.querySelector('.var-pin-btn');
      const btnChurn = row.querySelector('.var-churn-btn');
      const dropdown = row.querySelector('.var-suggestions-dropdown');


      let currentSuggestions = [];
      let activeIdx = -1;
      let preHoverValues = null;

      const hideDropdown = () => {
        if (dropdown) dropdown.style.display = 'none';
        row.classList.remove('open');
        activeIdx = -1;
        currentSuggestions = [];
        if (preHoverValues) restoreHover();
      };

      const restoreHover = () => {
        if (!preHoverValues) return;
        vars.forEach(k => {
          currentValues[k] = preHoverValues[k] || '';
          const targetRow = varInputsList.querySelector(`.var-input-row[data-var-name="${escapeHtml(k)}"]`);
          const targetInp = targetRow ? targetRow.querySelector('.var-input') : null;
          if (targetInp && document.activeElement !== targetInp) {
            targetInp.value = currentValues[k];
          }
        });
        preHoverValues = null;
        updatePreview();
      };

      const paintActive = () => {
        if (!dropdown) return;
        dropdown.querySelectorAll('.var-suggestion-item').forEach((li, idx) => {
          li.classList.toggle('active', idx === activeIdx);
        });
      };

      const applySuggestion = (sug, isCommit = false) => {
        if (!sug) return;
        if (!isCommit && !preHoverValues) {
          preHoverValues = { ...currentValues };
        }

        currentValues[v] = sug.primaryValue;
        if (isCommit) {
          inp.value = sug.primaryValue;
        }

        // Fill accompanying variables (only if not manually edited by user in this session)
        vars.forEach(otherVar => {
          if (otherVar !== v && sug.accompanying && sug.accompanying[otherVar] !== undefined) {
            if (!manualEdits.has(otherVar)) {
              currentValues[otherVar] = sug.accompanying[otherVar];
              const siblingRow = varInputsList.querySelector(`.var-input-row[data-var-name="${escapeHtml(otherVar)}"]`);
              const siblingInp = siblingRow ? siblingRow.querySelector('.var-input') : null;
              if (siblingInp) {
                siblingInp.value = sug.accompanying[otherVar];
              }
            }
          }
        });

        updatePreview();

        if (isCommit) {
          preHoverValues = null;
          hideDropdown();
        }
      };

      const renderSuggestions = () => {
        if (!isVarRemembered(v, varPreferences)) {
          hideDropdown();
          return;
        }
        currentSuggestions = getVarSuggestions(varHistory, v, inp.value, varPreferences);
        if (currentSuggestions.length === 0) {
          hideDropdown();
          return;
        }

        dropdown.innerHTML = currentSuggestions.map((item, idx) => `
          <li class="var-suggestion-item" data-idx="${idx}" role="option">
            <div class="var-suggestion-main">
              <span class="var-suggestion-primary">${highlightVarQuery(item.primaryValue, inp.value)}</span>
              ${item.subtext ? `<span class="var-suggestion-subtext">${escapeHtml(item.subtext)}</span>` : ''}
            </div>
            <button type="button" class="var-suggestion-del" title="Delete this entry from history" data-record-id="${escapeHtml(item.recordId)}">
              ${renderIcon('X', { size: 10 })}
            </button>
          </li>
        `).join('');

        dropdown.querySelectorAll('.var-suggestion-item').forEach(itemEl => {
          const idx = parseInt(itemEl.dataset.idx, 10);
          const sug = currentSuggestions[idx];

          itemEl.onmouseenter = () => {
            activeIdx = idx;
            paintActive();
            applySuggestion(sug, false);
          };

          itemEl.onclick = (e) => {
            if (e.target.closest('.var-suggestion-del')) return;
            applySuggestion(sug, true);
          };

          const btnDel = itemEl.querySelector('.var-suggestion-del');
          if (btnDel) {
            btnDel.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              const recId = btnDel.dataset.recordId;
              varHistory = deleteVarRecord(varHistory, recId);
              persistVarHistory();
              renderSuggestions();
              inp.focus();
            };
          }
        });

        dropdown.onmouseleave = () => {
          restoreHover();
          activeIdx = -1;
          paintActive();
        };

        dropdown.style.display = 'block';
        row.classList.add('open');
        paintActive();
      };

      if (btnPin) {
        // Tooltip hover for truncated labels
        const labelEl = row.querySelector('.var-input-label');
        if (labelEl) {
          labelEl.addEventListener('mouseenter', () => {
            if (labelEl.scrollWidth > labelEl.clientWidth) {
              const tip = document.createElement('div');
              tip.className = 'var-label-tooltip';
              tip.textContent = v;
              labelEl.parentElement.appendChild(tip);
            }
          });
          labelEl.addEventListener('mouseleave', () => {
            const tip = labelEl.parentElement.querySelector('.var-label-tooltip');
            if (tip) tip.remove();
          });
        }

        btnPin.onclick = (e) => {
          e.stopPropagation();
          const nowPinned = !isVarRemembered(v, varPreferences);
          varPreferences.remember[v] = nowPinned;
          persistVarHistory();

          btnPin.classList.toggle('active', nowPinned);
          btnPin.setAttribute('aria-pressed', String(nowPinned));
          btnPin.title = nowPinned ? 'Pinned to history (click to unpin)' : 'Unpinned — not saved to history (click to pin)';
          row.classList.toggle('transient', !nowPinned);

          if (!nowPinned) {
            hideDropdown();
            btnChurn?.remove();
            varFillModal?.querySelector('.var-churn-fly')?.remove();
          } else {
            renderSuggestions();
          }
        };
      }

      if (btnChurn) {
        btnChurn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();

          // If this flyout is already open for this button, close it
          const existingFly = varFillModal?.querySelector<HTMLElement>('.var-churn-fly');
          if (existingFly) {
            existingFly.remove();
            if (existingFly.dataset.varName === v) return;
          }

          const fly = document.createElement('div');
          fly.className = 'var-churn-fly';
          fly.dataset.varName = v;
          fly.setAttribute('role', 'dialog');
          fly.setAttribute('aria-label', `Frequently changing field ${v}`);
          fly.innerHTML = `
            <div class="var-churn-caret"></div>
            <div class="var-churn-ft">
              <b>${escapeHtml(v)}</b>
              <span>is changing too often</span>
            </div>
            <button type="button" class="var-churn-b1" data-action="unpin" title="Stop remembering this field">
              ${renderIcon('PinOff', { size: 12 })}
              <span>Unpin</span>
            </button>
            <div class="var-churn-two">
              <button type="button" class="var-churn-b2" data-action="keep" title="Keep this field pinned">
                ${renderIcon('Pin', { size: 12 })}
                <span>Keep pinned</span>
              </button>
            </div>
          `;

          varFillModal?.appendChild(fly);

          // Position bubble relative to warning icon and modal card
          const btnRect = btnChurn.getBoundingClientRect();
          const modalRect = varFillModal?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight, left: 0, width: 220, height: 300 };

          const flyHeight = 115;
          const spaceBelow = modalRect.bottom - btnRect.bottom;
          const isFlipped = spaceBelow < flyHeight + 15;

          let top = 0;
          if (isFlipped) {
            top = (btnRect.top - modalRect.top) - flyHeight - 6;
            fly.classList.add('flipped');
          } else {
            top = (btnRect.bottom - modalRect.top) + 6;
            fly.classList.remove('flipped');
          }

          const minTop = 38;
          const maxTop = (modalRect.height || 300) - flyHeight - 8;
          top = Math.max(minTop, Math.min(top, maxTop));
          fly.style.top = `${Math.round(top)}px`;

          // Position caret pointing at icon
          const caret = fly.querySelector<HTMLElement>('.var-churn-caret');
          if (caret) {
            const iconCenter = btnRect.left + (btnRect.width / 2);
            let caretLeft = iconCenter - (modalRect.left + 8) - 4;
            const maxCaret = (modalRect.width - 16) - 18;
            caretLeft = Math.max(12, Math.min(caretLeft, maxCaret));
            caret.style.left = `${Math.round(caretLeft)}px`;
          }

          requestAnimationFrame(() => {
            fly.classList.add('open');
          });

          let isClosing = false;
          const closeFly = () => {
            if (isClosing) return;
            isClosing = true;
            document.removeEventListener('click', onDocClick);
            fly.classList.remove('open');
            setTimeout(() => fly.remove(), 160);
          };

          const onDocClick = (ev: MouseEvent) => {
            if (ev.target instanceof Node && !fly.contains(ev.target) && ev.target !== btnChurn && !btnChurn.contains(ev.target)) {
              closeFly();
            }
          };

          setTimeout(() => {
            document.addEventListener('click', onDocClick);
          }, 10);

          const btnUnpin = fly.querySelector<HTMLElement>('.var-churn-b1');
          const btnKeep = fly.querySelector<HTMLElement>('.var-churn-b2');

          if (btnKeep) {
            btnKeep.onclick = (ev) => {
              ev.stopPropagation();
              closeFly();
            };
          }

          if (btnUnpin) {
            btnUnpin.onclick = (ev) => {
              ev.stopPropagation();

              varPreferences.remember[v] = false;
              varHistory = purgeVarFromHistory(varHistory, v);
              persistVarHistory();

              btnPin?.classList.remove('active');
              btnPin?.setAttribute('aria-pressed', 'false');
              if (btnPin) btnPin.title = 'Unpinned — not saved to history (click to pin)';
              row.classList.add('transient');

              hideDropdown();
              btnChurn.remove();
              closeFly();

              showBanner(`Unpinned '${v}' and cleaned history`, null, null, 2500, 'info');
            };
          }
        });
      }

      if (inp) {
        inp.oninput = () => {
          manualEdits.add(v);
          currentValues[v] = inp.value;
          updatePreview();
          renderSuggestions();
        };

        inp.onfocus = () => {
          renderSuggestions();
        };

        inp.onblur = () => {
          setTimeout(() => {
            if (document.activeElement !== inp && (!dropdown || !dropdown.contains(document.activeElement))) {
              if (currentSuggestions.length > 0) {
                const exact = currentSuggestions.find(s => s.primaryValue.toLowerCase() === inp.value.trim().toLowerCase());
                if (exact) {
                  applySuggestion(exact, true);
                }
              }
              hideDropdown();
            }
          }, 180);
        };

        inp.onkeydown = (e) => {
          if (dropdown && dropdown.style.display !== 'none' && currentSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              activeIdx = (activeIdx + 1) % currentSuggestions.length;
              paintActive();
              applySuggestion(currentSuggestions[activeIdx], false);
              const activeLi = dropdown.querySelector(`.var-suggestion-item[data-idx="${activeIdx}"]`);
              if (activeLi) activeLi.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              activeIdx = (activeIdx - 1 + currentSuggestions.length) % currentSuggestions.length;
              paintActive();
              applySuggestion(currentSuggestions[activeIdx], false);
              const activeLi = dropdown.querySelector(`.var-suggestion-item[data-idx="${activeIdx}"]`);
              if (activeLi) activeLi.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
              if (activeIdx >= 0 && activeIdx < currentSuggestions.length) {
                e.preventDefault();
                applySuggestion(currentSuggestions[activeIdx], true);
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              hideDropdown();
            } else if (e.key === 'Tab') {
              if (activeIdx >= 0 && activeIdx < currentSuggestions.length) {
                applySuggestion(currentSuggestions[activeIdx], true);
              } else {
                const exact = currentSuggestions.find(s => s.primaryValue.toLowerCase() === inp.value.trim().toLowerCase());
                if (exact) {
                  applySuggestion(exact, true);
                }
              }
              hideDropdown();
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            const activeFly = varFillModal?.querySelector('.var-churn-fly');
            if (activeFly) {
              activeFly.remove();
            } else {
              closeVarFillModal();
            }
          } else if (e.key === 'Enter') {
            // When dropdown is closed, Enter triggers Copy Text
            e.preventDefault();
            if (btnCopyResolved) btnCopyResolved.click();
          }
        };
      }

      if (btnPaste) {
        btnPaste.onclick = async () => {
          try {
            const clipText = await navigator.clipboard.readText();
            if (clipText && inp) {
              inp.value = clipText.trim();
              manualEdits.add(v);
              currentValues[v] = inp.value;
              updatePreview();
              renderSuggestions();

              const origHtml = btnPaste.innerHTML;
              btnPaste.classList.add('copied-success');
              btnPaste.innerHTML = renderIcon('Check', { size: 11, strokeWidth: 2.5 });
              setTimeout(() => {
                btnPaste.classList.remove('copied-success');
                btnPaste.innerHTML = origHtml;
              }, 1000);
            }
          } catch (err) {
            logger.captureError('templates', err, { action: 'pasteVariable' });
            showToast('Clipboard access denied', null, null, 2500, 'warn');
          }
        };
      }
    });

    const firstInp = varInputsList.querySelector('.var-input');
    if (firstInp) setTimeout(() => firstInp.focus(), 50);
  }

  updatePreview();

  if (btnCopyResolved) {
    btnCopyResolved.onclick = async () => {
      if (isCopyingResolved) return; // prevent double-click during feedback
      isCopyingResolved = true;

      const resolved = resolveTemplateText(tpl.text, currentValues);
      await writeToClipboard(resolved);

      // Auto-save all pinned fields to history (no checkbox needed)
      const saveRes = saveVarRecord(varHistory, currentValues, varPreferences);
      varHistory = saveRes.updatedHistory;
      varPreferences = saveRes.updatedPrefs;
      persistVarHistory();

      vars.forEach(v => {
        if (isVarRemembered(v, varPreferences)) {
          varPreferences.usageValues[v] = currentValues[v] || '';
        } else {
          delete varPreferences.usageValues[v];
        }
      });
      persistVarHistory();

      if (saveRes.autoMutedVars.length > 0) {
        const mutedVar = saveRes.autoMutedVars[0];
        showBanner(
          `Excluded '${mutedVar}' from history`,
          'Keep Pinned',
          () => {
            varPreferences.remember[mutedVar] = true;
            persistVarHistory();
            showBanner(`'${mutedVar}' will be remembered`, null, null, 2000, 'success');
          },
          4500,
          'info'
        );
      }

      // Icon-morphing feedback — no duplicate ✓ symbol
      btnCopyResolved.classList.add('copied-success');
      btnCopyResolved.innerHTML = `${renderIcon('Check', { size: 12, strokeWidth: 2.5 })}<span>Copied</span>`;
      copyResolvedTimer = setTimeout(() => {
        resetCopyResolvedBtn();
        closeVarFillModal();
      }, 800);
    };
  }
}

function closeVarFillModal() {
  resetCopyResolvedBtn(); // Always reset button state when closing
  varFillModal?.querySelector('.var-churn-fly')?.remove();
  if (varFillOverlay) varFillOverlay.style.display = 'none';
  if (varFillModal) varFillModal.style.display = 'none';
  _activeVarTemplate = null;
}

if (varFillClose) varFillClose.onclick = closeVarFillModal;
if (varFillOverlay) varFillOverlay.onclick = closeVarFillModal;

/* ==========================================================================
   Template Create / Edit Modal Logic
   ========================================================================== */
const templateEditOverlay = document.getElementById('templateEditOverlay');
const templateEditModal = document.getElementById('templateEditModal');
const templateEditModalTitle = document.getElementById('templateEditModalTitle');
const templateEditClose = document.getElementById('templateEditClose');
const templateTitleInput = document.getElementById('templateTitleInput');
const templateBodyInput = document.getElementById('templateBodyInput');
const btnCancelTemplate = document.getElementById('btnCancelTemplate');
const btnSaveTemplate = document.getElementById('btnSaveTemplate');

let editingTemplateState = null; // { tpl, type, isNew }

function openTemplateEditModal(tpl, type) {
  editingTemplateState = {
    tpl: tpl || null,
    type: type,
    isNew: !tpl
  };

  if (templateEditModalTitle) {
    templateEditModalTitle.textContent = tpl ? `Edit ${type === 'sms' ? 'SMS' : 'Interaction'} Template` : `New ${type === 'sms' ? 'SMS' : 'Interaction'} Template`;
  }
  if (templateTitleInput) templateTitleInput.value = tpl ? tpl.title : '';
  if (templateBodyInput) templateBodyInput.value = tpl ? tpl.text : '';

  const templateCharCounter = document.getElementById('templateCharCounter');
  const templateDiyLinkNotice = document.getElementById('templateDiyLinkNotice');

  const updateCharCounter = () => {
    if (!templateCharCounter) return;
    const len = templateBodyInput?.value.length || 0;
    const segs = len === 0 ? 0 : len <= 160 ? 1 : Math.ceil(len / 153);
    templateCharCounter.textContent = `${len} / 160 chars (${segs} SMS segment${segs > 1 ? 's' : ''})`;
    if (len > 160) {
      templateCharCounter.style.color = '#fbbf24';
    } else {
      templateCharCounter.style.color = 'var(--text-dim)';
    }
  };

  if (templateBodyInput) {
    templateBodyInput.oninput = updateCharCounter;
  }
  updateCharCounter();

  if (templateDiyLinkNotice) {
    if (type === 'sms' && tpl) {
      const linkedTypes = types.filter(vt => vt.diyActions?.some(d => d.smsId === tpl.id));
      if (linkedTypes.length > 0) {
        templateDiyLinkNotice.style.display = 'inline-flex';
        templateDiyLinkNotice.innerHTML = `${renderIcon('Zap', { size: 10 })} <span>Linked to DIY in: ${escapeHtml(linkedTypes.map(t => t.name).join(', '))}</span>`;
      } else {
        templateDiyLinkNotice.style.display = 'none';
      }
    } else {
      templateDiyLinkNotice.style.display = 'none';
    }
  }

  if (templateEditOverlay) templateEditOverlay.style.display = 'block';
  if (templateEditModal) templateEditModal.style.display = 'flex';
  if (templateTitleInput) setTimeout(() => templateTitleInput.focus(), 50);
}

function closeTemplateEditModal() {
  if (templateBodyInput) templateBodyInput.oninput = null;
  if (templateEditOverlay) templateEditOverlay.style.display = 'none';
  if (templateEditModal) templateEditModal.style.display = 'none';
  editingTemplateState = null;
}

if (templateEditClose) templateEditClose.onclick = closeTemplateEditModal;
if (templateEditOverlay) templateEditOverlay.onclick = closeTemplateEditModal;
if (btnCancelTemplate) btnCancelTemplate.onclick = closeTemplateEditModal;

if (btnSaveTemplate) {
  btnSaveTemplate.onclick = () => {
    if (!editingTemplateState) return;
    const title = (templateTitleInput?.value || '').trim();
    const text = (templateBodyInput?.value || '').trim();
    if (!title || !text) {
      showBanner('Title and message text cannot be empty', null, null, 2500, 'warning');
      return;
    }

    const { tpl, type, isNew } = editingTemplateState;
    if (isNew) {
      const newTpl = {
        id: (type === 'sms' ? 'sms_' : 'int_') + Date.now(),
        title,
        text
      };
      if (type === 'sms') {
        quickSmsTemplates.push(newTpl);
        saveQuickSmsTemplates();
        renderQuickSmsList();
      } else {
        quickInteractionTemplates.push(newTpl);
        saveQuickInteractionTemplates();
        renderQuickInteractionList();
      }
    } else if (tpl) {
      tpl.title = title;
      tpl.text = text;
      if (type === 'sms') {
        saveQuickSmsTemplates();
        renderQuickSmsList();
      } else {
        saveQuickInteractionTemplates();
        renderQuickInteractionList();
      }
    }

    closeTemplateEditModal();
  };
}

if (btnNewSmsTemplate) {
  btnNewSmsTemplate.onclick = () => openTemplateEditModal(null, 'sms');
}
if (btnNewInteractionTemplate) {
  btnNewInteractionTemplate.onclick = () => openTemplateEditModal(null, 'interaction');
}

/* ==========================================================================
   Break Notifier & Live Header Ticker
   ========================================================================== */
const breakTicker = document.getElementById('breakTicker');
const breakTickerIcon = document.getElementById('breakTickerIcon');
const breakTickerText = document.getElementById('breakTickerText');

const break1StartInput = document.getElementById('break1Start');
const lunchStartInput = document.getElementById('lunchStart');
const break2StartInput = document.getElementById('break2Start');
const shiftEndInput = document.getElementById('shiftEnd');

const break1Calc = document.getElementById('break1Calc');
const lunchCalc = document.getElementById('lunchCalc');
const break2Calc = document.getElementById('break2Calc');
const shiftEndCalc = document.getElementById('shiftEndCalc');

const preBreakBadge = document.getElementById('preBreakBadge');
const preBreakChips = document.getElementById('preBreakChips');
const chkShowPageOverlay = document.getElementById('chkShowPageOverlay');

const chkNotifyDesktop = document.getElementById('chkNotifyDesktop');
const chkNotifyToast = document.getElementById('chkNotifyToast');

const breakEventTitle = document.getElementById('breakEventTitle');
const breakEventTag = document.getElementById('breakEventTag');
const breakCountdownBig = document.getElementById('breakCountdownBig');
const breakProgressBar = document.getElementById('breakProgressBar');
const breakStatusSub = document.getElementById('breakStatusSub');

let breakSchedule = Object.assign({}, DEFAULT_BREAK_SCHEDULE);
let lastNotifiedEventKey = null;

function updateScheduleCalcDisplays() {
  const now = new Date();
  const b1Start = parseTimeToDate(breakSchedule.break1, now);
  const b1End = b1Start ? new Date(b1Start.getTime() + 10 * 60 * 1000) : null;
  if (break1Calc) break1Calc.textContent = formatTimeRange(b1Start, b1End, '10m');

  const lStart = parseTimeToDate(breakSchedule.lunch, now);
  const lEnd = lStart ? new Date(lStart.getTime() + 40 * 60 * 1000) : null;
  if (lunchCalc) lunchCalc.textContent = formatTimeRange(lStart, lEnd, '40m');

  const b2Start = parseTimeToDate(breakSchedule.break2, now);
  const b2End = b2Start ? new Date(b2Start.getTime() + 10 * 60 * 1000) : null;
  if (break2Calc) break2Calc.textContent = formatTimeRange(b2Start, b2End, '10m');

  const sEnd = parseTimeToDate(breakSchedule.shiftEnd, now);
  if (shiftEndCalc) shiftEndCalc.textContent = formatShiftEndTime(sEnd);
}

function updatePreBreakUi() {
  const mins = breakSchedule.preBreakMinutes ?? 2;
  if (preBreakBadge) {
    preBreakBadge.textContent = mins === 0 ? 'Off' : `${mins}m before`;
  }
  if (preBreakChips) {
    preBreakChips.querySelectorAll('.pre-chip').forEach(btn => {
      const bMin = parseInt(btn.getAttribute('data-min') || '0', 10);
      btn.classList.toggle('active', bMin === mins);
    });
  }
}

async function initBreakNotifier() {
  const saved = await Storage.get('vpad.break_schedule', null);
  if (saved && typeof saved === 'object') {
    breakSchedule = Object.assign({}, DEFAULT_BREAK_SCHEDULE, saved);
  }

  if (break1StartInput) break1StartInput.value = breakSchedule.break1 || '';
  if (lunchStartInput) lunchStartInput.value = breakSchedule.lunch || '';
  if (break2StartInput) break2StartInput.value = breakSchedule.break2 || '';
  if (shiftEndInput) shiftEndInput.value = breakSchedule.shiftEnd || '';
  if (chkShowPageOverlay) chkShowPageOverlay.checked = (breakSchedule.showPageOverlay !== false);
  if (chkNotifyDesktop) chkNotifyDesktop.checked = Boolean(breakSchedule.notifyDesktop);
  if (chkNotifyToast) chkNotifyToast.checked = (breakSchedule.notifyToast !== false);

  updatePreBreakUi();
  updateScheduleCalcDisplays();
  bindBreakScheduleEvents();
  updateBreakNotifier();
  setInterval(updateBreakNotifier, 1000);
}

const notifBlockedBadge = document.getElementById('notifBlockedBadge');

function updateNotifPermissionUi() {
  const isBlocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  if (notifBlockedBadge) {
    notifBlockedBadge.style.display = isBlocked ? 'block' : 'none';
  }
}

function bindBreakScheduleEvents() {
  const save = () => {
    breakSchedule.break1 = break1StartInput?.value || '';
    breakSchedule.lunch = lunchStartInput?.value || '';
    breakSchedule.break2 = break2StartInput?.value || '';
    breakSchedule.shiftEnd = shiftEndInput?.value || '';
    breakSchedule.showPageOverlay = Boolean(chkShowPageOverlay?.checked);
    breakSchedule.notifyDesktop = Boolean(chkNotifyDesktop?.checked);
    breakSchedule.notifyToast = Boolean(chkNotifyToast?.checked);
    Storage.set('vpad.break_schedule', breakSchedule);
    updateScheduleCalcDisplays();
    updateBreakNotifier();
  };

  [break1StartInput, lunchStartInput, break2StartInput, shiftEndInput].forEach(inp => {
    if (inp) {
      inp.addEventListener('input', save);
      inp.addEventListener('change', save);
    }
  });

  if (chkShowPageOverlay) {
    chkShowPageOverlay.addEventListener('change', save);
  }

  if (preBreakChips) {
    preBreakChips.querySelectorAll('.pre-chip').forEach(btn => {
      btn.onclick = () => {
        const bMin = parseInt(btn.getAttribute('data-min') || '0', 10);
        breakSchedule.preBreakMinutes = bMin;
        updatePreBreakUi();
        save();
      };
    });
  }

  if (chkNotifyDesktop) {
    chkNotifyDesktop.addEventListener('change', async () => {
      if (chkNotifyDesktop.checked) {
        if (typeof Notification === 'undefined') {
          showBanner('Desktop notifications are not supported in this browser.', 'Dismiss', null, 5000, 'warn');
          chkNotifyDesktop.checked = false;
          updateNotifPermissionUi();
          save();
          return;
        }
        if (Notification.permission === 'denied') {
          chkNotifyDesktop.checked = false;
          updateNotifPermissionUi();
          save();
          showBanner('Desktop notifications are blocked by your browser settings. Please unblock them in Chrome settings.', 'Dismiss', null, 7000, 'warn');
          return;
        }
        if (Notification.permission === 'default') {
          try {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
              chkNotifyDesktop.checked = false;
              updateNotifPermissionUi();
              save();
              if (perm === 'denied') {
                showBanner('Desktop notifications were blocked. Please enable them in Chrome settings.', 'Dismiss', null, 7000, 'warn');
              }
              return;
            }
          } catch (err) {
            logger.captureError('notifications', err, { action: 'requestDesktopNotificationPermission' });
            chkNotifyDesktop.checked = false;
            updateNotifPermissionUi();
            save();
            showBanner('Failed to request desktop notification permission.', 'Dismiss', null, 5000, 'warn');
            return;
          }
        }
      }
      updateNotifPermissionUi();
      save();
    });
  }

  if (chkNotifyToast) {
    chkNotifyToast.addEventListener('change', save);
  }

  if (breakTicker) {
    breakTicker.onclick = () => {
      if (breakNotifierView) breakNotifierView.style.display = 'flex';
      renderBreakNotifierView();
    };
  }

  const ambientBreakBar = document.getElementById('ambientBreakBar');
  if (ambientBreakBar) {
    ambientBreakBar.onclick = () => {
      if (breakNotifierView) breakNotifierView.style.display = 'flex';
      renderBreakNotifierView();
    };
  }

  const btnPreviewOverlay = document.getElementById('btnPreviewOverlay');
  if (btnPreviewOverlay) {
    btnPreviewOverlay.onclick = () => {
      chrome.tabs.query({ active: true }, (tabs) => {
        const webTab = tabs.find(t => t.id && t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
        if (!webTab || !webTab.id) {
          showBanner('Open any web page (e.g. google.com or CRM) to see the break overlay.', 'Dismiss', null, 6000, 'warn');
          return;
        }
        chrome.tabs.sendMessage(webTab.id, {
          type: 'VPAD_BREAK_STATE',
          isPreview: true,
          eventName: '☕ Tea break (Preview)',
          diffSec: 300,
          showPageOverlay: true
        }).then(() => {
          showBanner('Break overlay launched on your active web tab!', 'OK', null, 3000, 'info');
        }).catch(() => {
          showBanner('Please refresh your web page once so the break overlay script can load.', 'Dismiss', null, 6000, 'warn');
        });
      });
    };
  }
}

function renderBreakNotifierView() {
  if (break1StartInput) break1StartInput.value = breakSchedule.break1 || '';
  if (lunchStartInput) lunchStartInput.value = breakSchedule.lunch || '';
  if (break2StartInput) break2StartInput.value = breakSchedule.break2 || '';
  if (shiftEndInput) shiftEndInput.value = breakSchedule.shiftEnd || '';
  if (chkShowPageOverlay) chkShowPageOverlay.checked = (breakSchedule.showPageOverlay !== false);
  if (chkNotifyDesktop) chkNotifyDesktop.checked = Boolean(breakSchedule.notifyDesktop);
  if (chkNotifyToast) chkNotifyToast.checked = (breakSchedule.notifyToast !== false);
  updatePreBreakUi();
  updateScheduleCalcDisplays();
  updateNotifPermissionUi();
  updateBreakNotifier();
}

function triggerBreakNotification(key, title, body) {
  if (lastNotifiedEventKey === key) return;
  lastNotifiedEventKey = key;

  if (breakSchedule.notifyToast) {
    showBanner(`${title}: ${body}`, 'Dismiss', null, 8000, 'warning');
  }

  if (breakSchedule.notifyDesktop && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body: body, icon: 'icons/icon48.png' });
      } catch (err) {
        logger.captureError('notifications', err, { action: 'showDesktopNotification' });
        if (!breakSchedule.notifyToast) {
          showBanner(`${title}: ${body}`, 'Dismiss', null, 8000, 'warning');
        }
      }
    }
  }
}

function updateBreakNotifier() {
  const now = new Date();
  const state = calculateBreakState(breakSchedule, now);
  updateScheduleCalcDisplays();

  const ambientBreakBar = document.getElementById('ambientBreakBar');
  const ambientBreakIcon = document.getElementById('ambientBreakIcon');
  const ambientBreakText = document.getElementById('ambientBreakText');

  if (!state.isConfigured) {
    if (breakTicker) {
      breakTicker.style.display = 'inline-flex';
      breakTicker.classList.remove('active-break');
      breakTicker.classList.add('unconfigured');
    }
    if (breakTickerIcon) breakTickerIcon.innerHTML = renderBreakIcon('coffee', 13);
    if (breakTickerText) breakTickerText.textContent = state.tickerText;
    if (breakCountdownBig) breakCountdownBig.textContent = state.bigCountdown;
    if (breakEventTitle) breakEventTitle.textContent = state.eventName;
    if (breakEventTag) breakEventTag.textContent = state.eventTag;
    if (breakStatusSub) breakStatusSub.textContent = state.statusSub;
    if (breakProgressBar) breakProgressBar.style.width = '0%';
    if (ambientBreakBar) {
      ambientBreakBar.style.display = 'flex';
      ambientBreakBar.classList.add('unconfigured');
      if (ambientBreakIcon) ambientBreakIcon.innerHTML = renderIcon('Clock', { size: 12 });
      if (ambientBreakText) ambientBreakText.textContent = 'Set Break Notifier';
    }
    return;
  }

  if (breakTicker) {
    breakTicker.style.display = 'inline-flex';
    breakTicker.classList.toggle('active-break', state.isActive);
    breakTicker.classList.remove('unconfigured');
  }
  if (breakTickerIcon) breakTickerIcon.innerHTML = renderBreakIcon(state.icon, 13);
  if (breakTickerText) breakTickerText.textContent = state.tickerText;
  if (breakCountdownBig) breakCountdownBig.textContent = state.bigCountdown;
  if (breakEventTitle) breakEventTitle.textContent = state.eventName;
  if (breakEventTag) breakEventTag.textContent = state.eventTag;
  if (breakStatusSub) breakStatusSub.textContent = state.statusSub;

  if (ambientBreakBar) {
    ambientBreakBar.style.display = 'flex';
    ambientBreakBar.classList.remove('unconfigured');
    if (ambientBreakIcon) ambientBreakIcon.innerHTML = renderBreakIcon(state.icon, 13);
    if (ambientBreakText) ambientBreakText.textContent = formatActiveBreakDisplay(state);
  }

  if (state.isActive && state.targetTime) {
    const totalDurationSec = state.currentPhase === 'in_lunch' ? 40 * 60 : 10 * 60;
    const progress = Math.max(0, Math.min(100, Math.round(((totalDurationSec - state.diffSec) / totalDurationSec) * 100)));
    if (breakProgressBar) breakProgressBar.style.width = `${progress}%`;
  } else if (state.targetTime && breakSchedule.shiftEnd && breakSchedule.break1) {
    const b1Start = parseTimeToDate(breakSchedule.break1, now);
    const sEnd = parseTimeToDate(breakSchedule.shiftEnd, now);
    if (b1Start && sEnd) {
      const totalDayMs = sEnd.getTime() - b1Start.getTime();
      const elapsedDayMs = now.getTime() - b1Start.getTime();
      const pct = Math.max(0, Math.min(100, Math.round((elapsedDayMs / totalDayMs) * 100)));
      if (breakProgressBar) breakProgressBar.style.width = `${pct}%`;
    }
  } else {
    if (breakProgressBar) breakProgressBar.style.width = '0%';
  }

  if (state.isPreBreak && state.notifKey) {
    if (state.notifKey.includes('before_b1')) {
      triggerBreakNotification(state.notifKey, 'Upcoming Break', `Break 1 starts in ${state.preBreakMinutes}m ⏳`);
    } else if (state.notifKey.includes('before_lunch')) {
      triggerBreakNotification(state.notifKey, 'Upcoming Lunch', `Lunch starts in ${state.preBreakMinutes}m 🍱`);
    } else if (state.notifKey.includes('before_b2')) {
      triggerBreakNotification(state.notifKey, 'Upcoming Break', `Break 2 starts in ${state.preBreakMinutes}m ⏳`);
    }
  }

  if (state.notifKey && state.targetTime) {
    if (state.notifKey === 'b1_start' && state.diffSec >= 590) {
      triggerBreakNotification('b1_start', 'Break 1 Started', 'Time for Break 1 (10 min break) ☕');
    } else if (state.notifKey === 'lunch_start' && state.diffSec >= 2390) {
      triggerBreakNotification('lunch_start', 'Lunch Started', 'Time for Lunch (40 min lunch) 🍱');
    } else if (state.notifKey === 'b2_start' && state.diffSec >= 590) {
      triggerBreakNotification('b2_start', 'Break 2 Started', 'Time for Break 2 (10 min break) ☕');
    }
  }

  // Persist current state and broadcast to active tabs for live break overlay
  try {
    Storage.set('vpad.lastBreakState', {
      isConfigured: state.isConfigured,
      currentPhase: state.currentPhase,
      isActive: state.isActive,
      isPreBreak: state.isPreBreak,
      preBreakMinutes: state.preBreakMinutes,
      eventName: state.eventName,
      eventTag: state.eventTag,
      icon: state.icon,
      tickerText: state.tickerText,
      bigCountdown: state.bigCountdown,
      statusSub: state.statusSub,
      diffSec: state.diffSec,
      showPageOverlay: breakSchedule.showPageOverlay !== false
    });

    if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.query === 'function') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'VPAD_BREAK_STATE',
            ...state,
            showPageOverlay: breakSchedule.showPageOverlay !== false
          }).catch(() => {
            // tab may not have content script loaded or is restricted
          });
        }
      });
    }
  } catch (err) {
    logger.captureError('break-timer', err, { action: 'broadcastBreakState' });
  }
}

/* ==========================================================================
   Settings Screen Handlers
   ========================================================================== */
function renderSettingsView() {
  const themeChips = document.getElementById('themeChips');
  themeChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.themeVal === settings.theme);
    c.onclick = () => {
      applyTheme(c.dataset.themeVal);
      renderSettingsView();
    };
  });

  const acChips = document.getElementById('autoClearChips');
  acChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.ac, 10) === settings.autoClear);
    c.onclick = () => {
      settings.autoClear = parseInt(c.dataset.ac, 10);
      Storage.set('vpad.settings', settings);
      renderSettingsView();
    };
  });

  const chkClearCallpadOnClear = document.getElementById('chkClearCallpadOnClear');
  if (chkClearCallpadOnClear) {
    chkClearCallpadOnClear.checked = Boolean(clearCallpadOnClear);
    chkClearCallpadOnClear.onchange = async () => {
      if (chkClearCallpadOnClear.checked) {
        const confirmed = await AppDialog.confirm({
          title: 'Clear Floating Call Items?',
          message: 'Warning: Floating call items cannot be restored by the Undo action. Are you sure you want to clear floating call items whenever vetting details are cleared?',
          confirmText: 'Enable',
          cancelText: 'Cancel',
          danger: true
        });
        if (confirmed) {
          clearCallpadOnClear = true;
          await Storage.set('vpad.clear_callpad_on_clear', true);
        } else {
          chkClearCallpadOnClear.checked = false;
          clearCallpadOnClear = false;
          await Storage.set('vpad.clear_callpad_on_clear', false);
        }
      } else {
        clearCallpadOnClear = false;
        await Storage.set('vpad.clear_callpad_on_clear', false);
      }
    };
  }

  const chkNotesMultiline = document.querySelector<HTMLInputElement>('#chkNotesMultiline');
  const notesMaxLinesSettingRow = document.getElementById('notesMaxLinesSettingRow');
  const notesMaxLinesChips = document.getElementById('notesMaxLinesChips');

  if (chkNotesMultiline) {
    chkNotesMultiline.checked = notesMultilineEnabled;
    if (notesMaxLinesSettingRow) {
      notesMaxLinesSettingRow.style.display = notesMultilineEnabled ? 'block' : 'none';
    }
    chkNotesMultiline.onchange = () => {
      notesMultilineEnabled = chkNotesMultiline.checked;
      Storage.set('vpad.notes_multiline', notesMultilineEnabled);
      applyNotesMultilineState(notesMultilineEnabled, notesMaxLinesValue);
      renderSettingsView();
    };
  }

  if (notesMaxLinesChips) {
    notesMaxLinesChips.querySelectorAll<HTMLElement>('.chip').forEach(c => {
      const lines = parseInt(c.dataset.lines || '4', 10);
      c.classList.toggle('active', lines === notesMaxLinesValue);
      c.onclick = () => {
        notesMaxLinesValue = lines;
        Storage.set('vpad.notes_max_lines', lines);
        applyNotesMultilineState(notesMultilineEnabled, notesMaxLinesValue);
        renderSettingsView();
      };
    });
  }

  // Export Configuration & Data
  const btnExportData = document.getElementById('btnExportData');
  if (btnExportData) {
    btnExportData.onclick = async () => {
      try {
        const payload = buildExportPayload({
          types,
          settings,
          savedComments,
          activeTypeId,
          quickSmsTemplates,
          quickInteractionTemplates
        });
        const result = await exportConfiguration(payload);
        if (result.success) {
          morphButton(btnExportData, 'Exported ✓', 'Check', 'success', 2000);
        } else {
          morphButton(btnExportData, 'Failed', 'AlertCircle', 'error', 2000);
        }
      } catch (err) {
        logger.captureError('export', err, { action: 'exportConfiguration' });
        morphButton(btnExportData, 'Error', 'AlertCircle', 'error', 2000);
      }
    };
  }

  // Import Configuration & Data
  const btnImportData = document.getElementById('btnImportData');
  const importFileInput = document.getElementById('importFileInput');
  if (btnImportData && importFileInput) {
    btnImportData.onclick = () => {
      importFileInput.click();
    };

    importFileInput.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const confirmed = await AppDialog.confirm({
        title: 'Overwrite Configuration',
        message: 'Importing data will overwrite your current vetting types and configuration. Do you want to continue?',
        confirmText: 'Import & Overwrite',
        danger: true
      });
      if (!confirmed) {
        importFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const raw = evt.target.result;
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (jsonErr) {
            logger.captureError('import', jsonErr, { action: 'parseJSON' });
            throw new Error('File does not contain valid JSON');
          }

          const validation = validateImportPayload(parsed);
          if (!validation.valid) {
            throw new Error(validation.error);
          }

          const data = validation.payload;
          types = data.types;
          if (data.settings && typeof data.settings === 'object') {
            settings = Object.assign(settings, data.settings);
          }
          if (Array.isArray(data.savedComments)) {
            savedComments = data.savedComments;
          }
          if (data.activeTypeId && types.some(t => t.id === data.activeTypeId)) {
            activeTypeId = data.activeTypeId;
          } else {
            activeTypeId = types[0].id;
          }

          if (Array.isArray(data.quickSmsTemplates) && data.quickSmsTemplates.length > 0) {
            quickSmsTemplates = data.quickSmsTemplates;
            saveQuickSmsTemplates();
            renderQuickSmsList();
          }
          if (Array.isArray(data.quickInteractionTemplates) && data.quickInteractionTemplates.length > 0) {
            quickInteractionTemplates = data.quickInteractionTemplates;
            saveQuickInteractionTemplates();
            renderQuickInteractionList();
          }

          formValues = {};
          itemStatus = {};

          saveTypes();
          saveSettings();
          saveComments();

          applyTheme(settings.theme || 'auto');
          refreshTypeSelect();
          renderForm();
          updateCommentInput();
          renderSettingsView();

          showBanner('Configuration imported successfully', null, null, 3000, 'info');
        } catch (err) {
          logger.captureError('import', err, { action: 'importConfiguration' });
          showBanner('Import failed: ' + (err.message || 'Invalid JSON file'), null, null, 3500, 'danger');
        } finally {
          importFileInput.value = '';
        }
      };
      reader.readAsText(file);
    };
  }

  // Export Debug Diagnostics (Safe JSON with PII Redaction)
  const btnExportDebugLogs = document.getElementById('btnExportDebugLogs');
  if (btnExportDebugLogs) {
    btnExportDebugLogs.onclick = async () => {
      try {
        let storageDump = {};
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          try {
            storageDump = await chrome.storage.local.get(null);
          } catch (e) {
            logger.captureError('export-diagnostics', e, { action: 'storage-dump' });
          }
        }

        const diagnostics = buildDebugDiagnostics({
          version: getAppVersion(),
          types,
          settings,
          activeTypeId,
          storageDump,
          breakSchedule: typeof breakSchedule !== 'undefined' ? breakSchedule : null,
          currentValues: curValues(),
          errors: logger.getErrors(),
          logs: logger.getLogs()
        });

        const result = await exportDebugDiagnostics(diagnostics);
        if (result.success) {
          morphButton(btnExportDebugLogs, 'Copied ✓', 'Check', 'success', 2000);
        } else {
          logger.error('export-diagnostics', 'Export failed', { error: result.error });
          morphButton(btnExportDebugLogs, 'Failed', 'AlertCircle', 'error', 2000);
        }
      } catch (err) {
        logger.captureError('export-diagnostics', err);
        morphButton(btnExportDebugLogs, 'Error', 'AlertCircle', 'error', 2000);
      }
    };
  }

  const btnShowShortcuts = document.getElementById('btnShowShortcuts');
  if (btnShowShortcuts) {
    btnShowShortcuts.onclick = () => {
      showShortcutsDialog();
    };
  }

  document.getElementById('btnResetAll').onclick = async () => {
    const ok = await AppDialog.confirm({
      title: 'Factory Reset',
      message: 'Reset all vetting types and configuration to factory defaults? Your custom types will be removed.',
      confirmText: 'Reset to Defaults',
      danger: true
    });
    if (ok) {
      types = defaultVettingTypes();
      activeTypeId = types[0].id;
      formValues = {};
      itemStatus = {};
      saveTypes();
      settingsView.style.display = 'none';
      refreshTypeSelect();
      renderForm();
      updateCommentInput();
    }
  };
}

function toggleFieldStatus(targetStatus = 'failed') {
  let active = document.activeElement;
  let row = active ? active.closest('.item-row') : null;
  if (!row) {
    row = mainForm.querySelector('.item-row');
  }
  if (!row) return;

  const btn = row.querySelector('[data-status-btn="failed"]');
  const id = row.dataset.id;
  if (!id) return;

  if (targetStatus === 'failed') {
    if (btn) {
      btn.click();
    }
  } else if (targetStatus === 'passed') {
    if (curStatus()[id] === 'failed' && btn) {
      btn.click();
    } else {
      curStatus()[id] = curStatus()[id] === 'passed' ? null : 'passed';
      const box = row.querySelector('.material-field');
      const track = row.querySelector('.mat-underline-track');
      if (box) box.classList.remove('status-failed');
      if (track) track.classList.remove('status-failed');
      if (btn) btn.classList.remove('active');
      syncPreview();
    }
  }
}

/* ==========================================================================
   Keyboard Shortcuts (Screen Switcher & Actions)
   ========================================================================== */
const notesView = document.getElementById('notesView');

function returnToVettingAndSearch() {
  if (AppDialog && AppDialog.closeActive) AppDialog.closeActive();
  const activeOverlay = document.querySelector('.app-dialog-overlay');
  if (activeOverlay && activeOverlay.parentNode) {
    activeOverlay.parentNode.removeChild(activeOverlay);
  }

  if (callPadPopover && callPadPopover.style.display !== 'none') {
    closeCallPad();
  }
  if (breakNotifierView && breakNotifierView.style.display !== 'none') {
    breakNotifierView.style.display = 'none';
  }
  if (quickSmsView && quickSmsView.style.display !== 'none') {
    quickSmsView.style.display = 'none';
    clearQuickSmsSearch();
  }
  if (notesView && notesView.style.display !== 'none') {
    notesView.style.display = 'none';
  }
  if (settingsView && settingsView.style.display !== 'none') {
    settingsView.style.display = 'none';
  }
  if (editView && editView.style.display !== 'none') {
    closeEditView();
  }
  if (menuDropdown && menuDropdown.style.display !== 'none') {
    menuDropdown.style.display = 'none';
  }
  if (typeof closeVarFillModal === 'function') closeVarFillModal();
  if (typeof closeTemplateEditModal === 'function') closeTemplateEditModal();
  closeInfoPopover();

  // Scroll back to top if far down
  if (mainForm) {
    mainForm.scrollTop = 0;
  }
  window.scrollTo({ top: 0, left: 0 });

  // Open and focus vetting combobox
  if (typeSelectComponent) {
    typeSelectComponent.open();
    if (typeSelectComponent.input) {
      typeSelectComponent.input.focus();
      typeSelectComponent.input.select();
    }
  }
}

function showShortcutsDialog() {
  AppDialog.shortcuts(DEFAULT_KEYBOARD_SHORTCUTS, (action, item) => {
    const keyCombo = item && item.keys && item.keys.length ? item.keys.join('+') : '';
    if (keyCombo && action !== 'showShortcuts') {
      showBanner(`Tip: Use ${keyCombo} next time`, null, null, 2800, 'info');
    }

    switch (action) {
      case 'toggleNotes':
        if (notesView && notesView.style.display !== 'none') {
          notesView.style.display = 'none';
        } else {
          openNotesView();
        }
        break;
      case 'toggleCallpad':
        toggleCallPad();
        break;
      case 'toggleBreaks':
        if (breakNotifierView && breakNotifierView.style.display !== 'none') {
          breakNotifierView.style.display = 'none';
        } else if (breakNotifierView) {
          breakNotifierView.style.display = 'flex';
          renderBreakNotifierView();
        }
        break;
      case 'toggleQuickSms':
        if (quickSmsView && quickSmsView.style.display !== 'none') {
          quickSmsView.style.display = 'none';
          clearQuickSmsSearch();
        } else if (quickSmsView) {
          quickSmsView.style.display = 'flex';
          renderQuickSmsList();
          setTimeout(() => {
            const searchInp = document.getElementById('smsSearchInput');
            if (searchInp) searchInp.focus();
          }, 50);
        }
        break;
      case 'toggleSettings':
        if (settingsView && settingsView.style.display !== 'none') {
          settingsView.style.display = 'none';
        } else if (settingsView) {
          settingsView.style.display = 'flex';
          renderSettingsView();
        }
        break;
      case 'togglePreview':
        if (btnTogglePreview) btnTogglePreview.click();
        break;
      case 'copyVetting':
        doCopy();
        break;
      case 'pasteVetting': {
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('mat-input') && active.dataset.id) {
          smartPasteField(active);
        } else {
          doPasteWholeVetting();
        }
        break;
      }
      case 'passField':
        toggleFieldStatus('passed');
        break;
      case 'failField':
        toggleFieldStatus('failed');
        break;
      case 'openTypeSearch':
        returnToVettingAndSearch();
        break;
      case 'handleEscape':
        break;
      case 'showShortcuts':
        setTimeout(showShortcutsDialog, 60);
        break;
    }
  });
}

initShortcuts({
  toggleNotes: () => {
    if (notesView && notesView.style.display !== 'none') {
      notesView.style.display = 'none';
    } else {
      openNotesView();
    }
  },
  toggleCallpad: () => {
    toggleCallPad();
  },
  toggleBreaks: () => {
    if (breakNotifierView && breakNotifierView.style.display !== 'none') {
      breakNotifierView.style.display = 'none';
    } else if (breakNotifierView) {
      breakNotifierView.style.display = 'flex';
      renderBreakNotifierView();
    }
  },
  toggleQuickSms: () => {
    if (quickSmsView && quickSmsView.style.display !== 'none') {
      quickSmsView.style.display = 'none';
      clearQuickSmsSearch();
    } else if (quickSmsView) {
      quickSmsView.style.display = 'flex';
      renderQuickSmsList();
      setTimeout(() => {
        const searchInp = document.getElementById('smsSearchInput');
        if (searchInp) searchInp.focus();
      }, 50);
    }
  },
  findOrSearch: () => {
    if (quickSmsView && quickSmsView.style.display !== 'none') {
      const searchInp = document.getElementById('smsSearchInput');
      if (searchInp) {
        searchInp.focus();
        searchInp.select();
        return true;
      }
    }
    return false;
  },
  toggleSettings: () => {
    if (settingsView && settingsView.style.display !== 'none') {
      settingsView.style.display = 'none';
    } else if (settingsView) {
      settingsView.style.display = 'flex';
      renderSettingsView();
    }
  },
  togglePreview: () => {
    if (btnTogglePreview) btnTogglePreview.click();
  },
  passField: () => {
    toggleFieldStatus('passed');
  },
  failField: () => {
    toggleFieldStatus('failed');
  },
  handleEscape: () => {
    if (AppDialog && AppDialog.closeActive && AppDialog.closeActive()) return;
    if (callPadPopover && callPadPopover.style.display !== 'none') {
      closeCallPad();
      return;
    }
    if (breakNotifierView && breakNotifierView.style.display !== 'none') {
      breakNotifierView.style.display = 'none';
      return;
    }
    if (quickSmsView && quickSmsView.style.display !== 'none') {
      const searchInp = document.getElementById('smsSearchInput');
      if (searchInp && searchInp.value) {
        clearQuickSmsSearch();
        return;
      }
      quickSmsView.style.display = 'none';
      clearQuickSmsSearch();
      return;
    }
    if (notesView && notesView.style.display !== 'none') {
      notesView.style.display = 'none';
      return;
    }
    if (settingsView && settingsView.style.display !== 'none') {
      settingsView.style.display = 'none';
      return;
    }
    if (editView && editView.style.display !== 'none') {
      closeEditView();
      return;
    }
    if (typeof closeVarFillModal === 'function') closeVarFillModal();
    if (typeof closeTemplateEditModal === 'function') closeTemplateEditModal();
    closeInfoPopover();
  },
  copyVetting: () => {
    doCopy();
  },
  pasteVetting: async () => {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('mat-input') && active.dataset.id) {
      await smartPasteField(active);
    } else {
      doPasteWholeVetting();
    }
  },
  openTypeSearch: () => {
    returnToVettingAndSearch();
  },
  showShortcuts: () => {
    showShortcutsDialog();
  }
});

// Clamp minimum window width to 200px on window resize
let resizeClampTimer = null;
window.addEventListener('resize', () => {
  if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
    if (window.outerWidth < 200) {
      if (resizeClampTimer) clearTimeout(resizeClampTimer);
      resizeClampTimer = setTimeout(() => {
        chrome.windows.getCurrent((w) => {
          if (w && typeof w.width === 'number' && w.width < 200) {
            chrome.windows.update(w.id, { width: 200 });
          }
        });
      }, 50);
    }
  }
});

document.addEventListener('pointerdown', (e) => {
  const pop = document.getElementById('activeSakaPopover');
  if (pop && !pop.contains(e.target) && !e.target.closest('.mat-info-btn')) {
    closeInfoPopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeInfoPopover();
  }
});

/* ==========================================================================
   Full-Canvas Notepad
   ========================================================================== */
const btnNotes = document.getElementById('btnNotes');
const btnBackNotes = document.getElementById('btnBackNotes');
const btnNewNote = document.getElementById('btnNewNote');
const btnCopyNote = document.getElementById('btnCopyNote');
const btnDeleteNote = document.getElementById('btnDeleteNote');
const noteSelectMount = document.getElementById('noteSelectMount');
const noteTitleInput = document.getElementById('noteTitleInput');
const noteQuillMount = document.getElementById('noteQuillMount');
const noteSaveStatus = document.getElementById('noteSaveStatus');
const noteWordCharCount = document.getElementById('noteWordCharCount');

let richNotepad = null;

function initRichNotepadInstance() {
  if (noteQuillMount && !richNotepad) {
    const cur = getActiveNote();
    richNotepad = new RichNotepad({
      mountElement: noteQuillMount,
      initialContent: cur ? (cur.html || cur.text || '') : '',
      onChange: ({ html, text, chars, words }) => {
        const active = getActiveNote();
        if (active) {
          active.html = html;
          active.text = text;
          active.updatedAt = Date.now();
        }
        if (noteWordCharCount) {
          noteWordCharCount.textContent = `${words} words · ${chars} chars`;
        }
        scheduleSaveNotes();
      }
    });
  }
}

async function loadNotes() {
  const raw = await Storage.get('vpad.notes', []);
  if (Array.isArray(raw) && raw.length > 0) {
    notes = raw.map(n => ({
      id: n.id || uid(),
      title: n.title || (n.text ? n.text.split('\n')[0].slice(0, 32) : 'Untitled Note'),
      text: n.text || '',
      html: n.html || '',
      updatedAt: n.updatedAt || n.createdAt || Date.now()
    }));
  } else {
    notes = [
      {
        id: uid(),
        title: 'General Notes',
        text: '',
        html: '',
        updatedAt: Date.now()
      }
    ];
  }
  activeNoteId = await Storage.get('vpad.active_note', notes[0].id);
  if (!notes.some(n => n.id === activeNoteId)) {
    activeNoteId = notes[0].id;
  }
}

async function saveNotesImmediate() {
  await Storage.set('vpad.notes', notes);
  await Storage.set('vpad.active_note', activeNoteId);
  if (noteSaveStatus) {
    noteSaveStatus.textContent = 'Saved';
    noteSaveStatus.className = 'saved';
  }
}

function scheduleSaveNotes() {
  if (noteSaveStatus) {
    noteSaveStatus.textContent = 'Saving...';
    noteSaveStatus.className = 'saving';
  }
  if (saveNotesTimer) clearTimeout(saveNotesTimer);
  saveNotesTimer = setTimeout(() => {
    saveNotesImmediate();
  }, 180);
}

function getActiveNote() {
  return notes.find(n => n.id === activeNoteId) || notes[0];
}

function updateNoteCounts() {
  if (!noteWordCharCount) return;
  const cur = getActiveNote();
  const stats = calculateNoteStats(cur ? (cur.text || '') : '');
  noteWordCharCount.textContent = `${stats.words} words · ${stats.chars} chars`;
}

function switchNote(noteId) {
  activeNoteId = noteId;
  Storage.set('vpad.active_note', activeNoteId);
  const note = getActiveNote();
  if (!note) return;

  if (noteTitleInput) noteTitleInput.value = note.title || '';
  if (richNotepad) {
    richNotepad.setContent(note.html || note.text || '');
  }
  updateNoteCounts();

  if (noteSelectComponent) {
    const opts = notes.map(n => ({ value: n.id, label: n.title || 'Untitled Note' }));
    noteSelectComponent.setOptions(opts, activeNoteId);
  }
}

function createNote(title = 'Untitled Note') {
  const newNote = {
    id: uid(),
    title: title.trim() || 'Untitled Note',
    text: '',
    html: '',
    updatedAt: Date.now()
  };
  notes.unshift(newNote);
  saveNotesImmediate();
  switchNote(newNote.id);
  if (richNotepad) richNotepad.focus();
}

async function deleteActiveNote() {
  if (notes.length <= 1) {
    const onlyNote = notes[0];
    const snapText = onlyNote.text;
    const snapHtml = onlyNote.html;
    const snapTitle = onlyNote.title;
    onlyNote.text = '';
    onlyNote.html = '';
    onlyNote.title = 'General Notes';
    onlyNote.updatedAt = Date.now();
    await saveNotesImmediate();
    switchNote(onlyNote.id);
    showBanner('Note cleared', 'Undo', () => {
      onlyNote.text = snapText;
      onlyNote.html = snapHtml;
      onlyNote.title = snapTitle;
      saveNotesImmediate();
      switchNote(onlyNote.id);
    }, 4000, 'info');
    return;
  }

  const deleted = getActiveNote();
  const deletedIdx = notes.indexOf(deleted);
  notes = notes.filter(n => n.id !== deleted.id);
  const nextNote = notes[Math.min(deletedIdx, notes.length - 1)];
  activeNoteId = nextNote.id;
  await saveNotesImmediate();
  switchNote(nextNote.id);

  showBanner(`"${deleted.title || 'Note'}" deleted`, 'Undo', () => {
    notes.splice(deletedIdx, 0, deleted);
    activeNoteId = deleted.id;
    saveNotesImmediate();
    switchNote(deleted.id);
  }, 4000, 'info');
}

async function copyActiveNote() {
  const note = getActiveNote();
  if (!note) return;
  const plain = (note.text || '').trim() || (note.title || '').trim();
  if (!plain) {
    if (noteSaveStatus) {
      noteSaveStatus.textContent = 'Empty note';
      noteSaveStatus.className = 'saving';
      setTimeout(() => {
        noteSaveStatus.textContent = 'Saved';
        noteSaveStatus.className = 'saved';
      }, 1200);
    }
    return;
  }
  await writeDualClipboard(note.html || `<p>${escapeHtml(plain)}</p>`, plain);
  if (btnCopyNote) {
    const origHtml = btnCopyNote.innerHTML;
    const origTitle = btnCopyNote.title;
    btnCopyNote.classList.add('copied-success');
    btnCopyNote.title = 'Copied';
    btnCopyNote.innerHTML = renderIcon('Check', { size: 13, strokeWidth: 2.5 });

    if (noteSaveStatus) {
      noteSaveStatus.textContent = 'Copied';
      noteSaveStatus.className = 'saved';
    }

    setTimeout(() => {
      btnCopyNote.classList.remove('copied-success');
      btnCopyNote.title = origTitle;
      btnCopyNote.innerHTML = origHtml;
      if (noteSaveStatus) {
        noteSaveStatus.textContent = 'Saved';
        noteSaveStatus.className = 'saved';
      }
    }, 1200);
  }
}

function initNoteSelect() {
  if (!noteSelectMount) return;
  const opts = notes.map(n => ({ value: n.id, label: n.title || 'Untitled Note' }));
  noteSelectComponent = new CreatableSelect(noteSelectMount, {
    options: opts,
    value: activeNoteId,
    placeholder: 'Search or new note...',
    onChange: (val) => {
      switchNote(val);
    },
    onCreate: (opt) => {
      createNote(opt.label);
    }
  });
}

function openNotesView() {
  notesView.style.display = 'flex';
  initRichNotepadInstance();
  switchNote(activeNoteId);
  if (richNotepad) richNotepad.focus();
}

function closeNotesView() {
  notesView.style.display = 'none';
}

if (btnNotes) btnNotes.onclick = openNotesView;
if (btnBackNotes) btnBackNotes.onclick = closeNotesView;
if (btnNewNote) btnNewNote.onclick = () => createNote('Untitled Note');
if (btnCopyNote) btnCopyNote.onclick = copyActiveNote;
if (btnDeleteNote) btnDeleteNote.onclick = deleteActiveNote;

if (noteTitleInput) {
  noteTitleInput.addEventListener('input', () => {
    const note = getActiveNote();
    if (!note) return;
    note.title = noteTitleInput.value.trim() || 'Untitled Note';
    note.updatedAt = Date.now();
    scheduleSaveNotes();
    if (noteSelectComponent) {
      const opts = notes.map(n => ({ value: n.id, label: n.title || 'Untitled Note' }));
      noteSelectComponent.setOptions(opts, activeNoteId);
    }
  });
}

/* ==========================================================================
   Initialization
   ========================================================================== */
async function init() {
  logger.initGlobalHandlers();
  initIcons();

  const loadedTypes = await Storage.get('vpad.types', null);
  if (Array.isArray(loadedTypes) && loadedTypes.length > 0) {
    types = loadedTypes;
  } else {
    types = defaultVettingTypes();
    await Storage.set('vpad.types', types);
  }

  const loadedSettings = await Storage.get('vpad.settings', null);
  if (loadedSettings) settings = Object.assign(settings, loadedSettings);

  await loadNotes();
  initNoteSelect();

  activeTypeId = await Storage.get('vpad.active', null);
  if (!activeTypeId || activeTypeId === 'undecided' || !types.some(t => t.id === activeTypeId)) {
    activeTypeId = types[0] ? types[0].id : null;
  }

  applyTheme(settings.theme || 'auto');
  initTypeSelect();
  await loadNotesMaxLines();
  renderForm();
  updateCommentInput();
  await initCallPad();
  initMenu();
  await loadQuickTemplates();



  initQuickSmsSearch();
  document.querySelectorAll<HTMLElement>('.view-sub').forEach(v => {
    v.scrollLeft = 0;
    v.addEventListener('scroll', () => {
      if (v.scrollLeft !== 0) v.scrollLeft = 0;
    });
  });

  clearCallpadOnClear = Boolean(await Storage.get('vpad.clear_callpad_on_clear', false));
  await initBreakNotifier();
  await checkClipboardForVetting();
}

init();

