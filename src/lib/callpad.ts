/**
 * Smart Free-Text CallPad Component
 * KISS, line-by-line quick scratchpad with per-line micro copy and Copy All.
 */

import { renderIcon } from './icons.js';

export interface CallPadOptions {
  container: HTMLElement;
  initialLines?: string[];
  onSave?: (lines: string[]) => void;
  onCopy?: (text: string) => Promise<boolean>;
}

export function formatCallPadCopyAll(lines?: unknown[]): string {
  if (!Array.isArray(lines)) return '';
  return lines
    .map(l => (typeof l === 'string' ? l.trim() : ''))
    .filter(l => l.length > 0)
    .join('\n');
}

export function serializeCallPad(lines?: unknown[]): string[] {
  if (!Array.isArray(lines)) return [''];
  const res: string[] = [];
  for (const l of lines) {
    if (typeof l === 'string') res.push(l);
  }
  return res.length > 0 ? res : [''];
}

export class SmartCallPad {
  container: HTMLElement;
  onSave: (lines: string[]) => void;
  onCopy: (text: string) => Promise<boolean>;
  lines: string[];
  saveTimeout: ReturnType<typeof setTimeout> | null = null;
  linesList: HTMLElement | null = null;
  countBadge: HTMLElement | null = null;
  btnCopyAll: HTMLElement | null = null;
  btnClearAll: HTMLElement | null = null;
  copyAllTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: CallPadOptions) {
    this.container = options.container;
    this.onSave = options.onSave ?? (() => {});
    this.onCopy = options.onCopy ?? (async (text: string): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    });

    const initLines = Array.isArray(options.initialLines) && options.initialLines.length > 0
      ? options.initialLines
      : [''];
    this.lines = [...initLines];

    this.render();
  }

  debounceSave(): void {
    if (this.saveTimeout !== null) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.onSave(this.getLines());
    }, 200);
  }

  getLines(): string[] {
    return [...this.lines];
  }

  render(): void {
    this.container.innerHTML = `
      <div class="callpad-toolbar">
        <div class="callpad-counts">
          <span class="callpad-line-count-badge" id="callpadCountBadge">0 items</span>
        </div>
        <div class="callpad-actions">
          <button type="button" class="btn-callpad-action" id="btnCallpadCopyAll" title="Copy all lines">
            ${renderIcon('Copy', { size: 11 })}
            <span>Copy All</span>
          </button>
          <button type="button" class="btn-callpad-action btn-callpad-clear" id="btnCallpadClearAll" title="Clear all lines">
            ${renderIcon('Trash2', { size: 11 })}
            <span>Clear</span>
          </button>
        </div>
      </div>
      <div class="callpad-lines-list" id="callpadLinesList"></div>
    `;

    const listEl = this.container.querySelector('#callpadLinesList');
    if (listEl instanceof HTMLElement) this.linesList = listEl;

    const countEl = this.container.querySelector('#callpadCountBadge');
    if (countEl instanceof HTMLElement) this.countBadge = countEl;

    const copyAllEl = this.container.querySelector('#btnCallpadCopyAll');
    if (copyAllEl instanceof HTMLElement) this.btnCopyAll = copyAllEl;

    const clearAllEl = this.container.querySelector('#btnCallpadClearAll');
    if (clearAllEl instanceof HTMLElement) this.btnClearAll = clearAllEl;

    if (this.btnCopyAll) {
      this.btnCopyAll.onclick = async () => {
        const fullText = formatCallPadCopyAll(this.lines);
        if (!fullText) return;
        await this.onCopy(fullText);
        if (this.copyAllTimer) clearTimeout(this.copyAllTimer);
        this.btnCopyAll?.classList.add('copied');
        if (this.btnCopyAll) {
          this.btnCopyAll.innerHTML = `${renderIcon('Check', { size: 11, strokeWidth: 2.5 })}<span>Copied</span>`;
        }
        this.copyAllTimer = setTimeout(() => {
          if (this.btnCopyAll) {
            this.btnCopyAll.innerHTML = `${renderIcon('Copy', { size: 11 })}<span>Copy All</span>`;
            this.btnCopyAll.classList.remove('copied');
          }
          this.copyAllTimer = null;
        }, 1500);
      };
    }

    if (this.btnClearAll) {
      this.btnClearAll.onclick = () => {
        this.clearAll();
      };
    }

    this.renderLines();
    this.updateBadge();
  }

  renderLines(): void {
    if (!this.linesList) return;
    this.linesList.innerHTML = '';
    this.lines.forEach((lineText, idx) => {
      const lineEl = this.createLineElement(lineText, idx);
      this.linesList?.appendChild(lineEl);
    });
  }

  createLineElement(text: string, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'callpad-smart-line';
    row.dataset.index = String(idx);

    const hasContent = (text || '').trim().length > 0;

    row.innerHTML = `
      <input type="text" class="callpad-line-input" value="${this.escapeHtml(text)}" placeholder="Type MSISDN, note, or ID..." autocomplete="off" spellcheck="false">
      <button type="button" class="callpad-line-copy-btn ${hasContent ? 'visible' : ''}" title="Copy line" aria-label="Copy line">
        <span class="icon-copy" style="display:inline-flex;">${renderIcon('Copy', { size: 11 })}</span>
        <span class="icon-check" style="display:none;line-height:0;color:var(--color-success, #22c55e);">${renderIcon('Check', { size: 11 })}</span>
      </button>
    `;

    const input = row.querySelector('.callpad-line-input');
    const copyBtn = row.querySelector('.callpad-line-copy-btn');

    if (input instanceof HTMLInputElement && copyBtn instanceof HTMLElement) {
      input.addEventListener('input', () => {
        const val = input.value;
        this.lines[idx] = val;
        copyBtn.classList.toggle('visible', val.trim().length > 0);
        this.updateBadge();
        this.debounceSave();
      });

      input.addEventListener('paste', (e: ClipboardEvent) => {
        const pasteText = e.clipboardData ? e.clipboardData.getData('text') : '';
        if (pasteText.includes('\n')) {
          e.preventDefault();
          const splitLines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
          if (splitLines.length > 0) {
            this.lines.splice(idx, 1, ...splitLines);
            this.renderLines();
            if (this.linesList) {
              const inputs = this.linesList.querySelectorAll('input.callpad-line-input');
              const target = inputs[idx + splitLines.length - 1] ?? inputs[inputs.length - 1];
              if (target instanceof HTMLInputElement) target.focus();
            }
            this.updateBadge();
            this.debounceSave();
          }
        }
      });

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.lines.splice(idx + 1, 0, '');
          this.renderLines();
          if (this.linesList) {
            const nextInput = this.linesList.querySelectorAll('input.callpad-line-input')[idx + 1];
            if (nextInput instanceof HTMLInputElement) nextInput.focus();
          }
          this.updateBadge();
          this.debounceSave();
        } else if (e.key === 'Backspace' && input.value === '' && this.lines.length > 1) {
          e.preventDefault();
          this.lines.splice(idx, 1);
          this.renderLines();
          const prevIdx = Math.max(0, idx - 1);
          if (this.linesList) {
            const prevInput = this.linesList.querySelectorAll('input.callpad-line-input')[prevIdx];
            if (prevInput instanceof HTMLInputElement) {
              prevInput.focus();
              prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
            }
          }
          this.updateBadge();
          this.debounceSave();
        } else if (e.key === 'ArrowUp') {
          if (idx > 0 && this.linesList) {
            e.preventDefault();
            const prev = this.linesList.querySelectorAll('input.callpad-line-input')[idx - 1];
            if (prev instanceof HTMLInputElement) prev.focus();
          }
        } else if (e.key === 'ArrowDown') {
          if (idx < this.lines.length - 1 && this.linesList) {
            e.preventDefault();
            const next = this.linesList.querySelectorAll('input.callpad-line-input')[idx + 1];
            if (next instanceof HTMLInputElement) next.focus();
          }
        }
      });

      copyBtn.onclick = async () => {
        const lineVal = (this.lines[idx] || '').trim();
        if (!lineVal) return;
        await this.onCopy(lineVal);

        const copyIcon = copyBtn.querySelector('.icon-copy');
        const checkIcon = copyBtn.querySelector('.icon-check');
        if (copyIcon instanceof HTMLElement) copyIcon.style.display = 'none';
        if (checkIcon instanceof HTMLElement) checkIcon.style.display = 'inline-flex';
        copyBtn.classList.add('copied');

        setTimeout(() => {
          if (copyIcon instanceof HTMLElement) copyIcon.style.display = 'inline-flex';
          if (checkIcon instanceof HTMLElement) checkIcon.style.display = 'none';
          copyBtn.classList.remove('copied');
        }, 1200);
      };
    }

    return row;
  }

  updateBadge(): void {
    if (!this.countBadge) return;
    const count = this.lines.filter(l => (typeof l === 'string' && l.trim().length > 0)).length;
    this.countBadge.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  }

  clearAll(): void {
    this.lines = [''];
    this.renderLines();
    this.updateBadge();
    const firstInput = this.linesList?.querySelector('input.callpad-line-input');
    if (firstInput instanceof HTMLInputElement) firstInput.focus();
    this.debounceSave();
  }

  escapeHtml(s: string): string {
    return String(s || '').replace(/[&<>"']/g, c => {
      const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[c] ?? c;
    });
  }
}
