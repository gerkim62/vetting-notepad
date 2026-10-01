/**
 * Vetting Notepad — Chrome Extension Controller
 * Ultra-compact, fast, KISS, lightweight.
 */
import defaultConfig from './safaricom-vetting-config.json' with { type: 'json' };

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
  return JSON.parse(JSON.stringify(defaultConfig?.types || []));
}

let types = [];
let settings = { theme: 'auto', autoClear: 0 };
let callAttempt = 1;
let callPadKeys = [];
let callPadValues = {};
let notes = [];
let activeNoteId = null;
let noteSelectComponent = null;
let saveNotesTimer = null;

const curComments = () => {
  const t = curType();
  if (!t) return [];
  if (!Array.isArray(t.comments)) t.comments = [];
  return t.comments;
};
let activeTypeId = null;
let formValues = {};
let itemStatus = {};
let previewOpen = false;
let autoClearTimer = null;
let autoClearSeconds = 0;

const curType = () => types.find(t => t.id === activeTypeId) || types[0] || null;
const curValues = () => {
  const tId = activeTypeId || (types[0] ? types[0].id : 'default');
  return formValues[tId] || (formValues[tId] = {});
};
const curStatus = () => {
  const tId = activeTypeId || (types[0] ? types[0].id : 'default');
  return itemStatus[tId] || (itemStatus[tId] = {});
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
let bannerRemainingMs = 0;
let bannerStartTime = 0;
let isBannerHovered = false;

function showBanner(message, actionLabel = null, actionCallback = null, durationMs = 3500, type = 'info') {
  if (!topBanner) return;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  bannerRemainingMs = durationMs;
  bannerStartTime = Date.now();

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

  if (durationMs > 0 && !isBannerHovered) {
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
  bannerRemainingMs = 0;
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
    }
  });

  topBanner.addEventListener('mouseleave', () => {
    isBannerHovered = false;
    if (topBanner.style.display !== 'none' && bannerRemainingMs > 0) {
      bannerStartTime = Date.now();
      const resumeMs = Math.max(1000, bannerRemainingMs);
      bannerTimer = setTimeout(() => {
        hideBanner();
      }, resumeMs);
    }
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
function isVettingItem(it) {
  if (!it) return false;
  const lbl = (it.label || '').toLowerCase();
  const id = (it.id || '').toLowerCase();
  if (
    lbl.includes('calling number') ||
    lbl.includes('line to swap') ||
    lbl.includes('serial') ||
    lbl.includes('simex') ||
    lbl.includes('transaction id') ||
    lbl.includes('sr number') ||
    lbl.includes('amount') ||
    lbl.includes('alternative number') ||
    lbl.includes('reversal type') ||
    lbl.includes('wrong account') ||
    lbl.includes('correct account') ||
    it.excludeFromCount
  ) {
    return false;
  }
  return true;
}

function isPrimaryItem(it) {
  if (!it) return false;
  const lbl = (it.label || '').toLowerCase();
  return (
    it.v360 === 'fullName' ||
    it.v360 === 'idNumber' ||
    it.v360 === 'yob' ||
    lbl.includes('full name') ||
    lbl.includes('owner name') ||
    lbl.includes('id number') ||
    lbl.includes('year of birth')
  );
}

function buildCopyText(t) {
  if (!t) return '';

  const v = curValues();
  const st = curStatus();
  const lines = [];

  const title = t.copyTitle || `${t.name} – Vetting`;
  lines.push(title);

  const c = (v._comment || '').trim();
  if (c) lines.push(c);

  const allItems = [...t.required, ...t.optional];
  const seenGroups = new Set();

  for (const it of allItems) {
    if (it.group) {
      if (seenGroups.has(it.group)) continue;
      seenGroups.add(it.group);

      const groupItems = allItems.filter(x => x.group === it.group);
      const parts = [];
      for (const git of groupItems) {
        const val = (v[git.id] || '').trim();
        const isUnchangedDefault = git.defaultValue && val === git.defaultValue.trim() && !st[git.id];
        if (git.omitDefault && isUnchangedDefault) {
          continue;
        }
        if (val) {
          const { copy: copyLabel } = parseLabel(git.label);
          let str = `${copyLabel}: ${val}`;
          if (isVettingItem(git)) {
            if (st[git.id] === 'failed') str += ' (Failed)';
            else str += ' (Passed)';
          }
          parts.push(str);
        } else if (st[git.id] === 'failed') {
          const { copy: copyLabel } = parseLabel(git.label);
          parts.push(`${copyLabel}: Failed (Failed)`);
        }
      }
      if (parts.length > 0) {
        lines.push(parts.join(', '));
      }
    } else {
      const val = (v[it.id] || '').trim();
      const isUnchangedDefault = it.defaultValue && val === it.defaultValue.trim() && !st[it.id];
      if (it.omitDefault && isUnchangedDefault) {
        continue;
      }
      if (val) {
        const { copy: copyLabel } = parseLabel(it.label);
        let line = `${copyLabel}: ${val}`;
        if (isVettingItem(it)) {
          if (st[it.id] === 'failed') line += ' (Failed)';
          else line += ' (Passed)';
        }
        lines.push(line);
      } else if (st[it.id] === 'failed') {
        const { copy: copyLabel } = parseLabel(it.label);
        lines.push(`${copyLabel}: Failed (Failed)`);
      }
    }
  }

  // SAKA Failed Callback / Referral appended text
  const failedItems = allItems.filter(it => st[it.id] === 'failed');
  if (failedItems.length > 0) {
    const hasPrimaryFailed = failedItems.some(it => isPrimaryItem(it));
    if (hasPrimaryFailed) {
      lines.push('Referred to Retail Centre / Care Desk with original ID.');
    } else if (callAttempt === 2) {
      lines.push('Failed vetting again. Not asked to call back. Referred to Retail Centre / Care Desk with original ID.');
    } else {
      const failedLabels = failedItems.map(it => parseLabel(it.label).copy).join(', ');
      lines.push(`Failed vetting. Advised to confirm ${failedLabels} and call back.`);
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
  const hasCallPadValues = Object.values(callPadValues).some(x => x && x.trim());
  if (!Object.values(v).some(x => x && x.trim()) && !Object.values(st).some(Boolean) && !hasCallPadValues) {
    return;
  }

  const snapVal = JSON.parse(JSON.stringify(formValues));
  const snapStatus = JSON.parse(JSON.stringify(itemStatus));
  const snapCallPad = Object.assign({}, callPadValues);
  const snapAttempt = callAttempt;

  formValues = {};
  itemStatus = {};
  callPadValues = {};
  callAttempt = 1;

  while (callPadKeys.length > 1 && !(callPadKeys[callPadKeys.length - 1].key || '').trim()) {
    callPadKeys.pop();
  }
  saveCallPadKeys();

  renderForm();
  updateCommentInput();
  syncPreview();
  renderCallPad();

  showClearedFeedback();

  showBanner('Call cleared', 'Undo', () => {
    formValues = snapVal;
    itemStatus = snapStatus;
    callPadValues = snapCallPad;
    callAttempt = snapAttempt;
    renderForm();
    updateCommentInput();
    syncPreview();
    renderCallPad();
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
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          ${escapeHtml(cleanTitle)}
        </span>
        ${articleBadge}
      </div>
      <button type="button" class="pop-close" aria-label="Close popover">✕</button>
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
  if ((val || '').trim().length > 0) return 'passed';
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
  const allItems = [...t.required, ...t.optional];
  const failedItems = allItems.filter(it => st[it.id] === 'failed');
  if (failedItems.length === 0) return '';

  const hasPrimaryFailed = failedItems.some(it => isPrimaryItem(it));
  const failedLabels = failedItems.map(it => parseLabel(it.label).copy).join(', ');

  let contentHtml = '';
  if (hasPrimaryFailed) {
    contentHtml = `
      <div class="saka-callback-panel primary-failed">
        <div class="saka-callback-head">
          <div class="saka-callback-title" style="color:var(--color-danger);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Personal Details Failed (SAKA VMDA-0001)
          </div>
        </div>
        <div class="saka-callback-body">
          Stop vetting. Advise customer to visit <strong>Retail Centre / Care Desk</strong> with original ID. Do not probe further account details.
        </div>
      </div>
    `;
  } else {
    const isAttempt2 = callAttempt === 2;
    const bodyText = isAttempt2
      ? `Failed vetting again. Not asked to call back. Advise customer to visit <strong>Retail Centre / Care Desk</strong> with original national ID.`
      : `Advised customer to confirm <strong>${escapeHtml(failedLabels)}</strong> and call back. Details logged for callback reference.`;

    contentHtml = `
      <div class="saka-callback-panel">
        <div class="saka-callback-head">
          <div class="saka-callback-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Failed Vetting Callback (SAKA)
          </div>
          <button type="button" class="saka-attempt-pill ${isAttempt2 ? 'active' : ''}" id="btnToggleAttempt" title="Toggle 1st vs 2nd failure">
            ${isAttempt2 ? '2nd Failure' : '1st Failure'}
          </button>
        </div>
        <div class="saka-callback-body">
          ${bodyText}
        </div>
      </div>
    `;
  }
  return contentHtml;
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
const callPadClose = document.getElementById('callPadClose');
const callPadBody = document.getElementById('callPadBody');

async function initCallPad() {
  const savedKeys = await Storage.get('vpad.callpad_keys', null);
  if (Array.isArray(savedKeys) && savedKeys.length > 0) {
    callPadKeys = savedKeys;
  } else {
    callPadKeys = [
      { id: 'caller_name', key: 'Caller Name' }
    ];
  }

  const savedPos = await Storage.get('vpad.callpad_pos', null);
  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    applyFabPosition(savedPos.x, savedPos.y);
  }

  renderCallPad();
  initCallPadFabDrag();

  if (callPadOverlay) callPadOverlay.onclick = closeCallPad;
  if (callPadClose) callPadClose.onclick = closeCallPad;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && callPadPopover && callPadPopover.style.display !== 'none') {
      closeCallPad();
    }
  });
}

function saveCallPadKeys() {
  Storage.set('vpad.callpad_keys', callPadKeys);
}

function renderCallPad() {
  if (!callPadBody) return;

  if (!Array.isArray(callPadKeys) || callPadKeys.length === 0) {
    callPadKeys = [{ id: 'caller_name', key: 'Caller Name' }];
    saveCallPadKeys();
  }

  callPadBody.innerHTML = '';
  callPadKeys.forEach((item, idx) => {
    const rowEl = createCallPadRowElement(item, idx);
    callPadBody.appendChild(rowEl);
  });
}

function createCallPadRowElement(item, idx) {
  const id = item.id;
  const val = callPadValues[id] || '';
  const isCallerName = (id === 'caller_name');
  const hasContent = (item.key || '').trim().length > 0 || (val || '').trim().length > 0;
  const isLast = (idx === callPadKeys.length - 1);
  const isNewBlank = isLast && !hasContent;

  const row = document.createElement('div');
  row.className = `callpad-row ${isNewBlank ? 'new-row' : ''}`;
  row.dataset.keyId = escapeHtml(id);
  row.dataset.index = String(idx);

  row.innerHTML = `
    <div class="callpad-key-wrap">
      <input type="text" class="callpad-key-input" value="${escapeHtml(item.key)}" placeholder="Item" title="Edit label" autocomplete="off" spellcheck="false"${isCallerName ? ' readonly' : ''}>
      ${isCallerName ? '' : `
      <button type="button" class="callpad-row-btn delete-btn" title="Delete item" aria-label="Delete item" style="${hasContent ? '' : 'visibility:hidden;'}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`}
    </div>
    <div class="callpad-val-wrap">
      <input type="text" class="callpad-val-input" value="${escapeHtml(val)}" placeholder="Detail..." autocomplete="off" spellcheck="false">
      <button type="button" class="callpad-row-btn copy-btn" title="Copy detail" aria-label="Copy detail" style="${val.trim() ? '' : 'opacity:0.4;'}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>
      </button>
    </div>
  `;

  const keyInput = row.querySelector('.callpad-key-input');
  const valInput = row.querySelector('.callpad-val-input');
  const btnCopy = row.querySelector('.copy-btn');
  const btnDelete = row.querySelector('.delete-btn');

  if (keyInput) {
    keyInput.addEventListener('input', () => {
      item.key = keyInput.value;
      saveCallPadKeys();
      if (btnDelete) {
        const hc = (item.key || '').trim().length > 0 || (callPadValues[id] || '').trim().length > 0;
        btnDelete.style.visibility = hc ? 'visible' : 'hidden';
      }
    });

    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (valInput) valInput.focus();
      }
    });

    keyInput.addEventListener('blur', () => {
      handleItemBlur(item, keyInput, valInput);
    });
  }

  if (valInput) {
    valInput.addEventListener('input', () => {
      callPadValues[id] = valInput.value;
      if (btnDelete) {
        const hc = (item.key || '').trim().length > 0 || (valInput.value || '').trim().length > 0;
        btnDelete.style.visibility = hc ? 'visible' : 'hidden';
      }
      if (btnCopy) {
        btnCopy.style.opacity = valInput.value.trim() ? '1' : '0.4';
      }
    });

    valInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const nextRow = row.nextElementSibling;
        if (nextRow) {
          const nextKey = nextRow.querySelector('.callpad-key-input');
          if (nextKey) nextKey.focus();
        } else {
          const keyVal = keyInput ? keyInput.value.trim() : (item.key || '').trim();
          const valVal = valInput.value.trim();
          const hasTyped = (item.id === 'caller_name') ? (valVal.length > 0) : (keyVal.length > 0 || valVal.length > 0);
          if (hasTyped) {
            addNewCallPadRow(true);
          }
        }
      }
    });

    valInput.addEventListener('blur', () => {
      handleItemBlur(item, keyInput, valInput);
    });
  }

  if (btnCopy) {
    btnCopy.onclick = async () => {
      const textToCopy = callPadValues[id] || (valInput ? valInput.value : '');
      if (!textToCopy.trim()) return;
      await writeToClipboard(textToCopy);
      const origHtml = btnCopy.innerHTML;
      const origTitle = btnCopy.title;
      btnCopy.classList.add('copied-success');
      btnCopy.title = 'Copied ✓';
      btnCopy.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>`;
      setTimeout(() => {
        btnCopy.classList.remove('copied-success');
        btnCopy.title = origTitle;
        btnCopy.innerHTML = origHtml;
      }, 1200);
    };
  }

  if (btnDelete) {
    btnDelete.onclick = () => {
      callPadKeys = callPadKeys.filter(k => k.id !== id);
      delete callPadValues[id];
      if (callPadKeys.length === 0) {
        callPadKeys = [{ id: 'caller_name', key: 'Caller Name' }];
      }
      saveCallPadKeys();
      renderCallPad();
    };
  }

  return row;
}

function addNewCallPadRow(focusKey = false) {
  if (callPadKeys.length > 0) {
    const last = callPadKeys[callPadKeys.length - 1];
    const lastKey = (last.key || '').trim();
    const lastVal = (callPadValues[last.id] || '').trim();
    if (last.id !== 'caller_name' && !lastKey && !lastVal) {
      if (focusKey) {
        const lastRow = callPadBody?.querySelector(`.callpad-row[data-key-id="${last.id}"]`);
        const keyInp = lastRow?.querySelector('.callpad-key-input');
        if (keyInp) keyInp.focus();
      }
      return;
    }
  }

  const newId = 'k_' + Date.now();
  const newItem = { id: newId, key: '' };
  callPadKeys.push(newItem);
  saveCallPadKeys();

  if (callPadBody) {
    const newIdx = callPadKeys.length - 1;
    const rowEl = createCallPadRowElement(newItem, newIdx);
    callPadBody.appendChild(rowEl);
    if (focusKey) {
      const keyInp = rowEl.querySelector('.callpad-key-input');
      if (keyInp) keyInp.focus();
    }
  }
}

function handleItemBlur(item, keyInput, valInput) {
  if (!Array.isArray(callPadKeys) || callPadKeys.length === 0) return;
  const lastItem = callPadKeys[callPadKeys.length - 1];
  if (lastItem.id !== item.id) return;

  const keyVal = keyInput ? keyInput.value.trim() : (item.key || '').trim();
  const valVal = valInput ? valInput.value.trim() : (callPadValues[item.id] || '').trim();
  const hasTyped = (item.id === 'caller_name') ? (valVal.length > 0) : (keyVal.length > 0 || valVal.length > 0);

  if (hasTyped) {
    addNewCallPadRow(false);
  }
}

function openCallPad() {
  if (callPadPopover) callPadPopover.style.display = 'flex';
  if (callPadOverlay) callPadOverlay.style.display = 'block';
  renderCallPad();
  const firstVal = callPadBody?.querySelector('.callpad-val-input');
  if (firstVal) firstVal.focus();
}

function closeCallPad() {
  if (callPadPopover) callPadPopover.style.display = 'none';
  if (callPadOverlay) callPadOverlay.style.display = 'none';
}

function toggleCallPad() {
  if (callPadPopover && callPadPopover.style.display !== 'none') {
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

  callPadFab.addEventListener('mousedown', onPointerDown);
  callPadFab.addEventListener('touchstart', onPointerDown, { passive: false });
  callPadFab.addEventListener('click', (e) => {
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
  syncPreview();
}

function createRowHtml(it, kind, idx) {
  let val = curValues()[it.id];
  const hasStatus = !!curStatus()[it.id];
  if ((val === undefined || (val === '' && it.defaultValue && !hasStatus))) {
    val = it.defaultValue || '';
    curValues()[it.id] = val;
  }
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
    ? `<span class="mat-label-main">${escapeHtml(lblMain)}</span> <span class="mat-label-hint">(${escapeHtml(lblHint)})</span>`
    : `<span class="mat-label-main">${escapeHtml(lblMain)}</span>`;
  const lblTitle = lblHint ? `${lblMain} (${lblHint})` : lblMain;

  const infoBtnHtml = it.info ? `
    <button type="button" class="mat-info-btn" data-info-id="${it.id}" title="SAKA Guideline" aria-label="View SAKA guidelines for ${escapeHtml(lblMain)}">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    </button>
  ` : '';

  const isVetted = isVettingItem(it);
  const statusActionsHtml = isVetted ? `
    <div class="status-actions">
      <button type="button" class="pf-btn fail ${st === 'failed' ? 'active' : ''}" data-status-btn="failed" data-id="${it.id}" title="Mark as Failed" aria-label="Mark ${escapeHtml(lblMain)} as Failed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </button>
    </div>
  ` : `<div class="status-actions"></div>`;

  return `
    <div class="item-row ${kind}${it.excludeFromCount ? ' policy-only' : ''}" data-id="${it.id}">
      <div class="field-container">
        <div class="material-field ${isExpanded ? 'expanded' : ''} ${isFilled ? 'has-value' : ''} ${st ? 'status-' + st : ''}">
          <label class="mat-label" for="inp_${it.id}" title="${escapeHtml(lblTitle)}">
            <span class="mat-label-text">${lblDisplay}${isMandatory ? ' <span class="req-mark" title="Required">*</span>' : ''}</span>
            ${infoBtnHtml}
          </label>
          ${it.len > 0 ? `<span class="field-counter" id="cnt_${it.id}"></span>` : ''}
          <input type="text" class="mat-input ${it.len > 0 ? 'has-len' : ''}" id="inp_${it.id}" data-id="${it.id}" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">
          ${underlineHtml}
        </div>
      </div>

      ${statusActionsHtml}

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
      const cur = curStatus()[id];

      const newStatus = cur === 'failed' ? null : 'failed';
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

  mainForm.querySelectorAll('.paste-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.pasteId;
      const input = mainForm.querySelector(`.mat-input[data-id="${id}"]`);
      if (!input) return;
      try {
        const rawClipboard = await navigator.clipboard.readText();
        const t = curType();
        const allItems = t ? [...(t.required || []), ...(t.optional || [])] : [];
        const item = allItems.find(x => x.id === id);
        const parsedV360 = parseView360Text(rawClipboard);

        let textToPaste = '';
        let showUnmappedWarning = false;
        const previousVal = input.value;

        if (parsedV360) {
          const mapping = item ? item.v360 : null;
          if (mapping && parsedV360[mapping] !== undefined) {
            textToPaste = parsedV360[mapping] || '';
          } else {
            textToPaste = rawClipboard.replace(/\s*[\r\n]+\s*/g, ' ').trim();
            showUnmappedWarning = true;
          }
        } else {
          textToPaste = rawClipboard.replace(/\s*[\r\n]+\s*/g, ' ').trim();
        }

        input.value = textToPaste;
        curValues()[id] = textToPaste;
        stopAutoClear();
        const box = input.closest('.material-field');
        if (box) box.classList.add('expanded');
        updateRowGuide(id);
        syncPreview();
        input.focus();

        input.style.transition = 'background 0.2s ease';
        input.style.background = 'var(--saf-emerald-soft)';
        setTimeout(() => { input.style.background = 'transparent'; }, 400);

        if (showUnmappedWarning) {
          showBanner(
            'Pasted raw text (no View 360 mapping for this field)',
            'Undo',
            () => {
              input.value = previousVal;
              curValues()[id] = previousVal;
              if (box && previousVal.length === 0 && !curStatus()[id]) {
                box.classList.remove('expanded');
              }
              updateRowGuide(id);
              syncPreview();
              input.focus();
            },
            4000,
            'warn'
          );
        }
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
      const t = curType();
      if (t && Array.isArray(t.comments)) {
        const idx = t.comments.indexOf(commentToDelete);
        if (idx !== -1) {
          t.comments.splice(idx, 1);
          saveTypes();
          renderCommentSuggestions(commentInput.value);
          showToast('Comment deleted', null, null, 1500, 'info');
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
  if (c && t) {
    if (!Array.isArray(t.comments)) t.comments = [];
    if (!t.comments.includes(c)) {
      t.comments.unshift(c);
      if (t.comments.length > 20) t.comments.pop();
      saveTypes();
      updateCommentInput();
    }
  }

  btnCopy.classList.add('copied-success');
  copyBtnText.textContent = 'Copied ✓';
  setTimeout(() => {
    btnCopy.classList.remove('copied-success');
    copyBtnText.textContent = 'Copy';
  }, 1400);

  if (t) {
    startAutoClear(t.id);
  }
}
btnCopy.onclick = doCopy;

/* ==========================================================================
   Mount CreatableSelect for Vetting Types
   ========================================================================== */
const typeSelectMount = document.getElementById('typeSelectMount');
let typeSelectComponent = null;

function initTypeSelect() {
  const options = types.map(t => ({ value: t.id, label: t.name }));
  typeSelectComponent = new CreatableSelect(typeSelectMount, {
    options,
    value: activeTypeId,
    placeholder: 'Vetting type...',
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

    <button class="btn-action" id="btnDeleteType" style="width:100%;margin-top:20px;color:var(--color-danger);border-color:var(--border-line);">
      Delete this Vetting Type
    </button>
  `;

  editPane.innerHTML = html;
  bindEditEvents();
}

function createEditRowHtml(it, kind, idx, total, list) {
  const hasRich = !!(it.article || it.info || it.v360 || it.defaultValue || it.excludeFromCount);
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
        <button type="button" class="ibtn btn-toggle-drawer ${hasRich ? 'has-rich' : ''}" data-drawer-btn="${it.id}" title="Details & View 360 mapping" aria-label="Field details">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="drawer-chevron-icon"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button type="button" class="ibtn btn-tie-pair ${isTied ? 'is-tied' : ''}" data-tie-id="${it.id}" title="${isTied ? 'Tied pair (counts as 1 pass). Click to unlink.' : 'Click to tie with adjacent item as 1 pass count'}" aria-label="Tie pair">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 4h-4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4"/>
            <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
            <circle cx="8" cy="16" r="1.5" fill="currentColor"/>
          </svg>
        </button>
        <button type="button" class="ibtn" data-del="true" title="Remove item" style="width:20px;height:20px;color:var(--color-danger);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
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
          <span class="drawer-label">Default Value (Pre-fill):</span>
          <input type="text" class="el-default" value="${escapeHtml(it.defaultValue || '')}" placeholder="Optional pre-filled value">
        </div>
        <div class="drawer-field drawer-field-checkbox">
          <label class="drawer-check-label">
            <input type="checkbox" class="el-omit-default" ${it.omitDefault ? 'checked' : ''}>
            <span>Omit from copy if unchanged from default</span>
          </label>
        </div>
        <div class="drawer-field drawer-field-checkbox">
          <label class="drawer-check-label">
            <input type="checkbox" class="el-exclude-count" ${it.excludeFromCount ? 'checked' : ''}>
            <span>Policy-only (exclude from secondary count)</span>
          </label>
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

  editPane.onclick = (e) => {
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

  editPane.oninput = (e) => {
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
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue));
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
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue));
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
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue));
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
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info || item.v360 || item.defaultValue || item.excludeFromCount));
      saveTypes();
    }
  };
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

  if (btnBackSettings) {
    btnBackSettings.onclick = () => {
      if (settingsView) settingsView.style.display = 'none';
    };
  }

  if (btnBackQuickSms) {
    btnBackQuickSms.onclick = () => {
      if (quickSmsView) quickSmsView.style.display = 'none';
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
    title: 'Paybill Reversal Request',
    text: 'Dear Customer, kindly contact {ORGANIZATION} on {Phone Number} during working hours for reversal request of transaction {TXN CODE}. Thank You.'
  }
];

