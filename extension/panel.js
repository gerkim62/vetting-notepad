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

const saveTypes = () => { Storage.set('vpad.types', types); Storage.set('vpad.active', activeTypeId); };
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
   Minimal Toast Shelf
   ========================================================================== */
const toastShelf = document.getElementById('toastShelf');

function showToast(message, actionLabel = null, actionCallback = null, durationMs = 3000, type = 'normal') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'warn' ? 'toast-warn' : type === 'danger' ? 'toast-danger' : ''}`;
  
  const msgEl = document.createElement('div');
  msgEl.className = 'toast-msg';
  msgEl.innerHTML = message;
  toast.appendChild(msgEl);

  if (actionLabel && actionCallback) {
    const btn = document.createElement('button');
    btn.className = 'toast-btn';
    btn.textContent = actionLabel;
    btn.onclick = (e) => {
      e.stopPropagation();
      actionCallback();
      toast.remove();
    };
    toast.appendChild(btn);
  }

  toastShelf.appendChild(toast);

  if (durationMs > 0) {
    setTimeout(() => {
      if (toast.isConnected) {
        toast.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-4px)';
        setTimeout(() => toast.remove(), 200);
      }
    }, durationMs);
  }
  return toast;
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
      let line = `${it.label}: ${val}`;
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
  if (autoClearTimer) {
    clearInterval(autoClearTimer);
    autoClearTimer = null;
  }
  autoClearSeconds = 0;
  btnClear.classList.remove('countdown-active');
  clearBtnText.textContent = 'Clear';
}

function startAutoClear(typeId) {
  stopAutoClear();
  if (!settings.autoClear || settings.autoClear <= 0) return;

  autoClearSeconds = settings.autoClear;
  btnClear.classList.add('countdown-active');
  clearBtnText.textContent = `Cancel (${autoClearSeconds}s)`;

  autoClearTimer = setInterval(() => {
    autoClearSeconds--;
    if (autoClearSeconds <= 0) {
      stopAutoClear();
      formValues[typeId] = {};
      itemStatus[typeId] = {};
      renderForm();
      updateCommentInput();
      syncPreview();
    } else {
      clearBtnText.textContent = `Cancel (${autoClearSeconds}s)`;
    }
  }, 1000);
}

btnClear.onclick = () => {
  if (autoClearTimer) {
    stopAutoClear();
    return;
  }

  const v = curValues();
  if (!Object.values(v).some(x => x && x.trim())) {
    return;
  }

  const snapVal = Object.assign({}, v);
  const snapStatus = Object.assign({}, curStatus());

  formValues[activeTypeId] = {};
  itemStatus[activeTypeId] = {};
  stopAutoClear();
  renderForm();
  updateCommentInput();
  syncPreview();

  showToast('Details cleared', 'Undo', () => {
    formValues[activeTypeId] = snapVal;
    itemStatus[activeTypeId] = snapStatus;
    renderForm();
    updateCommentInput();
    syncPreview();
  }, 4000);
};

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
    html += `<div class="subtle-divider">Additional Items</div>`;
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

  return `
    <div class="item-row ${kind}" data-id="${it.id}">
      <div class="field-container">
        <div class="material-field ${isExpanded ? 'expanded' : ''} ${isFilled ? 'has-value' : ''} ${st ? 'status-' + st : ''}">
          <label class="mat-label" for="inp_${it.id}">
            ${escapeHtml(it.label)}${isMandatory ? ' <span class="req-mark" title="Required">*</span>' : ''}
          </label>
          ${it.len > 0 ? `<span class="field-counter" id="cnt_${it.id}"></span>` : ''}
          <input type="text" class="mat-input ${it.len > 0 ? 'has-len' : ''}" id="inp_${it.id}" data-id="${it.id}" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">
          ${underlineHtml}
        </div>
      </div>

      <!-- Pass / Fail Action Icons: Flag ⚑ and Check ✓ -->
      <div class="status-actions">
        <button type="button" class="pf-btn fail ${st === 'failed' ? 'active' : ''}" data-status-btn="failed" data-id="${it.id}" title="Flag as Failed" aria-label="Flag ${escapeHtml(it.label)} as Failed">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
            <line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
        </button>
        <button type="button" class="pf-btn pass ${st === 'passed' ? 'active' : ''}" data-status-btn="passed" data-id="${it.id}" title="Mark as Passed" aria-label="Mark ${escapeHtml(it.label)} as Passed">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12 5 5L20 7"/>
          </svg>
        </button>
      </div>

      <button type="button" class="paste-btn" data-paste-id="${it.id}" title="Paste from clipboard" aria-label="Paste ${escapeHtml(it.label)}">
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
   Comment Handling & Datalist Autocomplete
   ========================================================================== */
const commentInput = document.getElementById('commentInput');
const commentFieldBox = document.getElementById('commentFieldBox');
const commentSuggestions = document.getElementById('commentSuggestions');

commentInput.addEventListener('focus', () => {
  commentFieldBox.classList.add('is-focused', 'expanded');
});
commentInput.addEventListener('blur', () => {
  commentFieldBox.classList.remove('is-focused');
  if (commentInput.value.trim().length === 0) {
    commentFieldBox.classList.remove('expanded');
  }
});
commentInput.addEventListener('input', () => {
  stopAutoClear();
  curValues()._comment = commentInput.value;
  const hasVal = commentInput.value.length > 0;
  commentFieldBox.classList.toggle('has-value', hasVal);
  commentFieldBox.classList.toggle('expanded', hasVal || document.activeElement === commentInput);
  syncPreview();
});
commentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    doCopy();
  }
});

function updateCommentInput() {
  const v = curValues()._comment || '';
  commentInput.value = v;
  const hasVal = v.length > 0;
  commentFieldBox.classList.toggle('has-value', hasVal);
  commentFieldBox.classList.toggle('expanded', hasVal || document.activeElement === commentInput);
  commentSuggestions.innerHTML = savedComments.map(c => `<option value="${escapeHtml(c)}">`).join('');
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
      <span>Required Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Fixed Order</span>
    </div>
    <div id="editReqList">
      ${t.required.map((it, i) => createEditRowHtml(it, 'required', i, t.required.length)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddReq">+ Add Required Item</button>

    <div class="section-head" style="margin-top:14px;">
      <span>Optional Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Use ▲▼ or Alt+↑/↓ to Reorder</span>
    </div>
    <div id="editOptList">
      ${t.optional.map((it, i) => createEditRowHtml(it, 'optional', i, t.optional.length)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddOpt">+ Add Optional Item</button>

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
      <input type="text" class="el-label" value="${escapeHtml(it.label)}" placeholder="Label name">
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

  const commentList = document.getElementById('savedCommentList');
  document.getElementById('commentCountBadge').textContent = `${savedComments.length} saved`;

  if (savedComments.length === 0) {
    commentList.innerHTML = `<div style="color:var(--text-dim);font-style:italic;font-size:10.5px;">No saved comments yet</div>`;
  } else {
    commentList.innerHTML = savedComments.map((c, i) => `
      <div class="comment-item">
        <span title="${escapeHtml(c)}">${escapeHtml(c)}</span>
        <button class="ibtn" data-del-comment="${i}" style="width:18px;height:18px;color:var(--color-danger);" title="Delete comment">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `).join('');

    commentList.querySelectorAll('[data-del-comment]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.delComment, 10);
        savedComments.splice(idx, 1);
        saveComments();
        renderSettingsView();
        updateCommentInput();
      };
    });
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
