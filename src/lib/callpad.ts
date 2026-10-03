/**
 * Smart Free-Text CallPad Component
 * Floating scratchpad with gutter line numbers, per-line copy, wrap mode,
 * debounced storage sync, dynamic height, two-step animated trash clear,
 * and compact 200px responsive layout.
 */

import { renderIcon } from './icons.js';

export interface CallPadOptions {
  container: HTMLElement;
  initialLines?: string[];
  initialWrap?: boolean;
  onSave?: (lines: string[]) => void;
  onSaveWrap?: (wrap: boolean) => void;
  onCopy?: (text: string) => Promise<boolean>;
}

/**
 * Joins non-empty lines with newline for Copy All.
 */
export function formatCallPadCopyAll(lines?: unknown[]): string {
  if (!Array.isArray(lines)) return '';
  return lines
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    .join('\n');
}

/**
 * Calculates total character count across all lines.
 */
export function getCharCount(lines?: unknown[]): number {
  if (!Array.isArray(lines)) return 0;
  let count = 0;
  for (const l of lines) {
    if (typeof l === 'string') count += l.length;
  }
  return count;
}

/**
 * Splits pasted multi-line text and merges with existing text around selection.
 */
export function splitMergePaste(
  currentValue: string,
  selectionStart: number,
  selectionEnd: number,
  pastedText: string
): string[] {
  const parts = pastedText.split(/\r?\n/);
  const before = currentValue.slice(0, selectionStart);
  const after = currentValue.slice(selectionEnd);
  parts[0] = before + parts[0];
  const last = parts.length - 1;
  parts[last] = parts[last] + after;
  return parts;
}

/**
 * Migrates old callpad storage keys to vpad.callpad_lines.
 * Old keys: vpad.callpad_text, vpad.callpad_freetext, vpad.callpad_keys.
 * Never returns empty array (defaults to ['']).
 */
export function migrateCallpadStorage(storage: Record<string, any>): {
  lines: string[];
  keysToRemove: string[];
} {
  const keysToRemove: string[] = [];

  const existingLines = storage['vpad.callpad_lines'];
  if (Array.isArray(existingLines) && existingLines.length > 0) {
    if ('vpad.callpad_text' in storage) keysToRemove.push('vpad.callpad_text');
    if ('vpad.callpad_freetext' in storage) keysToRemove.push('vpad.callpad_freetext');
    if ('vpad.callpad_keys' in storage) keysToRemove.push('vpad.callpad_keys');
    return {
      lines: serializeCallPad(existingLines),
      keysToRemove
    };
  }

  if (typeof storage['vpad.callpad_text'] === 'string') {
    keysToRemove.push('vpad.callpad_text');
    if ('vpad.callpad_freetext' in storage) keysToRemove.push('vpad.callpad_freetext');
    if ('vpad.callpad_keys' in storage) keysToRemove.push('vpad.callpad_keys');
    const split = storage['vpad.callpad_text'].split(/\r?\n/);
    return {
      lines: split.length > 0 ? split : [''],
      keysToRemove
    };
  }

  if (typeof storage['vpad.callpad_freetext'] === 'string') {
    keysToRemove.push('vpad.callpad_freetext');
    if ('vpad.callpad_keys' in storage) keysToRemove.push('vpad.callpad_keys');
    const split = storage['vpad.callpad_freetext'].split(/\r?\n/);
    return {
      lines: split.length > 0 ? split : [''],
      keysToRemove
    };
  }

  if (Array.isArray(storage['vpad.callpad_keys']) && storage['vpad.callpad_keys'].length > 0) {
    keysToRemove.push('vpad.callpad_keys');
    const legacyLines = storage['vpad.callpad_keys']
      .map((k: any) => (typeof k?.key === 'string' ? k.key : ''))
      .filter((k: string) => k && k.trim());
    return {
      lines: legacyLines.length > 0 ? legacyLines : [''],
      keysToRemove
    };
  }

  return {
    lines: [''],
    keysToRemove
  };
}

/**
 * Validates lines array: ensures at least one line, all strings.
 */
export function serializeCallPad(lines?: unknown[]): string[] {
  if (!Array.isArray(lines) || lines.length === 0) return [''];
  const res: string[] = [];
  for (const l of lines) {
    if (typeof l === 'string') res.push(l);
  }
  return res.length > 0 ? res : [''];
}

