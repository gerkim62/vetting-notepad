/**
 * Vetting Notepad — Chrome Extension Controller
 * Pure Javascript, no heavy dependencies, fast & lightweight.
 */
(() => {
'use strict';

/* ==========================================================================
   State & Storage Handlers (chrome.storage.local with localStorage fallback)
   ========================================================================== */
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
let previewOpen = false;
let autoClearTimer = null;
let autoClearSeconds = 0;
let activeToastAutoClear = null;

const curType = () => types.find(t => t.id === activeTypeId) || types[0];
const curValues = () => (formValues[activeTypeId] || (formValues[activeTypeId] = {}));

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme;
  Storage.set('vpad.settings', settings);
}

const saveTypes = () => { Storage.set('vpad.types', types); Storage.set('vpad.active', activeTypeId); };
const saveComments = () => { Storage.set('vpad.comments', savedComments); };

/* ==========================================================================
   Toast Notification System
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
        toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
        setTimeout(() => toast.remove(), 220);
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
  const lines = [];
  
  for (const it of t.required) {
    const val = (v[it.id] || '').trim();
    if (val) lines.push(`${it.label}: ${val}`);
  }
  for (const it of t.optional) {
    const val = (v[it.id] || '').trim();
    if (val) lines.push(`${it.label}: ${val}`);
  }
  const c = (v._comment || '').trim();
  if (c) lines.push(c);

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
   Auto-Clear Countdown
   ========================================================================== */
function stopAutoClear() {
  if (autoClearTimer) {
    clearInterval(autoClearTimer);
    autoClearTimer = null;
  }
  autoClearSeconds = 0;
  if (activeToastAutoClear && activeToastAutoClear.isConnected) {
    activeToastAutoClear.remove();
    activeToastAutoClear = null;
  }
}

function startAutoClear(typeId) {
  stopAutoClear();
  if (!settings.autoClear || settings.autoClear <= 0) return;

  autoClearSeconds = settings.autoClear;
  const updateToast = () => {
    if (activeToastAutoClear && activeToastAutoClear.isConnected) {
      activeToastAutoClear.querySelector('.toast-msg').innerHTML = `Auto-clearing in <b>${autoClearSeconds}s</b>`;
    }
  };

  activeToastAutoClear = showToast(
    `Auto-clearing in <b>${autoClearSeconds}s</b>`,
    'Keep',
    () => stopAutoClear(),
    0
  );

  autoClearTimer = setInterval(() => {
    autoClearSeconds--;
    if (autoClearSeconds <= 0) {
      stopAutoClear();
      formValues[typeId] = {};
      renderForm();
      updateCommentInput();
      syncPreview();
      showToast('Customer details auto-cleared');
    } else {
      updateToast();
    }
  }, 1000);
}

/* ==========================================================================
   Dynamic Input Guide Calculator
   ========================================================================== */
function calculateGuide(val, maxLen) {
  if (!maxLen || maxLen <= 0) return { slots: '', count: '', match: false, overflow: false };
  const n = val.length;
  const slots = [];
  for (let i = 0; i < maxLen; i++) {
    if (i < n) slots.push(val[i]);
    else slots.push('_');
  }
  if (n > maxLen) {
    for (let i = maxLen; i < n; i++) slots.push(val[i]);
  }
  return {
    slots: slots.join(' '),
    count: `${n}/${maxLen}`,
    match: n === maxLen,
    overflow: n > maxLen
  };
}

/* ==========================================================================
   Main Form Rendering
   ========================================================================== */
const mainForm = document.getElementById('mainForm');

function renderForm() {
  const t = curType();
  if (!t) return;
  document.getElementById('curTypeLabel').textContent = t.name || 'Untitled';

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

  return `
    <div class="item-row ${kind}" data-id="${it.id}" data-kind="${kind}" data-index="${idx}">
      <div class="left-gutter">
        ${isMandatory 
          ? `<span class="mandatory-dot ${isFilled ? 'filled' : ''}" title="Required Field"></span>`
          : `<div class="drag-handle" draggable="true" title="Drag to reorder" aria-label="Reorder">
               <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor">
                 <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
                 <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                 <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
               </svg>
             </div>`
        }
      </div>

      <div class="field-container">
        <div class="material-field ${isFilled ? 'has-value' : ''}">
          <label class="mat-label" for="inp_${it.id}">${it.label}</label>
          <input type="text" class="mat-input" id="inp_${it.id}" data-id="${it.id}" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">
          <span class="mat-underline"></span>
        </div>
        <div class="guide-badge" id="guide_${it.id}"></div>
      </div>

      <button class="paste-btn" data-paste-id="${it.id}" title="Paste from clipboard" aria-label="Paste ${it.label}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
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
  const guideEl = row.querySelector(`#guide_${itemId}`);
  const dot = row.querySelector('.mandatory-dot');

  const val = input.value;
  fieldBox.classList.toggle('has-value', val.length > 0);
  if (dot) dot.classList.toggle('filled', val.trim().length > 0);

  if (it.len > 0) {
    const { slots, count, match, overflow } = calculateGuide(val, it.len);
    guideEl.innerHTML = `
      <span class="guide-slots">${slots}</span>
      <span class="guide-count ${match ? 'match' : overflow ? 'overflow' : ''}">${count}</span>
    `;
  } else {
    guideEl.innerHTML = '';
  }
}

/* ==========================================================================
   Events & Drag-and-Drop Reordering
   ========================================================================== */
function bindFormEvents() {
  mainForm.querySelectorAll('.mat-input').forEach(input => {
    const box = input.closest('.material-field');

    input.addEventListener('focus', () => box.classList.add('is-focused'));
    input.addEventListener('blur', () => box.classList.remove('is-focused'));

    input.addEventListener('input', () => {
      stopAutoClear();
      curValues()[input.dataset.id] = input.value;
      updateRowGuide(input.dataset.id);
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
        updateRowGuide(id);
        syncPreview();
        input.focus();
        showToast('Pasted into field');
      } catch (err) {
        showToast('Clipboard access denied. Press Ctrl+V directly.', null, null, 3000, 'warn');
        input.focus();
      }
    };
  });

  let draggedId = null;

  mainForm.querySelectorAll('.item-row.optional').forEach(row => {
    const handle = row.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('dragstart', (e) => {
      draggedId = row.dataset.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    });

    handle.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      clearDropIndicators();
      draggedId = null;
    });

    row.addEventListener('dragover', (e) => {
      if (!draggedId || draggedId === row.dataset.id) return;
      e.preventDefault();
      clearDropIndicators();
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) row.classList.add('drag-over-top');
      else row.classList.add('drag-over-bottom');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedId || draggedId === row.dataset.id) return;
      const rect = row.getBoundingClientRect();
      const insertAfter = e.clientY >= rect.top + rect.height / 2;

      reorderOptionalItem(draggedId, row.dataset.id, insertAfter);
      clearDropIndicators();
    });
  });
}

