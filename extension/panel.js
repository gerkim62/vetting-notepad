/**
 * Vetting Notepad — Chrome Extension Controller
 * Ultra-compact, fast, KISS, lightweight.
 */
(() => {
'use strict';

const uid = () => Math.random().toString(36).slice(2, 8);

const Storage = {
  async get(key, fallback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const res = await chrome.storage.local.get(key);
        return res[key] !== undefined ? res[key] : fallback;
      } catch (e) {
        return fallback;
      }
    }
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  async set(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ [key]: value });
        return;
      } catch (e) {}
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  },
  async setMultiple(obj) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set(obj);
        return;
      } catch (e) {}
    }
    try {
      for (const [k, v] of Object.entries(obj)) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    } catch (e) {}
  }
};

function defaultVettingTypes() {
  return [
    {
      id: 'swap',
      name: 'SIM Swap',
      required: [
        { id: uid(), label: 'Full Name', len: 0 },
        { id: uid(), label: 'ID Number', len: 8 },
        { id: uid(), label: 'Line Number', len: 10 }
      ],
      optional: [
        { id: uid(), label: 'Alt Number', len: 10 },
        { id: uid(), label: 'Date of Birth', len: 10 },
        { id: uid(), label: 'Last Top-up Amount', len: 0 },
        { id: uid(), label: 'Last Top-up Time', len: 0 },
        { id: uid(), label: 'Recent Call Contact', len: 10 },
        { id: uid(), label: 'Home Location', len: 0 }
      ]
    },
    {
      id: 'puk',
      name: 'PUK',
      required: [
        { id: uid(), label: 'Full Name', len: 0 },
        { id: uid(), label: 'ID Number', len: 8 },
        { id: uid(), label: 'Line Number', len: 10 }
      ],
      optional: [
        { id: uid(), label: 'Alt Number', len: 10 },
        { id: uid(), label: 'Date of Birth', len: 10 },
        { id: uid(), label: 'Last Top-up Amount', len: 0 }
      ]
    },
    {
      id: 'reversal',
      name: 'Reversal',
      required: [
        { id: uid(), label: 'Full Name', len: 0 },
        { id: uid(), label: 'ID Number', len: 8 },
        { id: uid(), label: 'Line Number', len: 10 }
      ],
      optional: [
        { id: uid(), label: 'Transaction Ref', len: 10 },
        { id: uid(), label: 'Amount', len: 0 },
        { id: uid(), label: 'Date & Time', len: 0 },
        { id: uid(), label: 'Recipient Number', len: 10 }
      ]
    }
  ];
}

let types = [];
let settings = { theme: 'auto', autoClear: 0 };
let savedComments = [
  'Vetted and Line Swapped',
  'Vetted, PUK issued to customer',
  'Reversal initiated upon verification'
];
let activeTypeId = '';
let formValues = {};
let itemStatus = {};
let previewOpen = false;
let autoClearTimer = null;
let autoClearSeconds = 0;

const curType = () => types.find(t => t.id === activeTypeId) || types[0];
const curValues = () => (formValues[activeTypeId] || (formValues[activeTypeId] = {}));
const curStatus = () => (itemStatus[activeTypeId] || (itemStatus[activeTypeId] = {}));

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme;
  Storage.set('vpad.settings', settings);
}

const saveTypes = () => { Storage.setMultiple({ 'vpad.types': types, 'vpad.active': activeTypeId }); };
const saveSettings = () => { Storage.set('vpad.settings', settings); };
const saveComments = () => { Storage.set('vpad.comments', savedComments); };

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
            <svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
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
      this.isOpen ? this.close() : this.open();
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
    const i = label.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return CreatableSelect.esc(label);
    return CreatableSelect.esc(label.slice(0, i)) + '<mark>' + CreatableSelect.esc(label.slice(i, i + q.length)) + '</mark>' + CreatableSelect.esc(label.slice(i + q.length));
  }

  static esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  render() {
    if (!this.isOpen) return;
    const q = this.q.trim().toLowerCase();
    this.items = this.opts.filter(o => !q || o.label.toLowerCase().includes(q)).map(o => ({ o }));
    const exact = this.opts.some(o => o.label.toLowerCase() === q);
    if (q && !exact) {
      this.items.push({ create: this.q.trim() });
    }

    this.idx = Math.min(this.idx, Math.max(this.items.length - 1, 0));
    const tick = '<svg class="tick" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

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
      this.o.onCreate && this.o.onCreate(o);
    }
    this.val = o.value;
    this.close();
    this.sync();
    this.o.onChange && this.o.onChange(this.val, this);
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

