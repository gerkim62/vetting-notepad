import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCallPadCopyAll, serializeCallPad, SmartCallPad } from '../../extension/lib/callpad.js';

describe('Smart CallPad', () => {
  it('formats copy all text by joining non-empty lines with newline', () => {
    const lines = ['0712345678', '   ', 'Ticket-99881', 'Customer called about reversal', ''];
    const res = formatCallPadCopyAll(lines);
    expect(res).toBe('0712345678\nTicket-99881\nCustomer called about reversal');
  });

  it('serializes lines properly', () => {
    const lines = ['First note', 'Second note'];
    expect(serializeCallPad(lines)).toEqual(['First note', 'Second note']);
  });

  describe('SmartCallPad DOM Component', () => {
    let container;
    let onSave;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      onSave = vi.fn();
    });

    it('renders initial lines or at least one empty line', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['0722000000', 'ID: 12345678'],
        onSave
      });

      const inputs = container.querySelectorAll('.callpad-line-input');
      expect(inputs.length).toBe(2);
      expect(inputs[0].value).toBe('0722000000');
      expect(inputs[1].value).toBe('ID: 12345678');
    });

    it('inserts a new line when Enter is pressed', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['First line'],
        onSave
      });

      const firstInput = container.querySelector('.callpad-line-input');
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      firstInput.dispatchEvent(enterEvent);

      const inputs = container.querySelectorAll('.callpad-line-input');
      expect(inputs.length).toBe(2);
    });

    it('removes empty line on Backspace when multiple lines exist', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', ''],
        onSave
      });

      const inputs = container.querySelectorAll('.callpad-line-input');
      expect(inputs.length).toBe(2);

      const secondInput = inputs[1];
      const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
      secondInput.dispatchEvent(backspaceEvent);

      const updatedInputs = container.querySelectorAll('.callpad-line-input');
      expect(updatedInputs.length).toBe(1);
      expect(updatedInputs[0].value).toBe('Line 1');
    });

    it('clears all lines to a single blank line when clearAll is invoked', () => {
      const pad = new SmartCallPad({
        container,
        initialLines: ['Line 1', 'Line 2'],
        onSave
      });

      pad.clearAll();
      const inputs = container.querySelectorAll('.callpad-line-input');
      expect(inputs.length).toBe(1);
      expect(inputs[0].value).toBe('');
      expect(pad.getLines()).toEqual(['']);
    });
  });
});
