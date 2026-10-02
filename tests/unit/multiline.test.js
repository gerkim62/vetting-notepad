import { describe, it, expect, beforeEach } from 'vitest';
import { attachAutoExpand } from '../../extension/lib/multiline.js';

describe('Multiline Auto-Expand Engine', () => {
  let textarea;

  beforeEach(() => {
    textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
  });

  it('initializes textarea with vertical resize handle and single line minHeight', () => {
    const handle = attachAutoExpand(textarea, 4);
    expect(textarea.style.resize).toBe('vertical');
    expect(textarea.style.minHeight).toBe('24px');
    handle.destroy();
  });

  it('adjusts height dynamically on input', () => {
    const handle = attachAutoExpand(textarea, 4);
    
    // Simulate scrollHeight in jsdom
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => (textarea.value.includes('\n') ? 72 : 24)
    });

    textarea.value = 'Line 1\nLine 2\nLine 3';
    handle.adjustHeight();

    expect(parseFloat(textarea.style.height)).toBeGreaterThan(24);
    handle.destroy();
  });

  it('enables vertical scrolling when scrollHeight exceeds maxLines height', () => {
    const handle = attachAutoExpand(textarea, 3);

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => 200 // Exceeds 3 lines
    });

    textarea.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    handle.adjustHeight();

    expect(textarea.style.overflowY).toBe('auto');
    handle.destroy();
  });

  it('resets height and overflow when content is cleared', () => {
    const handle = attachAutoExpand(textarea, 4);

    textarea.value = 'Some content';
    handle.adjustHeight();

    handle.reset();
    expect(textarea.value).toBe('');
    expect(textarea.style.overflowY).toBe('hidden');
    handle.destroy();
  });
});
