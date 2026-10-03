import { describe, it, expect, beforeEach } from 'vitest';
import { attachAutoExpand } from '../../src/lib/multiline.js';

describe('Multiline Auto-Expand Dynamic Controls', () => {
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
  });

  it('supports setMaxLines dynamically and updates dataset', () => {
    const handle = attachAutoExpand(textarea, { maxLines: 4 });
    expect(textarea.dataset.maxLines).toBe('4');

    handle.setMaxLines(8);
    expect(textarea.dataset.maxLines).toBe('8');

    handle.setMaxLines(15); // should clamp to 10
    expect(textarea.dataset.maxLines).toBe('10');

    handle.setMaxLines(1); // should clamp to 2
    expect(textarea.dataset.maxLines).toBe('2');

    handle.destroy();
  });

  it('triggers onResizeLines callback after mouse drag release', () => {
    let resizedLines = 0;
    const handle = attachAutoExpand(textarea, {
      maxLines: 4,
      onResizeLines: (lines) => {
        resizedLines = lines;
      }
    });

    // Simulate clicking drag handle (bottom-right 18px)
    Object.defineProperty(textarea, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 })
    });
    Object.defineProperty(textarea, 'offsetHeight', {
      value: 120
    });

    textarea.dispatchEvent(new MouseEvent('mousedown', { clientX: 195, clientY: 95 }));
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(resizedLines).toBeGreaterThanOrEqual(2);
    handle.destroy();
  });
});