function clearDropIndicators() {
  mainForm.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
}

function reorderOptionalItem(sourceId, targetId, insertAfter) {
  const t = curType();
  const list = t.optional;
  const fromIdx = list.findIndex(x => x.id === sourceId);
  if (fromIdx < 0) return;

  const [item] = list.splice(fromIdx, 1);
  let toIdx = list.findIndex(x => x.id === targetId);
  if (insertAfter) toIdx++;

  list.splice(toIdx, 0, item);
  saveTypes();
  renderForm();
  showToast('Items reordered');
}

/* ==========================================================================
   Comment Handling & Datalist Autocomplete
   ========================================================================== */
const commentInput = document.getElementById('commentInput');
const commentFieldBox = document.getElementById('commentFieldBox');
const commentSuggestions = document.getElementById('commentSuggestions');

commentInput.addEventListener('focus', () => commentFieldBox.classList.add('is-focused'));
commentInput.addEventListener('blur', () => commentFieldBox.classList.remove('is-focused'));
commentInput.addEventListener('input', () => {
  stopAutoClear();
  curValues()._comment = commentInput.value;
  commentFieldBox.classList.toggle('has-value', commentInput.value.length > 0);
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
  commentFieldBox.classList.toggle('has-value', v.length > 0);
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
  copyBtnText.textContent = 'Copied!';
  setTimeout(() => {
    btnCopy.classList.remove('copied-success');
    copyBtnText.textContent = 'Copy';
  }, 1200);

  const missing = t.required.filter(it => !(curValues()[it.id] || '').trim()).length;
  if (missing > 0) {
    showToast(`Copied, but ${missing} required ${missing === 1 ? 'field is' : 'fields are'} blank`, null, null, 3000, 'warn');
  } else {
    showToast('Copied to clipboard!');
  }

  startAutoClear(t.id);
}
btnCopy.onclick = doCopy;

const btnClear = document.getElementById('btnClear');
btnClear.onclick = () => {
  const v = curValues();
  if (!Object.values(v).some(x => x && x.trim())) {
    showToast('Already empty');
    return;
  }

  const snapshot = Object.assign({}, v);
  formValues[activeTypeId] = {};
  stopAutoClear();
  renderForm();
  updateCommentInput();
  syncPreview();

  showToast('Details cleared', 'Undo', () => {
    formValues[activeTypeId] = snapshot;
    renderForm();
    updateCommentInput();
    syncPreview();
    showToast('Restored previous details');
  }, 4500);
};

/* ==========================================================================
   Creatable Searchable Select Dropdown
   ========================================================================== */
const typeTrigger = document.getElementById('typeTrigger');
const dropdownMenu = document.getElementById('dropdownMenu');
const typeSearchInput = document.getElementById('typeSearchInput');
const typeOptionsList = document.getElementById('typeOptionsList');

typeTrigger.onclick = (e) => {
  e.stopPropagation();
  toggleDropdown();
};

function toggleDropdown(forceState = null) {
  const isOpen = forceState !== null ? forceState : !dropdownMenu.classList.contains('open');
  if (isOpen) {
    dropdownMenu.classList.add('open');
    typeTrigger.setAttribute('aria-expanded', 'true');
    typeSearchInput.value = '';
    renderDropdownOptions('');
    setTimeout(() => typeSearchInput.focus(), 30);
  } else {
    dropdownMenu.classList.remove('open');
    typeTrigger.setAttribute('aria-expanded', 'false');
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#selectWrapper')) {
    toggleDropdown(false);
  }
});

