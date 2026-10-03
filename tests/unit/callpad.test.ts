import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatCallPadCopyAll,
  getCharCount,
  splitMergePaste,
  migrateCallpadStorage,
  serializeCallPad,
  SmartCallPad
} from '../../src/lib/callpad.js';

describe('Smart CallPad Component & Helpers', () => {
  describe('Pure Helpers', () => {
    it('formats copy all text by joining non-empty lines with newline and skipping empty/whitespace lines', () => {
      const lines = ['0712345678', '   ', 'Ticket-99881', 'Customer called about reversal', '', '  \n  '];
      const res = formatCallPadCopyAll(lines);
      expect(res).toBe('0712345678\nTicket-99881\nCustomer called about reversal');
    });

    it('returns empty string if lines is not array or all lines are empty', () => {
      expect(formatCallPadCopyAll(null)).toBe('');
      expect(formatCallPadCopyAll(['', '  ', '   '])).toBe('');
    });

    it('calculates total character count correctly', () => {
      expect(getCharCount(['abc', '1234', ''])).toBe(7);
      expect(getCharCount([])).toBe(0);
      expect(getCharCount(undefined)).toBe(0);
    });

    describe('splitMergePaste', () => {
      it('splits multi-line text and merges with text before and after caret', () => {
        const current = 'Hello world!';
        // Caret at position 5 (between 'Hello' and ' world!')
        const res = splitMergePaste(current, 5, 5, ' beautiful\ncruel');
        expect(res).toEqual(['Hello beautiful', 'cruel world!']);
      });

      it('splits and replaces selected text in the middle of a line', () => {
        const current = 'The quick brown fox';
        // Select 'quick brown' (index 4 to 15)
        const res = splitMergePaste(current, 4, 15, 'slow\nsleepy');
        expect(res).toEqual(['The slow', 'sleepy fox']);
      });

      it('handles carriage return newlines (CRLF)', () => {
        const res = splitMergePaste('Start End', 5, 5, 'A\r\nB\r\nC');
        expect(res).toEqual(['StartA', 'B', 'C End']);
      });
    });

    describe('migrateCallpadStorage', () => {
      it('preserves existing vpad.callpad_lines and marks legacy keys for removal', () => {
        const storage = {
          'vpad.callpad_lines': ['Line 1', 'Line 2'],
          'vpad.callpad_text': 'Old text',
          'vpad.callpad_keys': [{ key: 'K1' }]
        };
        const result = migrateCallpadStorage(storage);
        expect(result.lines).toEqual(['Line 1', 'Line 2']);
        expect(result.keysToRemove).toContain('vpad.callpad_text');
        expect(result.keysToRemove).toContain('vpad.callpad_keys');
      });

      it('migrates from vpad.callpad_text if vpad.callpad_lines is missing', () => {
        const storage = {
          'vpad.callpad_text': 'Line A\nLine B\nLine C'
        };
        const result = migrateCallpadStorage(storage);
        expect(result.lines).toEqual(['Line A', 'Line B', 'Line C']);
        expect(result.keysToRemove).toEqual(['vpad.callpad_text']);
      });

      it('migrates from vpad.callpad_freetext if vpad.callpad_lines is missing', () => {
        const storage = {
          'vpad.callpad_freetext': 'Note 1\r\nNote 2'
        };
        const result = migrateCallpadStorage(storage);
        expect(result.lines).toEqual(['Note 1', 'Note 2']);
        expect(result.keysToRemove).toEqual(['vpad.callpad_freetext']);
      });

      it('migrates from vpad.callpad_keys array if modern keys are missing', () => {
        const storage = {
          'vpad.callpad_keys': [{ key: '0711000111' }, { key: '' }, { key: 'Ticket-100' }]
        };
        const result = migrateCallpadStorage(storage);
        expect(result.lines).toEqual(['0711000111', 'Ticket-100']);
        expect(result.keysToRemove).toEqual(['vpad.callpad_keys']);
      });

      it('defaults to [\'\'] if storage is empty or invalid, never returning empty array', () => {
        expect(migrateCallpadStorage({})).toEqual({ lines: [''], keysToRemove: [] });
        expect(migrateCallpadStorage({ 'vpad.callpad_lines': [] }).lines).toEqual(['']);
      });
    });

    describe('serializeCallPad', () => {
      it('serializes lines properly and defaults to [\'\'] if empty or invalid', () => {
        expect(serializeCallPad(['First', 'Second'])).toEqual(['First', 'Second']);
        expect(serializeCallPad([])).toEqual(['']);
        expect(serializeCallPad(null)).toEqual(['']);
      });
    });
  });

  describe('SmartCallPad DOM Component', () => {
    let container: HTMLElement;
    let onSave: ReturnType<typeof vi.fn>;
    let onSaveWrap: ReturnType<typeof vi.fn>;
    let onCopy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      container = document.createElement('div');
      document.body.appendChild(container);
      onSave = vi.fn();
      onSaveWrap = vi.fn();
      onCopy = vi.fn().mockResolvedValue(true);
    });

    afterEach(() => {
      vi.useRealTimers();
      if (container.parentNode) container.parentNode.removeChild(container);
    });

    it('renders initial lines or at least one empty line with proper structure and accessibility', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['0722000000', 'ID: 12345678'],
        onSave
      });

      const textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
      expect(textareas[0].value).toBe('0722000000');
      expect(textareas[0].getAttribute('aria-label')).toBe('Line 1');
      expect(textareas[1].value).toBe('ID: 12345678');
      expect(textareas[1].getAttribute('aria-label')).toBe('Line 2');

      const charCountEl = container.querySelector('#callpadCharCount');
      expect(charCountEl?.textContent).toBe(String('0722000000'.length + 'ID: 12345678'.length));
    });

    it('inserts a new line when fresh Enter is pressed and focuses it', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['First line'],
        onSave
      });

      const firstTa = container.querySelector<HTMLTextAreaElement>('.callpad-row textarea')!;
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat: false });
      firstTa.dispatchEvent(enterEvent);

      const textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
      expect(textareas[0].value).toBe('First line');
      expect(textareas[1].value).toBe('');
      expect(document.activeElement).toBe(textareas[1]);
    });

    it('does NOT insert a line when Enter event.repeat is true (held key safety)', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['First line'],
        onSave
      });

      const firstTa = container.querySelector<HTMLTextAreaElement>('.callpad-row textarea')!;
      const repeatEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat: true });
      firstTa.dispatchEvent(repeatEnter);

      const textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(1);
    });

    it('removes empty line on Backspace on a fresh press when multiple lines exist', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', ''],
        onSave
      });

      let textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);

      const secondTa = textareas[1];
      const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, repeat: false });
      secondTa.dispatchEvent(backspaceEvent);

      textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(1);
      expect(textareas[0].value).toBe('Line 1');
      expect(document.activeElement).toBe(textareas[0]);
    });

    it('does NOT delete empty line on Backspace when event.repeat is true (held key safety)', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', ''],
        onSave
      });

      let textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);

      const secondTa = textareas[1];
      const repeatBackspace = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, repeat: true });
      secondTa.dispatchEvent(repeatBackspace);

      textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
    });

    it('removes empty line on Delete on a fresh press, focusing next line start', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['First', '', 'Third'],
        onSave
      });

      let textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(3);

      const middleTa = textareas[1];
      const deleteEvent = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, repeat: false });
      middleTa.dispatchEvent(deleteEvent);

      textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
      expect(textareas[0].value).toBe('First');
      expect(textareas[1].value).toBe('Third');
      expect(document.activeElement).toBe(textareas[1]);
      expect(textareas[1].selectionStart).toBe(0);
    });

    it('ensures there is always at least one line (never deletes the only line)', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: [''],
        onSave
      });

      const ta = container.querySelector<HTMLTextAreaElement>('.callpad-row textarea')!;
      const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, repeat: false });
      ta.dispatchEvent(backspaceEvent);

      const deleteEvent = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, repeat: false });
      ta.dispatchEvent(deleteEvent);

      const textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(1);
      expect(pad.getLines()).toEqual(['']);
    });

    it('toggles wrap mode, updates aria-pressed, fits textarea, and calls onSaveWrap', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['A very long line of text that might wrap when wrap mode is active'],
        initialWrap: false,
        onSave,
        onSaveWrap
      });

      const wrapBtn = container.querySelector<HTMLButtonElement>('#callpadWrapBtn')!;
      const linesBox = container.querySelector<HTMLElement>('#callpadLines')!;
      expect(wrapBtn.getAttribute('aria-pressed')).toBe('false');
      expect(linesBox.classList.contains('wrap')).toBe(false);

      wrapBtn.click();

      expect(pad.wrap).toBe(true);
      expect(wrapBtn.getAttribute('aria-pressed')).toBe('true');
      expect(linesBox.classList.contains('wrap')).toBe(true);
      expect(onSaveWrap).toHaveBeenCalledWith(true);
    });

    it('debounces save writes after 200ms and flashes save badge', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Initial'],
        onSave
      });

      const ta = container.querySelector<HTMLTextAreaElement>('.callpad-row textarea')!;
      ta.value = 'Updated text';
      ta.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onSave).not.toHaveBeenCalled();

      // Fast-forward 199ms
      vi.advanceTimersByTime(199);
      expect(onSave).not.toHaveBeenCalled();

      // Fast-forward 1ms (total 200ms)
      vi.advanceTimersByTime(1);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(['Updated text']);

      const saveBadge = container.querySelector('#callpadSaveStatus');
      expect(saveBadge?.classList.contains('on')).toBe(true);

      // Fast-forward 900ms badge flash
      vi.advanceTimersByTime(900);
      expect(saveBadge?.classList.contains('on')).toBe(false);
    });

    it('mousedown below rows pushes a new line if last has text, but never creates more than one trailing empty line', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Non-empty line'],
        onSave
      });

      const linesBox = container.querySelector<HTMLElement>('#callpadLines')!;

      // Click 1 on blank area below rows
      const clickEvent1 = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      linesBox.dispatchEvent(clickEvent1);

      let textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
      expect(textareas[1].value).toBe('');
      expect(document.activeElement).toBe(textareas[1]);

      // Click 2 on blank area below rows (last line is already empty)
      const clickEvent2 = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      linesBox.dispatchEvent(clickEvent2);

      // Still exactly 2 lines
      textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
      expect(document.activeElement).toBe(textareas[1]);

      // Click 3 again
      const clickEvent3 = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      linesBox.dispatchEvent(clickEvent3);
      textareas = container.querySelectorAll<HTMLTextAreaElement>('.callpad-row textarea');
      expect(textareas.length).toBe(2);
    });

    it('mousedown on a row focuses that row\'s textarea at the end', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['First line', 'Second line'],
        onSave
      });

      const rows = container.querySelectorAll<HTMLElement>('.callpad-row');
      const firstRow = rows[0];

      // Dispatch mousedown directly on the row container (gutter area)
      const rowMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      firstRow.dispatchEvent(rowMouseDown);

      const firstTa = firstRow.querySelector('textarea')!;
      expect(document.activeElement).toBe(firstTa);
      expect(firstTa.selectionStart).toBe('First line'.length);
    });

    it('handles multi-line paste on delegated container', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Prefix Suffix'],
        onSave
      });

      const ta = container.querySelector<HTMLTextAreaElement>('.callpad-row textarea')!;
      ta.selectionStart = 7;
      ta.selectionEnd = 7;

      const clipboardData = {
        getData: (format: string) => (format === 'text' ? 'A\nB' : '')
      };
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
      pasteEvent.clipboardData = clipboardData;
      ta.dispatchEvent(pasteEvent);

      const lines = pad.getLines();
      expect(lines).toEqual(['Prefix A', 'BSuffix']);
    });

    it('copies single line and morphs to check icon on row copy button click', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Copy me please'],
        onCopy
      });

      const cpBtn = container.querySelector<HTMLButtonElement>('.callpad-cp-btn')!;
      expect(cpBtn.querySelector('svg.lucide-copy')).toBeTruthy();

      cpBtn.click();

      expect(onCopy).toHaveBeenCalledWith('Copy me please');
      expect(cpBtn.classList.contains('done')).toBe(true);
      expect(cpBtn.classList.contains('copied-success')).toBe(true);
      expect(cpBtn.querySelector('svg.lucide-check')).toBeTruthy();

      vi.advanceTimersByTime(1100);
      expect(cpBtn.classList.contains('done')).toBe(false);
      expect(cpBtn.querySelector('svg.lucide-copy')).toBeTruthy();
    });

    it('copies all non-empty lines on Copy All button click and morphs icon/text', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', '', 'Line 2'],
        onCopy
      });

      const copyAllBtn = container.querySelector<HTMLButtonElement>('#callpadBtnCopyAll')!;
      expect(copyAllBtn.querySelector('svg.lucide-copy')).toBeTruthy();
      expect(copyAllBtn.textContent?.trim()).toBe('Copy All');

      copyAllBtn.click();

      expect(onCopy).toHaveBeenCalledWith('Line 1\nLine 2');
      expect(copyAllBtn.classList.contains('done')).toBe(true);
      expect(copyAllBtn.classList.contains('copied-success')).toBe(true);
      expect(copyAllBtn.querySelector('svg.lucide-check')).toBeTruthy();
      expect(copyAllBtn.textContent?.trim()).toBe('Copied');

      vi.advanceTimersByTime(1100);
      expect(copyAllBtn.classList.contains('done')).toBe(false);
      expect(copyAllBtn.querySelector('svg.lucide-copy')).toBeTruthy();
      expect(copyAllBtn.textContent?.trim()).toBe('Copy All');
    });

    it('two-step clear: 1st click arms the trash icon, 2nd click executes clear', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', 'Line 2'],
        onSave
      });

      const clearBtn = container.querySelector<HTMLButtonElement>('#callpadBtnClear')!;
      expect(clearBtn.classList.contains('armed')).toBe(false);

      // Step 1: Click once to arm
      clearBtn.click();
      expect(clearBtn.classList.contains('armed')).toBe(true);
      expect(pad.getLines()).toEqual(['Line 1', 'Line 2']); // Not cleared yet

      // Step 2: Click while armed to confirm clear
      clearBtn.click();
      expect(clearBtn.classList.contains('armed')).toBe(false);
      expect(pad.getLines()).toEqual(['']);
      const textareas = container.querySelectorAll('.callpad-row textarea');
      expect(textareas.length).toBe(1);
    });

    it('two-step clear: automatically disarms if 2.5s passes without 2nd click', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', 'Line 2'],
        onSave
      });

      const clearBtn = container.querySelector<HTMLButtonElement>('#callpadBtnClear')!;
      clearBtn.click();
      expect(clearBtn.classList.contains('armed')).toBe(true);

      // Advance 2500ms
      vi.advanceTimersByTime(2500);
      expect(clearBtn.classList.contains('armed')).toBe(false);
      expect(pad.getLines()).toEqual(['Line 1', 'Line 2']); // Not cleared
    });
  });
});