export class SmartCallPad {
  container: HTMLElement;
  lines: string[];
  wrap: boolean;
  onSave: (lines: string[]) => void;
  onSaveWrap: (wrap: boolean) => void;
  onCopy: (text: string) => Promise<boolean>;

  saveTimeout: ReturnType<typeof setTimeout> | null = null;
  saveBadgeTimer: ReturnType<typeof setTimeout> | null = null;
  clearArmTimer: ReturnType<typeof setTimeout> | null = null;
  onDocClick: ((e: MouseEvent) => void) | null = null;

  wrapBtn: HTMLButtonElement | null = null;
  saveBadge: HTMLElement | null = null;
  linesBox: HTMLElement | null = null;
  countEl: HTMLElement | null = null;
  clearBtn: HTMLButtonElement | null = null;
  copyAllBtn: HTMLButtonElement | null = null;

  constructor(options: CallPadOptions) {
    this.container = options.container;
    this.lines = serializeCallPad(options.initialLines);
    this.wrap = Boolean(options.initialWrap);
    this.onSave = options.onSave ?? (() => {});
    this.onSaveWrap = options.onSaveWrap ?? (() => {});
    this.onCopy = options.onCopy ?? (async (text: string): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    });

    this.initDOM();
  }

  initDOM(): void {
    this.container.innerHTML = `
      <div class="callpad-header">
        <span class="callpad-title-wrap">
          Callpad
          <button type="button" class="callpad-wrap-btn" id="callpadWrapBtn" aria-pressed="${this.wrap}" title="Toggle line wrap">↩ Wrap</button>
        </span>
        <span class="callpad-save-status" id="callpadSaveStatus">Saved ✓</span>
      </div>
      <div class="callpad-lines ${this.wrap ? 'wrap' : ''}" id="callpadLines"></div>
      <div class="callpad-footer">
        <span class="callpad-char-count" id="callpadCharCount">0</span>
        <button type="button" class="callpad-btn callpad-btn-trash" id="callpadBtnClear" title="Clear all lines" aria-label="Clear all lines">
          <svg class="trash-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path class="trash-lid" d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <line x1="10" x2="10" y1="11" y2="17"></line>
            <line x1="14" x2="14" y1="11" y2="17"></line>
          </svg>
        </button>
        <button type="button" class="callpad-btn callpad-btn-primary" id="callpadBtnCopyAll">
          ${renderIcon('Copy', { size: 11 })}
          <span>Copy All</span>
        </button>
      </div>
    `;

    this.wrapBtn = this.container.querySelector('#callpadWrapBtn');
    this.saveBadge = this.container.querySelector('#callpadSaveStatus');
    this.linesBox = this.container.querySelector('#callpadLines');
    this.countEl = this.container.querySelector('#callpadCharCount');
    this.clearBtn = this.container.querySelector('#callpadBtnClear');
    this.copyAllBtn = this.container.querySelector('#callpadBtnCopyAll');

    this.attachDelegatedListeners();
    this.render();
  }

  attachDelegatedListeners(): void {
    if (this.wrapBtn) {
      this.wrapBtn.addEventListener('click', () => {
        this.setWrap(!this.wrap);
      });
    }

    if (this.copyAllBtn) {
      this.copyAllBtn.addEventListener('click', () => {
        const text = formatCallPadCopyAll(this.lines);
        if (text) {
          this.onCopy(text);
        }
        if (this.copyAllBtn) {
          this.copyAllBtn.classList.add('done', 'copied-success');
          this.copyAllBtn.innerHTML = `${renderIcon('Check', { size: 11, strokeWidth: 2.5 })}<span>Copied</span>`;
          setTimeout(() => {
            if (this.copyAllBtn) {
              this.copyAllBtn.classList.remove('done', 'copied-success');
              this.copyAllBtn.innerHTML = `${renderIcon('Copy', { size: 11 })}<span>Copy All</span>`;
            }
          }, 1100);
        }
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.clearBtn) return;
        if (this.clearBtn.classList.contains('armed')) {
          this.disarmClear();
          this.clearAll();
        } else {
          this.armClear();
        }
      });
    }

    this.onDocClick = (e: MouseEvent) => {
      if (this.clearBtn && this.clearBtn.classList.contains('armed')) {
        if (!this.clearBtn.contains(e.target as Node)) {
          this.disarmClear();
        }
      }
    };
    document.addEventListener('click', this.onDocClick);

    if (!this.linesBox) return;

    // 1. Delegated typing (input)
    this.linesBox.addEventListener('input', (e) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLTextAreaElement)) return;
      const i = this.rowIndexOf(target);
      if (i < 0) return;

      const cleanedVal = target.value.replace(/\n/g, ' ');
      if (cleanedVal !== target.value) {
        target.value = cleanedVal;
      }
      this.lines[i] = cleanedVal;

      const row = target.closest('.callpad-row');
      row?.classList.toggle('has', Boolean(cleanedVal.trim()));

      this.fit(target);
      this.updateCount();
      this.debounceSave();
    });

    // 2. Delegated paste (multi-line split/merge)
    this.linesBox.addEventListener('paste', (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLTextAreaElement)) return;
      const clip = e.clipboardData;
      const text = clip ? clip.getData('text') : '';
      if (!/[\r\n]/.test(text)) return;

      e.preventDefault();
      const i = this.rowIndexOf(target);
      if (i < 0) return;

      const parts = splitMergePaste(
        target.value,
        target.selectionStart ?? target.value.length,
        target.selectionEnd ?? target.value.length,
        text
      );

      this.lines.splice(i, 1, ...parts);
      const caretLine = i + parts.length - 1;
      this.render(caretLine, true);
      this.debounceSave();
    });

    // 3. Delegated keyboard navigation & editing
    this.linesBox.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLTextAreaElement)) return;
      const i = this.rowIndexOf(target);
      if (i < 0) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.repeat) return; // Held Enter: do not repeat or spawn infinite rows
        this.lines.splice(i + 1, 0, '');
        this.render(i + 1, true);
        this.debounceSave();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (!target.value && this.lines.length > 1) {
          e.preventDefault();
          if (e.repeat) return; // Held key: never delete the line, only fresh press does

          this.lines.splice(i, 1);
          if (e.key === 'Backspace') {
            this.render(Math.max(0, i - 1), true);
          } else {
            const hasNext = i < this.lines.length;
            const targetIdx = hasNext ? i : this.lines.length - 1;
            this.render(targetIdx, !hasNext);
          }
          this.debounceSave();
        }
      } else if (e.key === 'ArrowUp') {
        if (!this.wrap || target.selectionStart === 0) {
          e.preventDefault();
          this.focusRow(i - 1, true);
        }
      } else if (e.key === 'ArrowDown') {
        if (!this.wrap || target.selectionStart === target.value.length) {
          e.preventDefault();
          this.focusRow(i + 1, true);
        }
      }
    });

    // 4. Delegated per-row copy
    this.linesBox.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.callpad-cp-btn') as HTMLElement | null;
      if (!btn) return;
      const i = this.rowIndexOf(btn);
      if (i < 0) return;

      const lineText = this.lines[i];
      if (lineText) {
        this.onCopy(lineText);
      }
      btn.classList.add('done', 'copied-success');
      btn.innerHTML = renderIcon('Check', { size: 11, strokeWidth: 2.5 });
      setTimeout(() => {
        btn.classList.remove('done', 'copied-success');
        btn.innerHTML = renderIcon('Copy', { size: 11 });
      }, 1100);
    });

    // 5. Delegated click-anywhere-to-type
    this.linesBox.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.closest('.callpad-cp-btn')) {
        return;
      }

      e.preventDefault();
      const row = target.closest('.callpad-row');
      if (row) {
        const i = this.rowIndexOf(row);
        if (i >= 0) this.focusRow(i, true);
        return;
      }

      // Clicked on blank area below all rows
      const last = this.lines.length - 1;
      if (this.lines[last].trim()) {
        this.lines.push('');
        this.render(last + 1, true);
        this.debounceSave();
      } else {
        this.focusRow(last, true);
      }
    });
  }

  armClear(): void {
    if (!this.clearBtn) return;
    this.clearBtn.classList.add('armed');
    this.clearBtn.title = 'Click again to confirm clear';
    if (this.clearArmTimer) clearTimeout(this.clearArmTimer);
    this.clearArmTimer = setTimeout(() => {
      this.disarmClear();
    }, 2500);
  }

  disarmClear(): void {
    if (this.clearArmTimer) {
      clearTimeout(this.clearArmTimer);
      this.clearArmTimer = null;
    }
    if (this.clearBtn) {
      this.clearBtn.classList.remove('armed');
      this.clearBtn.title = 'Clear all lines';
    }
  }

  render(focusIdx?: number, focusEnd: boolean = true): void {
    if (!this.linesBox) return;

    if (this.lines.length === 0) {
      this.lines = [''];
    }

    const fragment = document.createDocumentFragment();

    this.lines.forEach((val, idx) => {
      const row = document.createElement('div');
      row.className = 'callpad-row' + (val.trim() ? ' has' : '');

      const ta = document.createElement('textarea');
      ta.rows = 1;
      ta.value = val;
      ta.spellcheck = false;
      ta.setAttribute('aria-label', `Line ${idx + 1}`);

      const cpBtn = document.createElement('button');
      cpBtn.type = 'button';
      cpBtn.className = 'callpad-cp-btn';
      cpBtn.innerHTML = renderIcon('Copy', { size: 11 });
      cpBtn.title = 'Copy line';
      cpBtn.setAttribute('aria-label', 'Copy line');

      row.appendChild(ta);
      row.appendChild(cpBtn);
      fragment.appendChild(row);
    });

    this.linesBox.replaceChildren(fragment);
    this.linesBox.classList.toggle('wrap', this.wrap);

    const textareas = this.linesBox.querySelectorAll<HTMLTextAreaElement>('textarea');
    textareas.forEach(t => this.fit(t));

    this.updateCount();

    if (focusIdx != null) {
      this.focusRow(focusIdx, focusEnd);
    }
  }

  fit(t: HTMLTextAreaElement): void {
    t.style.height = '24px';
    if (this.wrap) {
      t.style.height = `${t.scrollHeight}px`;
    }
  }

  fitAll(): void {
    if (!this.linesBox) return;
    const textareas = this.linesBox.querySelectorAll<HTMLTextAreaElement>('textarea');
    textareas.forEach(t => this.fit(t));
  }

  setWrap(wrap: boolean): void {
    this.wrap = wrap;
    if (this.wrapBtn) {
      this.wrapBtn.setAttribute('aria-pressed', String(wrap));
    }
    if (this.linesBox) {
      this.linesBox.classList.toggle('wrap', wrap);
    }
    this.fitAll();
    this.onSaveWrap(wrap);
  }

  getLines(): string[] {
    return [...this.lines];
  }

  rows(): HTMLElement[] {
    if (!this.linesBox) return [];
    return Array.from(this.linesBox.children) as HTMLElement[];
  }

  ta(i: number): HTMLTextAreaElement | null {
    const r = this.rows()[i];
    if (!r) return null;
    return r.querySelector('textarea');
  }

  focusRow(i: number, end: boolean = true): void {
    const t = this.ta(i);
    if (!t) return;
    t.focus();
    const p = end ? t.value.length : 0;
    t.setSelectionRange(p, p);
  }

  focusEnd(): void {
    this.focusRow(this.lines.length - 1, true);
  }

  rowIndexOf(el: Element): number {
    const row = el.closest('.callpad-row');
    if (!row) return -1;
    return this.rows().indexOf(row as HTMLElement);
  }

  updateCount(): void {
    if (!this.countEl) return;
    this.countEl.textContent = String(getCharCount(this.lines));
  }

  debounceSave(): void {
    if (this.saveTimeout !== null) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.onSave(this.getLines());
      this.flashSaveBadge();
    }, 200);
  }

  flashSaveBadge(): void {
    if (!this.saveBadge) return;
    if (this.saveBadgeTimer !== null) clearTimeout(this.saveBadgeTimer);
    this.saveBadge.classList.add('on');
    this.saveBadgeTimer = setTimeout(() => {
      this.saveBadge?.classList.remove('on');
      this.saveBadgeTimer = null;
    }, 900);
  }

  clearAll(): void {
    this.lines = [''];
    this.render(0, true);
    this.debounceSave();
  }

  destroy(): void {
    if (this.onDocClick) {
      document.removeEventListener('click', this.onDocClick);
      this.onDocClick = null;
    }
    if (this.clearArmTimer) {
      clearTimeout(this.clearArmTimer);
      this.clearArmTimer = null;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.saveBadgeTimer) {
      clearTimeout(this.saveBadgeTimer);
      this.saveBadgeTimer = null;
    }
  }
}