const DEFAULT_QUICK_INTERACTION = [];

let quickSmsTemplates = [];
let quickInteractionTemplates = [];
let rememberedTemplateVars = {};

const quickSmsListEl = document.getElementById('quickSmsList');
const quickInteractionListEl = document.getElementById('quickInteractionList');
const btnNewSmsTemplate = document.getElementById('btnNewSmsTemplate');
const btnNewInteractionTemplate = document.getElementById('btnNewInteractionTemplate');

async function loadQuickTemplates() {
  const savedSms = await Storage.get('vpad.quick_sms', null);
  if (Array.isArray(savedSms) && savedSms.length > 0) {
    quickSmsTemplates = savedSms;
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

  rememberedTemplateVars = (await Storage.get('vpad.remembered_vars', {})) || {};
}

function saveQuickSmsTemplates() {
  Storage.set('vpad.quick_sms', quickSmsTemplates);
}

function saveQuickInteractionTemplates() {
  Storage.set('vpad.quick_interaction', quickInteractionTemplates);
}

function saveRememberedVars() {
  Storage.set('vpad.remembered_vars', rememberedTemplateVars);
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

function renderTemplateCards(container, list, type) {
  if (!container) return;
  if (!list || list.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:24px 10px;font-size:11px;color:var(--text-muted);">No templates yet. Click '+' above to create one.</div>`;
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="template-card" data-template-id="${escapeHtml(item.id)}">
      <div class="template-card-header">
        <span class="template-card-title">${escapeHtml(item.title)}</span>
        <div class="template-card-actions">
          <button type="button" class="ibtn edit-tpl-btn" data-template-id="${escapeHtml(item.id)}" title="Edit template" aria-label="Edit template">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button type="button" class="ibtn del-tpl-btn" data-template-id="${escapeHtml(item.id)}" title="Delete template" aria-label="Delete template">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="template-card-body">${highlightVariables(item.text)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.template-card').forEach(card => {
    const id = card.dataset.templateId;
    const tpl = list.find(t => t.id === id);
    if (!tpl) return;

    card.onclick = (e) => {
      if (e.target.closest('.edit-tpl-btn') || e.target.closest('.del-tpl-btn')) return;
      openVarFillModal(tpl, type);
    };

    const btnEdit = card.querySelector('.edit-tpl-btn');
    if (btnEdit) {
      btnEdit.onclick = (e) => {
        e.stopPropagation();
        openTemplateEditModal(tpl, type);
      };
    }

    const btnDel = card.querySelector('.del-tpl-btn');
    if (btnDel) {
      btnDel.onclick = (e) => {
        e.stopPropagation();
        deleteTemplate(id, type);
      };
    }
  });
}

function renderQuickSmsList() {
  renderTemplateCards(quickSmsListEl, quickSmsTemplates, 'sms');
}

function renderQuickInteractionList() {
  renderTemplateCards(quickInteractionListEl, quickInteractionTemplates, 'interaction');
}

function deleteTemplate(id, type) {
  if (type === 'sms') {
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
const chkRememberVars = document.getElementById('chkRememberVars');
const btnCopyResolved = document.getElementById('btnCopyResolved');

let activeVarTemplate = null;

function resolveTemplateText(tplText, varValues) {
  if (!tplText) return '';
  return tplText.replace(/\{([^{}]+)\}/g, (match, p1) => {
    const key = p1.trim();
    return (varValues[key] !== undefined && varValues[key] !== '') ? varValues[key] : match;
  });
}

function openVarFillModal(tpl, type) {
  const vars = parseTemplateVariables(tpl.text);
  if (vars.length === 0) {
    writeToClipboard(tpl.text);
    showBanner(`Copied ${tpl.title}`, null, null, 1500, 'info');
    return;
  }

  activeVarTemplate = tpl;
  if (varFillTitle) varFillTitle.textContent = tpl.title;
  if (varFillOverlay) varFillOverlay.style.display = 'block';
  if (varFillModal) varFillModal.style.display = 'flex';

  const currentValues = {};
  vars.forEach(v => {
    currentValues[v] = rememberedTemplateVars[v] || '';
  });

  const updatePreview = () => {
    if (varPreviewText) {
      varPreviewText.textContent = resolveTemplateText(tpl.text, currentValues);
    }
  };

  if (varInputsList) {
    varInputsList.innerHTML = vars.map(v => `
      <div class="var-input-row" data-var-name="${escapeHtml(v)}">
        <label class="var-input-label">${escapeHtml(v)}</label>
        <div class="var-input-field-wrap">
          <input type="text" class="var-input" value="${escapeHtml(currentValues[v])}" placeholder="Enter ${escapeHtml(v)}..." autocomplete="off" spellcheck="false">
          <button type="button" class="var-paste-btn" title="Paste from clipboard">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    varInputsList.querySelectorAll('.var-input-row').forEach(row => {
      const v = row.dataset.varName;
      const inp = row.querySelector('.var-input');
      const btnPaste = row.querySelector('.var-paste-btn');

      if (inp) {
        inp.oninput = () => {
          currentValues[v] = inp.value;
          updatePreview();
        };
      }

      if (btnPaste) {
        btnPaste.onclick = async () => {
          try {
            const clipText = await navigator.clipboard.readText();
            if (clipText && inp) {
              inp.value = clipText.trim();
              currentValues[v] = inp.value;
              updatePreview();
            }
          } catch (err) {
            console.error('Clipboard paste failed:', err);
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
      const resolved = resolveTemplateText(tpl.text, currentValues);
      await writeToClipboard(resolved);

      if (chkRememberVars && chkRememberVars.checked) {
        vars.forEach(v => {
          rememberedTemplateVars[v] = currentValues[v] || '';
        });
      } else {
        vars.forEach(v => {
          delete rememberedTemplateVars[v];
        });
      }
      saveRememberedVars();

      const origHtml = btnCopyResolved.innerHTML;
      btnCopyResolved.classList.add('copied-success');
      btnCopyResolved.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg><span>Copied ✓</span>`;
      setTimeout(() => {
        btnCopyResolved.classList.remove('copied-success');
        btnCopyResolved.innerHTML = origHtml;
        closeVarFillModal();
      }, 700);
    };
  }
}

function closeVarFillModal() {
  if (varFillOverlay) varFillOverlay.style.display = 'none';
  if (varFillModal) varFillModal.style.display = 'none';
  activeVarTemplate = null;
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

  if (templateEditOverlay) templateEditOverlay.style.display = 'block';
  if (templateEditModal) templateEditModal.style.display = 'flex';
  if (templateTitleInput) setTimeout(() => templateTitleInput.focus(), 50);
}

function closeTemplateEditModal() {
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

const chkNotifyDesktop = document.getElementById('chkNotifyDesktop');
const chkNotifyToast = document.getElementById('chkNotifyToast');

const breakEventTitle = document.getElementById('breakEventTitle');
const breakEventTag = document.getElementById('breakEventTag');
const breakCountdownBig = document.getElementById('breakCountdownBig');
const breakProgressBar = document.getElementById('breakProgressBar');
const breakStatusSub = document.getElementById('breakStatusSub');

const DEFAULT_BREAK_SCHEDULE = {
  break1: '10:00', // 10 min
  lunch: '13:00',  // 40 min
  break2: '16:00', // 10 min
  shiftEnd: '18:00',
  notifyDesktop: false,
  notifyToast: true
};

let breakSchedule = Object.assign({}, DEFAULT_BREAK_SCHEDULE);
let lastNotifiedEventKey = null;

async function initBreakNotifier() {
  const saved = await Storage.get('vpad.break_schedule', null);
  if (saved && typeof saved === 'object') {
    breakSchedule = Object.assign({}, DEFAULT_BREAK_SCHEDULE, saved);
  }

  if (break1StartInput) break1StartInput.value = breakSchedule.break1 || '';
  if (lunchStartInput) lunchStartInput.value = breakSchedule.lunch || '';
  if (break2StartInput) break2StartInput.value = breakSchedule.break2 || '';
  if (shiftEndInput) shiftEndInput.value = breakSchedule.shiftEnd || '';
  if (chkNotifyDesktop) chkNotifyDesktop.checked = Boolean(breakSchedule.notifyDesktop);
  if (chkNotifyToast) chkNotifyToast.checked = (breakSchedule.notifyToast !== false);

  bindBreakScheduleEvents();
  updateBreakNotifier();
  setInterval(updateBreakNotifier, 1000);
}

function bindBreakScheduleEvents() {
  const save = () => {
    breakSchedule.break1 = break1StartInput?.value || '';
    breakSchedule.lunch = lunchStartInput?.value || '';
    breakSchedule.break2 = break2StartInput?.value || '';
    breakSchedule.shiftEnd = shiftEndInput?.value || '';
    breakSchedule.notifyDesktop = Boolean(chkNotifyDesktop?.checked);
    breakSchedule.notifyToast = Boolean(chkNotifyToast?.checked);
    Storage.set('vpad.break_schedule', breakSchedule);
    updateBreakNotifier();
  };

  [break1StartInput, lunchStartInput, break2StartInput, shiftEndInput].forEach(inp => {
    if (inp) inp.addEventListener('change', save);
  });

  if (chkNotifyDesktop) {
    chkNotifyDesktop.addEventListener('change', async () => {
      if (chkNotifyDesktop.checked && typeof Notification !== 'undefined') {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      }
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
}

function renderBreakNotifierView() {
  if (break1StartInput) break1StartInput.value = breakSchedule.break1 || '';
  if (lunchStartInput) lunchStartInput.value = breakSchedule.lunch || '';
  if (break2StartInput) break2StartInput.value = breakSchedule.break2 || '';
  if (shiftEndInput) shiftEndInput.value = breakSchedule.shiftEnd || '';
  if (chkNotifyDesktop) chkNotifyDesktop.checked = Boolean(breakSchedule.notifyDesktop);
  if (chkNotifyToast) chkNotifyToast.checked = (breakSchedule.notifyToast !== false);
  updateBreakNotifier();
}

function parseTimeToDate(timeStr, now) {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

function formatShortDuration(diffSec) {
  if (diffSec <= 0) return '0s';
  if (diffSec < 60) return `${diffSec < 10 ? '0' : ''}${diffSec}s`;
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

function formatCountdown(sec) {
  if (sec <= 0) return '00:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (mins > 0) {
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  }
  return `${secs < 10 ? '0' : ''}${secs}s`;
}

function formatBigCountdown(sec) {
  if (sec <= 0) return '00:00:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
        console.error('Notification error:', err);
      }
    }
  }
}

function updateBreakNotifier() {
  const now = new Date();

  const b1Start = parseTimeToDate(breakSchedule.break1, now);
  const b1End = b1Start ? new Date(b1Start.getTime() + 10 * 60 * 1000) : null;

  const lStart = parseTimeToDate(breakSchedule.lunch, now);
  const lEnd = lStart ? new Date(lStart.getTime() + 40 * 60 * 1000) : null;

  const b2Start = parseTimeToDate(breakSchedule.break2, now);
  const b2End = b2Start ? new Date(b2Start.getTime() + 10 * 60 * 1000) : null;

  const sEnd = parseTimeToDate(breakSchedule.shiftEnd, now);

  if (!b1Start && !lStart && !b2Start && !sEnd) {
    if (breakTicker) breakTicker.style.display = 'none';
    if (breakCountdownBig) breakCountdownBig.textContent = '--:--:--';
    if (breakEventTitle) breakEventTitle.textContent = 'No Schedule Set';
    if (breakStatusSub) breakStatusSub.textContent = 'Set your break times below to start timer';
    return;
  }

  if (breakTicker) breakTicker.style.display = 'inline-flex';

  let currentPhase = null;
  let targetTime = null;
  let eventName = '';
  let eventTag = '';
  let icon = '☕';
  let isActive = false;
  let notifKey = null;

  if (b1Start && now < b1Start) {
    currentPhase = 'before_b1';
    targetTime = b1Start;
    eventName = 'Next: Break 1';
    eventTag = '10m break';
    icon = '☕';
  } else if (b1Start && b1End && now >= b1Start && now < b1End) {
    currentPhase = 'in_b1';
    targetTime = b1End;
    eventName = 'On Break 1';
    eventTag = 'Back soon';
    icon = '☕';
    isActive = true;
    notifKey = 'b1_start';
  } else if (lStart && now < lStart) {
    currentPhase = 'before_lunch';
    targetTime = lStart;
    eventName = 'Next: Lunch';
    eventTag = '40m lunch';
    icon = '🍱';
    if (b1End && Math.abs(now.getTime() - b1End.getTime()) < 3000) {
      triggerBreakNotification('b1_end', 'Break 1 Finished', 'Ready to resume calls 📞');
    }
  } else if (lStart && lEnd && now >= lStart && now < lEnd) {
    currentPhase = 'in_lunch';
    targetTime = lEnd;
    eventName = 'On Lunch';
    eventTag = 'Back soon';
    icon = '🍱';
    isActive = true;
    notifKey = 'lunch_start';
  } else if (b2Start && now < b2Start) {
    currentPhase = 'before_b2';
    targetTime = b2Start;
    eventName = 'Next: Break 2';
    eventTag = '10m break';
    icon = '☕';
    if (lEnd && Math.abs(now.getTime() - lEnd.getTime()) < 3000) {
      triggerBreakNotification('lunch_end', 'Lunch Finished', 'Ready to resume calls 📞');
    }
  } else if (b2Start && b2End && now >= b2Start && now < b2End) {
    currentPhase = 'in_b2';
    targetTime = b2End;
    eventName = 'On Break 2';
    eventTag = 'Back soon';
    icon = '☕';
    isActive = true;
    notifKey = 'b2_start';
  } else if (sEnd && now < sEnd) {
    currentPhase = 'before_shift_end';
    targetTime = sEnd;
    eventName = 'Next: Shift End';
    eventTag = 'End of Day';
    icon = '🏁';
    if (b2End && Math.abs(now.getTime() - b2End.getTime()) < 3000) {
      triggerBreakNotification('b2_end', 'Break 2 Finished', 'Ready to resume calls 📞');
    }
  } else {
    currentPhase = 'shift_done';
    targetTime = null;
    eventName = 'Shift Completed';
    eventTag = 'Done';
    icon = '🏁';
    if (sEnd && Math.abs(now.getTime() - sEnd.getTime()) < 3000) {
      triggerBreakNotification('shift_done', 'Shift Completed', 'Great job today! 🎉');
    }
  }

  if (notifKey && targetTime) {
    const diffSec = Math.floor((targetTime.getTime() - now.getTime()) / 1000);
    if (notifKey === 'b1_start' && diffSec >= 590) {
      triggerBreakNotification('b1_start', 'Break 1 Started', 'Time for Break 1 (10 min break) ☕');
    } else if (notifKey === 'lunch_start' && diffSec >= 2390) {
      triggerBreakNotification('lunch_start', 'Lunch Started', 'Time for Lunch (40 min lunch) 🍱');
    } else if (notifKey === 'b2_start' && diffSec >= 590) {
      triggerBreakNotification('b2_start', 'Break 2 Started', 'Time for Break 2 (10 min break) ☕');
    }
  }

  if (breakTickerIcon) breakTickerIcon.textContent = icon;
  if (breakTicker) breakTicker.classList.toggle('active-break', isActive);

  const ambientBreakBar = document.getElementById('ambientBreakBar');
  const ambientBreakIcon = document.getElementById('ambientBreakIcon');
  const ambientBreakText = document.getElementById('ambientBreakText');

  if (targetTime) {
    const diffSec = Math.max(0, Math.floor((targetTime.getTime() - now.getTime()) / 1000));
    const tickerStr = formatShortDuration(diffSec);
    if (breakTickerText) breakTickerText.textContent = isActive ? `In: ${tickerStr}` : tickerStr;
    if (breakCountdownBig) breakCountdownBig.textContent = formatBigCountdown(diffSec);
    if (breakStatusSub) breakStatusSub.textContent = isActive ? `Active break ends at ${targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `Scheduled for ${targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    if (ambientBreakBar) {
      ambientBreakBar.style.display = 'flex';
      if (ambientBreakIcon) ambientBreakIcon.textContent = icon;
      if (ambientBreakText) {
        ambientBreakText.textContent = isActive ? `${eventName} · ${tickerStr} left` : `${eventName} in ${tickerStr}`;
      }
    }
  } else {
    if (breakTickerText) breakTickerText.textContent = 'Done';
    if (breakCountdownBig) breakCountdownBig.textContent = '00:00:00';
    if (breakStatusSub) breakStatusSub.textContent = 'Shift completed for today';

    if (ambientBreakBar) {
      ambientBreakBar.style.display = 'flex';
      if (ambientBreakIcon) ambientBreakIcon.textContent = '🏁';
      if (ambientBreakText) ambientBreakText.textContent = 'Shift Completed';
    }
  }

  if (breakEventTitle) breakEventTitle.textContent = eventName;
  if (breakEventTag) breakEventTag.textContent = eventTag;

  if (b1Start && sEnd) {
    const totalDayMs = sEnd.getTime() - b1Start.getTime();
    const elapsedDayMs = now.getTime() - b1Start.getTime();
    const pct = Math.max(0, Math.min(100, Math.round((elapsedDayMs / totalDayMs) * 100)));
    if (breakProgressBar) breakProgressBar.style.width = `${pct}%`;
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
const notesView = document.getElementById('notesView');
const btnNotes = document.getElementById('btnNotes');
const btnBackNotes = document.getElementById('btnBackNotes');
const btnNewNote = document.getElementById('btnNewNote');
const btnCopyNote = document.getElementById('btnCopyNote');
const btnDeleteNote = document.getElementById('btnDeleteNote');
const noteSelectMount = document.getElementById('noteSelectMount');
const noteTitleInput = document.getElementById('noteTitleInput');
const noteBodyText = document.getElementById('noteBodyText');
const noteSaveStatus = document.getElementById('noteSaveStatus');
const noteWordCharCount = document.getElementById('noteWordCharCount');

async function loadNotes() {
  const raw = await Storage.get('vpad.notes', []);
  if (Array.isArray(raw) && raw.length > 0) {
    notes = raw.map(n => ({
      id: n.id || uid(),
      title: n.title || (n.text ? n.text.split('\n')[0].slice(0, 32) : 'Untitled Note'),
      text: n.text || '',
      updatedAt: n.updatedAt || n.createdAt || Date.now()
    }));
  } else {
    notes = [
      {
        id: uid(),
        title: 'General Notes',
        text: '',
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
  const len = cur ? cur.text.length : 0;
  const words = cur && cur.text.trim() ? cur.text.trim().split(/\s+/).length : 0;
  noteWordCharCount.textContent = `${words} words · ${len} chars`;
}

function switchNote(noteId) {
  activeNoteId = noteId;
  Storage.set('vpad.active_note', activeNoteId);
  const note = getActiveNote();
  if (!note) return;

  if (noteTitleInput) noteTitleInput.value = note.title || '';
  if (noteBodyText) noteBodyText.value = note.text || '';
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
    updatedAt: Date.now()
  };
  notes.unshift(newNote);
  saveNotesImmediate();
  switchNote(newNote.id);
  if (noteBodyText) noteBodyText.focus();
}

async function deleteActiveNote() {
  if (notes.length <= 1) {
    const onlyNote = notes[0];
    const snapText = onlyNote.text;
    const snapTitle = onlyNote.title;
    onlyNote.text = '';
    onlyNote.title = 'General Notes';
    onlyNote.updatedAt = Date.now();
    await saveNotesImmediate();
    switchNote(onlyNote.id);
    showBanner('Note cleared', 'Undo', () => {
      onlyNote.text = snapText;
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
  const toCopy = (note.text || '').trim() || (note.title || '').trim();
  if (!toCopy) {
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
  await writeToClipboard(note.text);
  if (btnCopyNote) {
    const origHtml = btnCopyNote.innerHTML;
    const origTitle = btnCopyNote.title;
    btnCopyNote.classList.add('copied-success');
    btnCopyNote.title = 'Copied ✓';
    btnCopyNote.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>`;

    if (noteSaveStatus) {
      noteSaveStatus.textContent = 'Copied ✓';
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
  switchNote(activeNoteId);
  if (noteBodyText) {
    noteBodyText.focus();
    noteBodyText.setSelectionRange(noteBodyText.value.length, noteBodyText.value.length);
  }
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

if (noteBodyText) {
  noteBodyText.addEventListener('input', () => {
    const note = getActiveNote();
    if (!note) return;
    note.text = noteBodyText.value;
    note.updatedAt = Date.now();
    updateNoteCounts();
    scheduleSaveNotes();
  });
  noteBodyText.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = noteBodyText.selectionStart;
      const end = noteBodyText.selectionEnd;
      noteBodyText.value = noteBodyText.value.substring(0, start) + '  ' + noteBodyText.value.substring(end);
      noteBodyText.selectionStart = noteBodyText.selectionEnd = start + 2;
      const note = getActiveNote();
      if (note) {
        note.text = noteBodyText.value;
        scheduleSaveNotes();
      }
    }
  });
}

/* ==========================================================================
   Initialization
   ========================================================================== */
async function init() {
  const configVer = await Storage.get('vpad.config_version', 0);
  const loadedTypes = await Storage.get('vpad.types', null);

  if (configVer < 9 || !Array.isArray(loadedTypes) || loadedTypes.length < 13) {
    types = defaultVettingTypes();
    Storage.setMultiple({
      'vpad.types': types,
      'vpad.config_version': 9
    });
  } else {
    types = loadedTypes;
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
  renderForm();
  updateCommentInput();
  await initCallPad();
  initMenu();
  await loadQuickTemplates();
  await initBreakNotifier();
}

init();

