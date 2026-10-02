/**
 * Smart Free-Text CallPad Component
 * KISS, line-by-line quick scratchpad with per-line micro copy and Copy All.
 */

export function formatCallPadCopyAll(lines) {
  if (!Array.isArray(lines)) return '';
  return lines
    .map(l => (typeof l === 'string' ? l.trim() : ''))
    .filter(l => l.length > 0)
    .join('\n');
}

export function serializeCallPad(lines) {
  if (!Array.isArray(lines)) return [''];
  const res = lines.map(l => (typeof l === 'string' ? l : ''));
  return res.length > 0 ? res : [''];
}

export class SmartCallPad {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {string[]} [options.initialLines]
   * @param {(lines: string[]) => void} [options.onSave]
   * @param {(text: string) => Promise<boolean>} [options.onCopy]
   */
  constructor(options) {
    this.container = options.container;
    this.onSave = options.onSave || (() => {});
    this.onCopy = options.onCopy || (async (text) => {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    });

    const initLines = Array.isArray(options.initialLines) && options.initialLines.length > 0
      ? options.initialLines
      : [''];
    this.lines = [...initLines];
    this.saveTimeout = null;

    this.render();
  }

  debounceSave() {
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.onSave(this.getLines());
    }, 200);
  }

  getLines() {
    return [...this.lines];
  }

  render() {
    this.container.innerHTML = `
      <div class="callpad-toolbar">
        <div class="callpad-counts">
          <span class="callpad-line-count-badge" id="callpadCountBadge">0 items</span>
        </div>
        <div class="callpad-actions">
          <button type="button" class="btn-callpad-action" id="btnCallpadCopyAll" title="Copy all lines">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <rect x="9" y="9" width="11" height="11" rx="2"/>
              <path d="M5 15V6a2 2 0 0 1 2-2h9"/>
            </svg>
            <span>Copy All</span>
          </button>
          <button type="button" class="btn-callpad-action btn-callpad-clear" id="btnCallpadClearAll" title="Clear all lines">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span>Clear</span>
          </button>
        </div>
      </div>
      <div class="callpad-lines-list" id="callpadLinesList"></div>
    `;

    this.linesList = this.container.querySelector('#callpadLinesList');
    this.countBadge = this.container.querySelector('#callpadCountBadge');
    this.btnCopyAll = this.container.querySelector('#btnCallpadCopyAll');
    this.btnClearAll = this.container.querySelector('#btnCallpadClearAll');

    this.btnCopyAll.onclick = async () => {
      const fullText = formatCallPadCopyAll(this.lines);
      if (!fullText) return;
      await this.onCopy(fullText);
      const span = this.btnCopyAll.querySelector('span');
      const orig = span ? span.textContent : 'Copy All';
      if (span) span.textContent = 'Copied ✓';
      this.btnCopyAll.classList.add('copied');
      setTimeout(() => {
        if (span) span.textContent = orig;
        this.btnCopyAll.classList.remove('copied');
      }, 1500);
    };

    this.btnClearAll.onclick = () => {
      this.clearAll();
    };

    this.renderLines();
    this.updateBadge();
  }

  renderLines() {
    this.linesList.innerHTML = '';
    this.lines.forEach((lineText, idx) => {
      const lineEl = this.createLineElement(lineText, idx);
      this.linesList.appendChild(lineEl);
    });
  }

  createLineElement(text, idx) {
    const row = document.createElement('div');
    row.className = 'callpad-smart-line';
    row.dataset.index = String(idx);

    const hasContent = (text || '').trim().length > 0;

    row.innerHTML = `
      <input type="text" class="callpad-line-input" value="${this.escapeHtml(text)}" placeholder="Type MSISDN, note, or ID..." autocomplete="off" spellcheck="false">
      <button type="button" class="callpad-line-copy-btn ${hasContent ? 'visible' : ''}" title="Copy line" aria-label="Copy line">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="icon-copy">
          <rect x="9" y="9" width="11" height="11" rx="2"/>
          <path d="M5 15V6a2 2 0 0 1 2-2h9"/>
        </svg>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" class="icon-check" style="display:none;">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </button>
    `;

    const input = row.querySelector('.callpad-line-input');
    const copyBtn = row.querySelector('.callpad-line-copy-btn');

    input.addEventListener('input', () => {
      const val = input.value;
      this.lines[idx] = val;
      copyBtn.classList.toggle('visible', val.trim().length > 0);
      this.updateBadge();
      this.debounceSave();
    });

    input.addEventListener('paste', (e) => {
      const pasteText = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (pasteText.includes('\n')) {
        e.preventDefault();
        const splitLines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (splitLines.length > 0) {
          this.lines.splice(idx, 1, ...splitLines);
          this.renderLines();
          const inputs = this.linesList.querySelectorAll('.callpad-line-input');
          const target = inputs[idx + splitLines.length - 1] || inputs[inputs.length - 1];
          if (target) target.focus();
          this.updateBadge();
          this.debounceSave();
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.lines.splice(idx + 1, 0, '');
        this.renderLines();
        const nextInput = this.linesList.querySelectorAll('.callpad-line-input')[idx + 1];
        if (nextInput) nextInput.focus();
        this.updateBadge();
        this.debounceSave();
      } else if (e.key === 'Backspace' && input.value === '' && this.lines.length > 1) {
        e.preventDefault();
        this.lines.splice(idx, 1);
        this.renderLines();
        const prevIdx = Math.max(0, idx - 1);
        const prevInput = this.linesList.querySelectorAll('.callpad-line-input')[prevIdx];
        if (prevInput) {
          prevInput.focus();
          prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
        }
        this.updateBadge();
        this.debounceSave();
      } else if (e.key === 'ArrowUp') {
        if (idx > 0) {
          e.preventDefault();
          const prev = this.linesList.querySelectorAll('.callpad-line-input')[idx - 1];
          if (prev) prev.focus();
        }
      } else if (e.key === 'ArrowDown') {
        if (idx < this.lines.length - 1) {
          e.preventDefault();
          const next = this.linesList.querySelectorAll('.callpad-line-input')[idx + 1];
          if (next) next.focus();
        }
      }
    });

    copyBtn.onclick = async () => {
      const lineVal = (this.lines[idx] || '').trim();
      if (!lineVal) return;
      await this.onCopy(lineVal);

      const copyIcon = copyBtn.querySelector('.icon-copy');
      const checkIcon = copyBtn.querySelector('.icon-check');
      if (copyIcon) copyIcon.style.display = 'none';
      if (checkIcon) checkIcon.style.display = 'block';
      copyBtn.classList.add('copied');

      setTimeout(() => {
        if (copyIcon) copyIcon.style.display = 'block';
        if (checkIcon) checkIcon.style.display = 'none';
        copyBtn.classList.remove('copied');
      }, 1200);
    };

    return row;
  }

  updateBadge() {
    if (!this.countBadge) return;
    const count = this.lines.filter(l => (typeof l === 'string' && l.trim().length > 0)).length;
    this.countBadge.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  }

  clearAll() {
    this.lines = [''];
    this.renderLines();
    this.updateBadge();
    const firstInput = this.linesList.querySelector('.callpad-line-input');
    if (firstInput) firstInput.focus();
    this.debounceSave();
  }

  escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
}
