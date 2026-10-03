import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initShortcuts } from '../../src/lib/shortcuts.js';

describe('Central Keyboard Shortcuts Engine', () => {
  let handlers: Record<string, any>;
  let destroy: (() => void) | undefined;

  beforeEach(() => {
    handlers = {
      toggleNotes: vi.fn(),
      toggleCallpad: vi.fn(),
      toggleBreaks: vi.fn(),
      toggleQuickSms: vi.fn(),
      toggleSettings: vi.fn(),
      togglePreview: vi.fn(),
      handleEscape: vi.fn(),
      copyVetting: vi.fn(),
      pasteVetting: vi.fn(),
      openTypeSearch: vi.fn(),
      showShortcuts: vi.fn(),
      passField: vi.fn(),
      failField: vi.fn()
    };
    destroy = initShortcuts(handlers);
  });

  afterEach(() => {
    if (destroy) destroy();
  });

  it('triggers toggleNotes on Alt+Shift+N', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'N',
      code: 'KeyN',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.toggleNotes).toHaveBeenCalledTimes(1);
  });

  it('triggers toggleCallpad on Alt+Shift+C', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.toggleCallpad).toHaveBeenCalledTimes(1);
  });

  it('triggers toggleBreaks on Alt+Shift+B', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'B',
      code: 'KeyB',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.toggleBreaks).toHaveBeenCalledTimes(1);
  });

  it('triggers toggleSettings on Alt+Shift+S', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'S',
      code: 'KeyS',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.toggleSettings).toHaveBeenCalledTimes(1);
  });

  it('triggers togglePreview on Alt+Shift+P', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'P',
      code: 'KeyP',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.togglePreview).toHaveBeenCalledTimes(1);
  });

  it('triggers toggleQuickSms on Alt+Shift+M', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'M',
      code: 'KeyM',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.toggleQuickSms).toHaveBeenCalledTimes(1);
  });

  it('triggers handleEscape on Escape', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.handleEscape).toHaveBeenCalledTimes(1);
  });

  it('triggers copyVetting on Ctrl+Enter', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.copyVetting).toHaveBeenCalledTimes(1);
  });

  it('triggers pasteVetting on Ctrl+Shift+V', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'V',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.pasteVetting).toHaveBeenCalledTimes(1);
  });

  it('triggers openTypeSearch on Ctrl+K', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.openTypeSearch).toHaveBeenCalledTimes(1);
  });

  it('triggers openTypeSearch on Ctrl+K even if findOrSearch handler is present', () => {
    handlers.findOrSearch = vi.fn(() => true);
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.openTypeSearch).toHaveBeenCalledTimes(1);
    expect(handlers.findOrSearch).not.toHaveBeenCalled();
  });

  it('triggers showShortcuts on ? when not in editable field', () => {
    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.showShortcuts).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger showShortcuts on ? when target is an input field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(event);
    expect(handlers.showShortcuts).not.toHaveBeenCalled();
    input.remove();
  });

  it('triggers showShortcuts on Ctrl+/', () => {
    const event = new KeyboardEvent('keydown', {
      key: '/',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.showShortcuts).toHaveBeenCalledTimes(1);
  });

  it('triggers showShortcuts on Alt+Shift+?', () => {
    const event = new KeyboardEvent('keydown', {
      key: '?',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.showShortcuts).toHaveBeenCalledTimes(1);
  });

  it('triggers passField on Alt+P', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      code: 'KeyP',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.passField).toHaveBeenCalledTimes(1);
  });

  it('triggers failField on Alt+F', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    expect(handlers.failField).toHaveBeenCalledTimes(1);
  });
});