typeSearchInput.addEventListener('input', () => {
  renderDropdownOptions(typeSearchInput.value.trim());
});

typeSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    toggleDropdown(false);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const firstOpt = typeOptionsList.querySelector('.type-opt');
    if (firstOpt) firstOpt.click();
  }
});

function renderDropdownOptions(q) {
  const lower = q.toLowerCase();
  const matched = types.filter(t => t.name.toLowerCase().includes(lower));

  let html = '';
  matched.forEach(t => {
    const isSelected = t.id === activeTypeId;
    html += `
      <div class="type-opt ${isSelected ? 'selected' : ''}" data-type-id="${t.id}">
        <span>${escapeHtml(t.name)}</span>
        ${isSelected ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </div>
    `;
  });

  if (q && !types.some(t => t.name.toLowerCase() === lower)) {
    html += `
      <div class="type-opt create-opt" data-create-name="${escapeHtml(q)}">
        <span>+ Create "${escapeHtml(q)}"</span>
      </div>
    `;
  }

  if (!q) {
    html += `
      <div class="type-opt create-opt" data-create-new="true">
        <span>+ New Vetting Type</span>
      </div>
    `;
  }

  typeOptionsList.innerHTML = html;

  typeOptionsList.querySelectorAll('.type-opt').forEach(opt => {
    opt.onclick = () => {
      if (opt.dataset.typeId) {
        switchType(opt.dataset.typeId);
      } else if (opt.dataset.createName) {
        createNewType(opt.dataset.createName);
      } else if (opt.dataset.createNew) {
        createNewType('');
      }
      toggleDropdown(false);
    };
  });
}

function switchType(typeId) {
  activeTypeId = typeId;
  saveTypes();
  renderForm();
  updateCommentInput();
  showToast(`Switched to ${curType().name}`);
}

