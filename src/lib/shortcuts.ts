/**
 * Central Keyboard Shortcuts Router
 * Handles Alt+Shift+<Key> screen navigation and global productivity shortcuts.
 */

import { ShortcutHandlers } from '../types/index.js';

export function initShortcuts(handlers: ShortcutHandlers = {}): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    // 1. Alt + Shift + <Key> Screen Switchers
    if (e.altKey && e.shiftKey) {
      const code = e.code || `Key${(e.key || '').toUpperCase()}`;
      const key = (e.key || '').toUpperCase();

      if (code === 'KeyN' || key === 'N') {
        e.preventDefault();
        handlers.toggleNotes?.();
        return;
      }
      if (code === 'KeyC' || key === 'C') {
        e.preventDefault();
        handlers.toggleCallpad?.();
        return;
      }
      if (code === 'KeyB' || key === 'B') {
        e.preventDefault();
        handlers.toggleBreaks?.();
        return;
      }
      if (code === 'KeyS' || key === 'S') {
        e.preventDefault();
        handlers.toggleSettings?.();
        return;
      }
      if (code === 'KeyP' || key === 'P') {
        e.preventDefault();
        handlers.togglePreview?.();
        return;
      }
      if (code === 'KeyM' || key === 'M') {
        e.preventDefault();
        handlers.toggleQuickSms?.();
        return;
      }
    }

    // 2. Escape -> Return to main / close open modal/screen
    if (e.key === 'Escape') {
      handlers.handleEscape?.();
      return;
    }

    // 3. Ctrl/Cmd + Enter -> Copy Vetting
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handlers.copyVetting?.();
      return;
    }

    // 4. Ctrl/Cmd + Shift + V -> Paste Whole Vetting
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) {
      e.preventDefault();
      handlers.pasteVetting?.();
      return;
    }

    // 4b. Ctrl/Cmd + F -> Find/Search (e.g. Quick SMS)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')) {
      if (handlers.findOrSearch && handlers.findOrSearch()) {
        e.preventDefault();
        return;
      }
    }

    // 5. Ctrl/Cmd + K -> Reserved exclusively for Vetting Type Search
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
      e.preventDefault();
      handlers.openTypeSearch?.();
      return;
    }

    // 5b. Alt + P (Pass Field) & Alt + F (Fail Field)
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const k = (e.key || '').toLowerCase();
      const code = e.code || '';
      if (k === 'p' || code === 'KeyP') {
        e.preventDefault();
        handlers.passField?.();
        return;
      }
      if (k === 'f' || code === 'KeyF') {
        e.preventDefault();
        handlers.failField?.();
        return;
      }
    }

    // 6. '?' (when not in text input) OR Ctrl/Cmd + / OR Alt+Shift+? -> Show Shortcuts
    const target = e.target;
    const isTextInput = target instanceof HTMLElement && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.classList.contains('ql-editor')
    );

    if (
      (e.key === '?' && !isTextInput) ||
      ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) ||
      (e.altKey && e.shiftKey && (e.key === '?' || e.code === 'Slash'))
    ) {
      e.preventDefault();
      handlers.showShortcuts?.();
      return;
    }
  };

  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
