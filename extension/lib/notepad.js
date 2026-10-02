/**
 * Rich Text Notepad Controller with Offline Quill.js Integration
 * Supports ultra-compact 200px formatting toolbar and dual HTML/plain-text clipboard write.
 */

export function calculateNoteStats(text) {
  if (!text || typeof text !== 'string') {
    return { chars: 0, words: 0 };
  }
  const clean = text.trim();
  if (!clean) {
    return { chars: 0, words: 0 };
  }
  const chars = clean.length;
  const words = clean.split(/\s+/).filter(Boolean).length;
  return { chars, words };
}

export function formatNoteDualCopy(html, plainText) {
  return {
    html: html || '',
    text: plainText || ''
  };
}

export async function writeDualClipboard(html, plainText) {
  const plain = (plainText || '').trim();
  const rich = html || `<p>${plain}</p>`;

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      try {
        const textBlob = new Blob([plain], { type: 'text/plain' });
        const htmlBlob = new Blob([rich], { type: 'text/html' });
        const item = new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob
        });
        await navigator.clipboard.write([item]);
        return true;
      } catch (err) {
        // Fallback to writeText if write([ClipboardItem]) is restricted
      }
    }

    if (navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(plain);
      return true;
    }
  }
  return false;
}

import { marked } from '../vendor/marked/marked.esm.js';
import DOMPurify from '../vendor/dompurify/purify.es.mjs';

export function isMarkdownText(text) {
  if (!text || typeof text !== 'string') return false;
  return /(?:^#{1,6}\s+|^\s*[\*\-]\s+|^\s*\d+\.\s+|\*\*.*?\*\*|\*.*?\*|`.*?`|^>\s+|^-{3,})/m.test(text);
}

export function markdownToHtml(md) {
  if (!md || typeof md !== 'string') return '';
  const rawHtml = marked.parse(md, { gfm: true, breaks: true });
  if (typeof window !== 'undefined') {
    const purifier = DOMPurify && DOMPurify.sanitize ? DOMPurify : (typeof DOMPurify === 'function' ? DOMPurify(window) : null);
    if (purifier && purifier.sanitize) {
      return purifier.sanitize(rawHtml);
    }
  }
  return rawHtml;
}

export class RichNotepad {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.mountElement
   * @param {string} [options.initialContent]
   * @param {(data: { html: string, text: string, chars: number, words: number }) => void} [options.onChange]
   * @param {any} [options.QuillClass]
   */
  constructor(options) {
    this.mountElement = options.mountElement;
    this.onChange = options.onChange || (() => {});
    const QuillClass = options.QuillClass || (typeof window !== 'undefined' ? window.Quill : null);

    this.quill = null;
    this.fallbackTextarea = null;

    if (QuillClass && this.mountElement) {
      try {
        this.quill = new QuillClass(this.mountElement, {
          theme: 'snow',
          placeholder: 'Start typing notes...',
          modules: {
            toolbar: [
              ['bold', 'italic', 'underline'],
              [{ list: 'bullet' }, { list: 'ordered' }],
              ['clean']
            ]
          }
        });

        if (options.initialContent) {
          this.setContent(options.initialContent);
        }

        if (this.quill.root) {
          this.quill.root.addEventListener('paste', (e) => {
            const clipboardData = e.clipboardData || (typeof window !== 'undefined' ? window.clipboardData : null);
            if (!clipboardData) return;
            const plain = clipboardData.getData('text/plain');
            const html = clipboardData.getData('text/html');
            if (plain && !html && isMarkdownText(plain)) {
              e.preventDefault();
              const converted = markdownToHtml(plain);
              const selection = this.quill.getSelection() || { index: Math.max(0, this.quill.getLength() - 1), length: 0 };
              this.quill.clipboard.dangerouslyPasteHTML(selection.index, converted);
            }
          });
        }

        this.quill.on('text-change', () => {
          const text = this.getText();
          const html = this.getHTML();
          const stats = calculateNoteStats(text);
          this.onChange({ html, text, chars: stats.chars, words: stats.words });
        });
      } catch (err) {
        this.initFallback(options.initialContent);
      }
    } else {
      this.initFallback(options.initialContent);
    }
  }

  initFallback(initialContent = '') {
    if (!this.mountElement) return;
    this.mountElement.innerHTML = '';
    const tx = document.createElement('textarea');
    tx.className = 'note-body-textarea';
    tx.placeholder = 'Start typing notes...';
    tx.value = initialContent || '';
    this.mountElement.appendChild(tx);
    this.fallbackTextarea = tx;

    tx.addEventListener('input', () => {
      const text = tx.value;
      const stats = calculateNoteStats(text);
      this.onChange({ html: `<p>${this.escapeHtml(text)}</p>`, text, chars: stats.chars, words: stats.words });
    });
  }

  setContent(content) {
    if (this.quill) {
      if (typeof content === 'string' && (content.startsWith('<') || content.includes('</'))) {
        this.quill.root.innerHTML = content;
      } else {
        this.quill.setText(content || '');
      }
    } else if (this.fallbackTextarea) {
      this.fallbackTextarea.value = content || '';
    }
  }

  getText() {
    if (this.quill) {
      return this.quill.getText().trim();
    }
    return this.fallbackTextarea ? this.fallbackTextarea.value.trim() : '';
  }

  getHTML() {
    if (this.quill) {
      return this.quill.root.innerHTML;
    }
    const val = this.fallbackTextarea ? this.fallbackTextarea.value : '';
    return `<p>${this.escapeHtml(val)}</p>`;
  }

  focus() {
    if (this.quill) {
      this.quill.focus();
    } else if (this.fallbackTextarea) {
      this.fallbackTextarea.focus();
    }
  }

  escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
}