let bannerTimer = null;

function showBanner(message, actionLabel = null, actionCallback = null, durationMs = 3500, type = 'info') {
  if (!topBanner) return;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  topBanner.className = `top-banner banner-${type}`;
  topBannerMsg.textContent = message;

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
  void topBanner.offsetWidth; // trigger reflow for shake animation
  topBanner.style.animation = 'bannerShake 0.4s ease-in-out';

  if (durationMs > 0) {
    bannerTimer = setTimeout(() => {
      hideBanner();
    }, durationMs);
  }
}

function hideBanner() {
  if (!topBanner) return;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  topBanner.style.display = 'none';
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
function buildCopyText(t) {
  const v = curValues();
  const st = curStatus();
  const lines = [];

  const c = (v._comment || '').trim();
  if (c) lines.push(c);

  const allItems = [...t.required, ...t.optional];
  for (const it of allItems) {
    const val = (v[it.id] || '').trim();
    if (val) {
      const { copy: copyLabel } = parseLabel(it.label);
      let line = `${copyLabel}: ${val}`;
      if (st[it.id] === 'passed') line += ' (Passed)';
      else if (st[it.id] === 'failed') line += ' (Failed)';
      lines.push(line);
    }
  }

  return lines.join('\n');
}

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
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

  autoClearTimer = setInterval(() => {
    autoClearSeconds--;
    if (autoClearSeconds <= 0) {
      stopAutoClear();
      formValues[typeId] = {};
      itemStatus[typeId] = {};
      renderForm();
      updateCommentInput();
      syncPreview();
      showClearedFeedback();
    } else {
      clearBtnText.textContent = `Clear (${autoClearSeconds}s)`;
      if (topBannerMsg) {
        topBannerMsg.textContent = `Clearing in ${autoClearSeconds}s...`;
      }
    }
  }, 1000);
}

btnClear.onclick = () => {
  stopAutoClear();

  const v = curValues();
  const st = curStatus();
  if (!Object.values(v).some(x => x && x.trim()) && !Object.values(st).some(Boolean)) {
    return;
  }

  const snapVal = Object.assign({}, v);
  const snapStatus = Object.assign({}, st);

  formValues[activeTypeId] = {};
  itemStatus[activeTypeId] = {};
  renderForm();
  updateCommentInput();
  syncPreview();

  showClearedFeedback();

  showBanner('Details cleared', 'Undo', () => {
    formValues[activeTypeId] = snapVal;
    itemStatus[activeTypeId] = snapStatus;
    renderForm();
    updateCommentInput();
    syncPreview();
  }, 4000, 'info');
};