function createNewType(name) {
  const newTypeObj = {
    id: uid(),
    name: name || 'Untitled Vetting',
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
  showToast(`Created ${newTypeObj.name}`);
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
  renderForm();
}

function renderEditView() {
  const t = curType();
  let html = `
    <div class="section-head" style="margin-top:0;">Vetting Type Name</div>
    <div class="material-field has-value" style="margin-bottom:12px;">
      <input type="text" class="mat-input" id="editTypeName" value="${escapeHtml(t.name)}" placeholder="e.g. SIM Swap">
      <span class="mat-underline" style="transform:scaleX(1)"></span>
    </div>

    <div class="section-head">
      <span>Required Items</span>
      <span style="font-size:10px;color:var(--text-dim);">Fixed Order</span>
    </div>
    <div id="editReqList">
      ${t.required.map((it, i) => createEditRowHtml(it, 'required', i, t.required.length)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:6px;" id="btnAddReq">+ Add Required Item</button>

    <div class="section-head" style="margin-top:16px;">
      <span>Optional Items</span>
      <span style="font-size:10px;color:var(--text-dim);">Reorderable</span>
    </div>
    <div id="editOptList">
      ${t.optional.map((it, i) => createEditRowHtml(it, 'optional', i, t.optional.length)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:6px;" id="btnAddOpt">+ Add Optional Item</button>

    <button class="btn-action" id="btnDeleteType" style="width:100%;margin-top:24px;color:var(--color-danger);border-color:var(--border-line);">
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
        <button class="arr-btn" data-move="-1" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="arr-btn" data-move="1" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <input type="text" class="el-label" value="${escapeHtml(it.label)}" placeholder="Label name">
      <input type="number" class="el-len" value="${it.len || ''}" placeholder="len" title="Guide length in characters">
      <button class="ibtn" data-del="true" title="Remove item" style="width:22px;height:22px;color:var(--color-danger);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
}

function bindEditEvents() {
  const t = curType();
  const nameInput = document.getElementById('editTypeName');
  nameInput.oninput = () => {
    t.name = nameInput.value || 'Untitled';
    document.getElementById('curTypeLabel').textContent = t.name;
    saveTypes();
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
          activeTypeId = types[0].id;
          saveTypes();
          closeEditView();
          showToast('Vetting type deleted');
        }
      }
      return;
    }

    const kind = row.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const idx = list.findIndex(x => x.id === row.dataset.id);

    if (e.target.closest('[data-del]')) {
      list.splice(idx, 1);
      renderEditView();
    } else if (e.target.closest('[data-move]')) {
      const step = parseInt(e.target.closest('[data-move]').dataset.move, 10);
      const targetIdx = idx + step;
      if (targetIdx >= 0 && targetIdx < list.length) {
        [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
        renderEditView();
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
      showToast(`Theme set to ${c.textContent}`);
    };
  });

  const acChips = document.getElementById('autoClearChips');
  acChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.ac, 10) === settings.autoClear);
    c.onclick = () => {
      settings.autoClear = parseInt(c.dataset.ac, 10);
      Storage.set('vpad.settings', settings);
      renderSettingsView();
      showToast(`Auto-clear set to ${c.textContent}`);
    };
  });

  const commentList = document.getElementById('savedCommentList');
  document.getElementById('commentCountBadge').textContent = `${savedComments.length} saved`;

  if (savedComments.length === 0) {
    commentList.innerHTML = `<div style="color:var(--text-dim);font-style:italic;font-size:11px;">No saved comments yet</div>`;
  } else {
    commentList.innerHTML = savedComments.map((c, i) => `
      <div class="comment-item">
        <span title="${escapeHtml(c)}">${escapeHtml(c)}</span>
        <button class="ibtn" data-del-comment="${i}" style="width:20px;height:20px;color:var(--color-danger);" title="Delete comment">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
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
      saveTypes();
      settingsView.style.display = 'none';
      renderForm();
      updateCommentInput();
      showToast('Reset to defaults');
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
    toggleDropdown(true);
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
  renderForm();
  updateCommentInput();
}

init();

})();
