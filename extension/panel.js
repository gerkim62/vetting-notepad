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
const curComments = () => {
  const t = curType();
  if (!t) return [];
  if (!Array.isArray(t.comments)) t.comments = [];
  return t.comments;
};
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
function buildCopyText(t) {
  const v = curValues();
  const st = curStatus();
  const lines = [];

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
          if (st[git.id] === 'passed') str += ' (Passed)';
          else if (st[git.id] === 'failed') str += ' (Failed)';
          parts.push(str);
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
        if (st[it.id] === 'passed') line += ' (Passed)';
        else if (st[it.id] === 'failed') line += ' (Failed)';
        lines.push(line);
      }
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

function getGroupStatus(grpItems, st) {
  if (!grpItems || grpItems.length === 0) return null;
  const statuses = grpItems.map(it => st[it.id] || '');
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
  let passedCount = 0;
  let failedCount = 0;

  const processedGroups = new Set();
  t.optional.forEach(it => {
    if (it.excludeFromCount) return; // policy-only: skip count
    if (it.group) {
      if (processedGroups.has(it.group)) return;
      processedGroups.add(it.group);
      const grpItems = t.optional.filter(x => x.group === it.group && !x.excludeFromCount);
      if (!grpItems.length) return;
      const grpStatus = getGroupStatus(grpItems, st);
      if (grpStatus === 'passed') passedCount++;
      else if (grpStatus === 'failed') failedCount++;
    } else {
      if (st[it.id] === 'passed') passedCount++;
      if (st[it.id] === 'failed') failedCount++;
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

function renderForm() {
  const t = curType();
  if (!t) return;
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
  if (val === undefined) {
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

      updateTiedGroupBrackets();
      syncPreview();
      updateSecondaryCounter();
    };
  });

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
   Initialization
   ========================================================================== */
async function init() {
  const configVer = await Storage.get('vpad.config_version', 0);
  const loadedTypes = await Storage.get('vpad.types', null);

  if (configVer < 8 || !Array.isArray(loadedTypes) || loadedTypes.length < 13) {
    if (configVer >= 7 && Array.isArray(loadedTypes) && loadedTypes.length >= 13) {
      types = loadedTypes;
      types.forEach(t => {
        [...(t.required || []), ...(t.optional || [])].forEach(it => {
          if (it.v360 !== undefined) return;
          const id = (it.id || '').toLowerCase();
          const lbl = (it.label || '').toLowerCase();
          if (id.includes('name') || lbl.includes('full name') || lbl.includes('owner name') || lbl.includes('sender name')) {
            it.v360 = 'fullName';
          } else if (id.includes('idnum') || id.includes('owner_id') || lbl.includes('id number') || lbl.includes('owner id')) {
            it.v360 = 'idNumber';
          } else if (id.includes('yob') || lbl.includes('year of birth')) {
            it.v360 = 'yob';
          }
        });
      });
    } else {
      types = defaultVettingTypes();
    }
    Storage.setMultiple({
      'vpad.types': types,
      'vpad.config_version': 8
    });
  } else {
    types = loadedTypes;
  }

  const loadedSettings = await Storage.get('vpad.settings', null);
  if (loadedSettings) settings = Object.assign(settings, loadedSettings);

  activeTypeId = await Storage.get('vpad.active', types[0].id);
  if (!types.some(t => t.id === activeTypeId)) activeTypeId = types[0].id;

  applyTheme(settings.theme || 'auto');
  initTypeSelect();
  renderForm();
  updateCommentInput();
}

init();

