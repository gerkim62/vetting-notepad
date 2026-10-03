/**
 * Rich Text Notepad Controller with Direct Quill.js Integration
 * Supports ultra-compact 200px formatting toolbar and dual HTML/plain-text clipboard write.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { logger } from './logger.js';

export interface NoteStats {
  chars: number;
  words: number;
}

export interface NoteChangeData {
  html: string;
  text: string;
  chars: number;
  words: number;
}

export interface RichNotepadOptions {
  mountElement: HTMLElement;
  initialContent?: string;
  onChange?: (data: NoteChangeData) => void;
  QuillClass?: typeof Quill;
}

export function calculateNoteStats(text?: string | null): NoteStats {
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

export function formatNoteDualCopy(html?: string | null, plainText?: string | null): { html: string; text: string } {
  return {
    html: html ?? '',
    text: plainText ?? ''
  };
}

export async function writeDualClipboard(html?: string | null, plainText?: string | null): Promise<boolean> {
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
        logger.warn('notepad', 'ClipboardItem write failed, falling back to writeText', { err });
      }
    }

    if (navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(plain);
        return true;
      } catch (err) {
        logger.captureError('notepad', err, { action: 'writeDualClipboardFallback' });
        return false;
      }
    }
  }
  return false;
}

export function isMarkdownText(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false;
  return /(?:^#{1,6}\s+|^\s*[*-]\s+|^\s*\d+\.\s+|\*\*.*?\*\*|\*.*?\*|`.*?`|^>\s+|^-{3,})/m.test(text);
}

export function markdownToHtml(md?: string | null): string {
  if (!md || typeof md !== 'string') return '';
  const parsed = marked.parse(md, { gfm: true, breaks: true });
  const rawHtml = typeof parsed === 'string' ? parsed : '';
  if (DOMPurify?.sanitize) {
    return DOMPurify.sanitize(rawHtml);
  }
  return rawHtml;
}

export class RichNotepad {
  mountElement: HTMLElement;
  onChange: (data: NoteChangeData) => void;
  quill: Quill | null = null;
  fallbackTextarea: HTMLTextAreaElement | null = null;

  constructor(options: RichNotepadOptions) {
    this.mountElement = options.mountElement;
    this.onChange = options.onChange ?? (() => {});
    const QuillClass = options.QuillClass ?? Quill;

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
          this.quill.root.addEventListener('paste', (e: ClipboardEvent) => {
            const clipboardData = e.clipboardData;
            if (!clipboardData) return;
            const plain = clipboardData.getData('text/plain');
            const html = clipboardData.getData('text/html');
            if (plain && !html && isMarkdownText(plain) && this.quill) {
              e.preventDefault();
              const converted = markdownToHtml(plain);
              const selection = this.quill.getSelection() ?? { index: Math.max(0, this.quill.getLength() - 1), length: 0 };
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
        logger.captureError('notepad', err, { action: 'initEditorQuill' });
        this.initFallback(options.initialContent);
      }
    } else {
      this.initFallback(options.initialContent);
    }
  }

  initFallback(initialContent = ''): void {
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

  setContent(content?: string | null): void {
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

  getText(): string {
    if (this.quill) {
      return this.quill.getText().trim();
    }
    return this.fallbackTextarea ? this.fallbackTextarea.value.trim() : '';
  }

  getHTML(): string {
    if (this.quill) {
      return this.quill.root.innerHTML;
    }
    const val = this.fallbackTextarea ? this.fallbackTextarea.value : '';
    return `<p>${this.escapeHtml(val)}</p>`;
  }

  focus(): void {
    if (this.quill) {
      this.quill.focus();
    } else if (this.fallbackTextarea) {
      this.fallbackTextarea.focus();
    }
  }

  escapeHtml(s: string): string {
    return String(s || '').replace(/[&<>"']/g, c => {
      const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[c] ?? c;
    });
  }
}