function showClearedFeedback() {
  const originalHtml = btnClear.innerHTML;
  btnClear.classList.add('cleared-success');
  btnClear.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>
    <span>Cleared</span>
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

function renderForm() {
  const t = curType();
  if (!t) return;

  let html = '';

  t.required.forEach((it, idx) => {
    html += createRowHtml(it, 'mandatory', idx);
  });

  if (t.optional.length > 0) {
    html += `<div class="subtle-divider">Secondary</div>`;
    t.optional.forEach((it, idx) => {
      html += createRowHtml(it, 'optional', idx);
    });
  }

  mainForm.innerHTML = html;
  bindFormEvents();
  syncAllGuides();
  syncPreview();
}

function createRowHtml(it, kind, idx) {
  const val = curValues()[it.id] || '';
  const isFilled = val.length > 0;
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
    ? `${escapeHtml(lblMain)} <span class="mat-label-hint">(${escapeHtml(lblHint)})</span>`
    : escapeHtml(lblMain);
  const lblTitle = lblHint ? `${lblMain} (${lblHint})` : lblMain;

  return `
    <div class="item-row ${kind}" data-id="${it.id}">
      <div class="field-container">
        <div class="material-field ${isExpanded ? 'expanded' : ''} ${isFilled ? 'has-value' : ''} ${st ? 'status-' + st : ''}">
          <label class="mat-label" for="inp_${it.id}" title="${escapeHtml(lblTitle)}">
            ${lblDisplay}${isMandatory ? ' <span class="req-mark" title="Required">*</span>' : ''}
          </label>
          ${it.len > 0 ? `<span class="field-counter" id="cnt_${it.id}"></span>` : ''}
          <input type="text" class="mat-input ${it.len > 0 ? 'has-len' : ''}" id="inp_${it.id}" data-id="${it.id}" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">
          ${underlineHtml}
        </div>
      </div>

      <!-- Pass / Fail Action Icons: Ban ⊘ and Check ✓ -->
      <div class="status-actions">
        <button type="button" class="pf-btn fail ${st === 'failed' ? 'active' : ''}" data-status-btn="failed" data-id="${it.id}" title="Mark as Failed" aria-label="Mark ${escapeHtml(lblMain)} as Failed">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </button>
        <button type="button" class="pf-btn pass ${st === 'passed' ? 'active' : ''}" data-status-btn="passed" data-id="${it.id}" title="Mark as Passed" aria-label="Mark ${escapeHtml(lblMain)} as Passed">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12 5 5L20 7"/>
          </svg>
        </button>
      </div>

      <button type="button" class="paste-btn" data-paste-id="${it.id}" title="Paste from clipboard" aria-label="Paste ${escapeHtml(lblMain)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
      </button>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

  const row = mainForm.querySelector(`.item-row[data-id="${itemId}"]`);
  if (!row) return;

  const input = row.querySelector('.mat-input');
  const fieldBox = row.querySelector('.material-field');
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
      updateRowGuide(id);
      syncPreview();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
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

  mainForm.querySelectorAll('[data-status-btn]').forEach(btn => {
    btn.onclick = () => {
      stopAutoClear();
      const id = btn.dataset.id;
      const targetStatus = btn.dataset.statusBtn;
      const cur = curStatus()[id];

      const newStatus = cur === targetStatus ? null : targetStatus;
      curStatus()[id] = newStatus;

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

      row.querySelectorAll('.pf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.statusBtn === newStatus);
      });

      syncPreview();
    };
  });

  mainForm.querySelectorAll('.paste-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.pasteId;
      const input = mainForm.querySelector(`.mat-input[data-id="${id}"]`);
      if (!input) return;
      try {
        const text = (await navigator.clipboard.readText()).replace(/\s*[\r\n]+\s*/g, ' ').trim();
        input.value = text;
        curValues()[id] = text;
        stopAutoClear();
        const box = input.closest('.material-field');
        if (box) box.classList.add('expanded');
        updateRowGuide(id);
        syncPreview();
        input.focus();

        input.style.transition = 'background 0.2s ease';
        input.style.background = 'var(--saf-emerald-soft)';
        setTimeout(() => { input.style.background = 'transparent'; }, 400);
      } catch (err) {
        showToast('Clipboard access denied', null, null, 2500, 'warn');
        input.focus();
      }
    };
  });
}

/* ==========================================================================
   Comment Handling & Suggestions Dropdown with Instant Deletion
   ========================================================================== */
const commentInput = document.getElementById('commentInput');
const commentFieldBox = document.getElementById('commentFieldBox');
const commentSuggestionsMenu = document.getElementById('commentSuggestionsMenu');

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
  currentFilteredSuggestions = q
    ? savedComments.filter(c => c.toLowerCase().includes(q))
    : [...savedComments];

  if (currentFilteredSuggestions.length === 0) {
    closeCommentSuggestions();
    return;
  }

  activeSuggestionIdx = -1;
  commentSuggestionsMenu.innerHTML = currentFilteredSuggestions.map((c, idx) => `
    <li role="option" data-idx="${idx}" data-val="${escapeHtml(c)}">
      <span class="cs-text" title="${escapeHtml(c)}">${highlightCommentMatch(c, filterQuery.trim())}</span>
      <button type="button" class="cs-del" data-del-comment="${escapeHtml(c)}" title="Remove this suggestion" aria-label="Delete ${escapeHtml(c)}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
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
      const idx = savedComments.indexOf(commentToDelete);
      if (idx !== -1) {
        savedComments.splice(idx, 1);
        saveComments();
        renderCommentSuggestions(commentInput.value);
        showToast('Comment deleted', null, null, 1500, 'info');
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
}

const btnCopy = document.getElementById('btnCopy');
const copyBtnText = document.getElementById('copyBtnText');

async function doCopy() {
  const t = curType();
  const text = buildCopyText(t);
  if (!text) {
    showToast('Nothing to copy. Fill in some details first.', null, null, 2500, 'warn');
    return;
  }

  const ok = await writeToClipboard(text);
  if (!ok) {
    showToast('Copy failed. Clipboard error.', null, null, 2500, 'danger');
    return;
  }

  const c = (curValues()._comment || '').trim();
  if (c && !savedComments.includes(c)) {
    savedComments.unshift(c);
    if (savedComments.length > 20) savedComments.pop();
    saveComments();
    updateCommentInput();
  }

  btnCopy.classList.add('copied-success');
  copyBtnText.textContent = 'Copied ✓';
  setTimeout(() => {
    btnCopy.classList.remove('copied-success');
    copyBtnText.textContent = 'Copy';
  }, 1400);

  startAutoClear(t.id);
}
btnCopy.onclick = doCopy;

/* ==========================================================================
   Mount CreatableSelect for Vetting Types
   ========================================================================== */
const typeSelectMount = document.getElementById('typeSelectMount');
let typeSelectComponent = null;

function initTypeSelect() {
  typeSelectComponent = new CreatableSelect(typeSelectMount, {
    options: types.map(t => ({ value: t.id, label: t.name })),
    value: activeTypeId,
    placeholder: 'Vetting type...',
    onChange: (val) => {
      activeTypeId = val;
      saveTypes();
      stopAutoClear();
      renderForm();
      updateCommentInput();
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
      activeTypeId = newTypeObj.id;
      saveTypes();
      renderForm();
      updateCommentInput();
      openEditView();
    }
  });
}

function refreshTypeSelect() {
  if (typeSelectComponent) {
    typeSelectComponent.setOptions(types.map(t => ({ value: t.id, label: t.name })), activeTypeId);
  }
}

/* ==========================================================================
   Edit Vetting Items Screen
   ========================================================================== */
const editView = document.getElementById('editView');
const btnEditType = document.getElementById('btnEditType');
const btnBackEdit = document.getElementById('btnBackEdit');
const editPane = document.getElementById('editPane');

btnEditType.onclick = () => openEditView();
btnBackEdit.onclick = () => closeEditView();

function openEditView() {
  editView.style.display = 'flex';
  renderEditView();
}
function closeEditView() {
  editView.style.display = 'none';
  saveTypes();
  refreshTypeSelect();
  renderForm();
}

function renderEditView() {
  const t = curType();
  let html = `
    <div class="section-head" style="margin-top:0;">Vetting Type Name</div>
    <div class="material-field has-value" style="margin-bottom:10px;">
      <input type="text" class="mat-input" id="editTypeName" value="${escapeHtml(t.name)}" placeholder="e.g. SIM Swap">
      <div class="mat-underline-continuous" style="height:2px;background:var(--saf-emerald)"></div>
    </div>

    <div class="section-head">
      <span>Primary Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Fixed Order</span>
    </div>
    <div id="editReqList">
      ${t.required.map((it, i) => createEditRowHtml(it, 'required', i, t.required.length)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddReq">+ Add Primary Item</button>

    <div class="section-head" style="margin-top:14px;">
      <span>Secondary Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Use ▲▼ or Alt+↑/↓ to Reorder</span>
    </div>
    <div id="editOptList">
      ${t.optional.map((it, i) => createEditRowHtml(it, 'optional', i, t.optional.length)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddOpt">+ Add Secondary Item</button>

    <button class="btn-action" id="btnDeleteType" style="width:100%;margin-top:20px;color:var(--color-danger);border-color:var(--border-line);">
      Delete this Vetting Type
    </button>
  `;

  editPane.innerHTML = html;
  bindEditEvents();
}

function createEditRowHtml(it, kind, idx, total) {
  return `
    <div class="edit-row" data-id="${it.id}" data-kind="${kind}">
      <div class="arrows-col">
        <button type="button" class="arr-btn" data-move="-1" title="Move Up (Alt+↑)" aria-label="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="arr-btn" data-move="1" title="Move Down (Alt+↓)" aria-label="Move Down" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <input type="text" class="el-label" value="${escapeHtml(it.label)}" placeholder="Label // hint" title="Label name (use // for uncopied hint, e.g. Name // If 3rd Party)">
      <input type="number" class="el-len" value="${it.len || ''}" placeholder="len" title="Guide length in characters">
      <button type="button" class="ibtn" data-del="true" title="Remove item" style="width:20px;height:20px;color:var(--color-danger);">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
}

function bindEditEvents() {
  const t = curType();
  const nameInput = document.getElementById('editTypeName');
  nameInput.oninput = () => {
    t.name = nameInput.value || 'Untitled';
    saveTypes();
    refreshTypeSelect();
  };

  editPane.onclick = (e) => {
    const row = e.target.closest('.edit-row');
    if (!row) {
      if (e.target.id === 'btnAddReq') {
        t.required.push({ id: uid(), label: 'New Required', len: 0 });
        renderEditView();
      } else if (e.target.id === 'btnAddOpt') {
        t.optional.push({ id: uid(), label: 'New Optional', len: 0 });
        renderEditView();
      } else if (e.target.id === 'btnDeleteType') {
        if (types.length <= 1) {
          showToast('Cannot delete the last vetting type', null, null, 2500, 'warn');
          return;
        }
        if (confirm(`Delete "${t.name}"?`)) {
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

    const kind = row.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const itemId = row.dataset.id;
    const idx = list.findIndex(x => x.id === itemId);

    if (e.target.closest('[data-del]')) {
      list.splice(idx, 1);
      renderEditView();
    } else if (e.target.closest('[data-move]')) {
      const step = parseInt(e.target.closest('[data-move]').dataset.move, 10);
      const targetIdx = idx + step;
      if (targetIdx >= 0 && targetIdx < list.length) {
        [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
        saveTypes();
        renderEditView();
        const newRow = editPane.querySelector(`.edit-row[data-id="${itemId}"]`);
        if (newRow) {
          const btn = newRow.querySelector(`[data-move="${step}"]`) || newRow.querySelector('.arr-btn');
          if (btn && !btn.disabled) btn.focus();
        }
      }
    }
  };

  // Keyboard reordering: Alt+↑ / Alt+↓ anywhere on row, plain ↑ / ↓ on arr-btn
  editPane.onkeydown = (e) => {
    const row = e.target.closest('.edit-row');
    if (!row) return;

    const isAltUp = e.altKey && e.key === 'ArrowUp';
    const isAltDown = e.altKey && e.key === 'ArrowDown';
    const isArrBtn = e.target.classList.contains('arr-btn');
    const isPlainUp = isArrBtn && e.key === 'ArrowUp';
    const isPlainDown = isArrBtn && e.key === 'ArrowDown';

    if (isAltUp || isAltDown || isPlainUp || isPlainDown) {
      e.preventDefault();
      const step = (isAltUp || isPlainUp) ? -1 : 1;
      const kind = row.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const itemId = row.dataset.id;
      const idx = list.findIndex(x => x.id === itemId);
      const targetIdx = idx + step;

      if (targetIdx >= 0 && targetIdx < list.length) {
        [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
        saveTypes();
        renderEditView();
        const newRow = editPane.querySelector(`.edit-row[data-id="${itemId}"]`);
        if (newRow) {
          if (isArrBtn) {
            const btn = newRow.querySelector(`[data-move="${step}"]`) || newRow.querySelector('.arr-btn');
            if (btn && !btn.disabled) btn.focus();
          } else {
            const cls = e.target.className.split(' ')[0];
            const el = cls ? newRow.querySelector(`.${cls}`) : null;
            if (el) el.focus();
            else newRow.querySelector('.el-label')?.focus();
          }
        }
      }
    }
  };

  editPane.oninput = (e) => {
    const row = e.target.closest('.edit-row');
    if (!row) return;
    const kind = row.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const item = list.find(x => x.id === row.dataset.id);
    if (!item) return;

    if (e.target.classList.contains('el-label')) item.label = e.target.value;
    else if (e.target.classList.contains('el-len')) item.len = Math.max(0, parseInt(e.target.value, 10) || 0);
    saveTypes();
  };
}

/* ==========================================================================
   Settings Screen Handlers
   ========================================================================== */
const settingsView = document.getElementById('settingsView');
const btnSettings = document.getElementById('btnSettings');
const btnBackSettings = document.getElementById('btnBackSettings');

btnSettings.onclick = () => {
  settingsView.style.display = 'flex';
  renderSettingsView();
};
btnBackSettings.onclick = () => {
  settingsView.style.display = 'none';
};

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

  // Export Configuration & Data
  const btnExportData = document.getElementById('btnExportData');
  if (btnExportData) {
    btnExportData.onclick = () => {
      const payload = {
        app: 'vetting-notepad',
        version: 1,
        exportedAt: new Date().toISOString(),
        types,
        settings,
        savedComments,
        activeTypeId
      };
      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vetting_notepad_config_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showBanner('Configuration exported', null, null, 2500, 'info');
    };
  }

  // Import Configuration & Data
  const btnImportData = document.getElementById('btnImportData');
  const importFileInput = document.getElementById('importFileInput');
  if (btnImportData && importFileInput) {
    btnImportData.onclick = () => {
      importFileInput.click();
    };

    importFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const confirmed = window.confirm(
        'Warning: Importing data will overwrite your current vetting types and configuration.\n\nDo you want to continue?'
      );
      if (!confirmed) {
        importFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const raw = evt.target.result;
          const data = JSON.parse(raw);
          if (!data || !Array.isArray(data.types) || data.types.length === 0) {
            throw new Error('Invalid format: types array missing');
          }

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
          console.error('Import error:', err);
          showBanner('Import failed: ' + (err.message || 'Invalid JSON file'), null, null, 3500, 'danger');
        } finally {
          importFileInput.value = '';
        }
      };
      reader.readAsText(file);
    };
  }

  document.getElementById('btnResetAll').onclick = () => {
    if (confirm('Reset all vetting types and configuration to factory defaults?')) {
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

/* ==========================================================================
   Keyboard Shortcuts
   ========================================================================== */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    doCopy();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (typeSelectComponent) {
      typeSelectComponent.open();
      typeSelectComponent.input.focus();
    }
  }
});

// Clamp minimum window width to 250px on window resize
let resizeClampTimer = null;
window.addEventListener('resize', () => {
  if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
    if (window.outerWidth < 250) {
      if (resizeClampTimer) clearTimeout(resizeClampTimer);
      resizeClampTimer = setTimeout(() => {
        chrome.windows.getCurrent((w) => {
          if (w && typeof w.width === 'number' && w.width < 250) {
            chrome.windows.update(w.id, { width: 250 });
          }
        });
      }, 50);
    }
  }
});

/* ==========================================================================
   Initialization
   ========================================================================== */
async function init() {
  const loadedTypes = await Storage.get('vpad.types', null);
  types = Array.isArray(loadedTypes) && loadedTypes.length ? loadedTypes : defaultVettingTypes();

  const loadedSettings = await Storage.get('vpad.settings', null);
  if (loadedSettings) settings = Object.assign(settings, loadedSettings);

  const loadedComments = await Storage.get('vpad.comments', null);
  if (Array.isArray(loadedComments)) savedComments = loadedComments;

  activeTypeId = await Storage.get('vpad.active', types[0].id);
  if (!types.some(t => t.id === activeTypeId)) activeTypeId = types[0].id;

  applyTheme(settings.theme || 'auto');
  initTypeSelect();
  renderForm();
  updateCommentInput();
}

init();

})();
