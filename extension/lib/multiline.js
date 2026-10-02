/**
 * Auto-expanding multiline textarea utility
 * Starts at single row height, auto-expands up to maxLines, and enables vertical scrolling beyond maxLines.
 * Preserves user manual resize drag handle.
 *
 * @param {HTMLTextAreaElement} textarea 
 * @param {number} [maxLines=4] 
 * @returns {{ adjustHeight: () => void, reset: () => void, destroy: () => void }}
 */
export function attachAutoExpand(textarea, maxLines = 4) {
  if (!textarea) return { adjustHeight: () => {}, reset: () => {}, destroy: () => {} };

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
  const parsedMax = clamp(parseInt(maxLines || textarea.dataset.maxLines || 4, 10), 2, 10);

  textarea.style.resize = 'vertical';
  textarea.style.minHeight = '24px';
  textarea.style.boxSizing = 'border-box';

  let isManualResize = false;

  const onMouseDown = (e) => {
    const rect = textarea.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && e.clientX >= rect.right - 18 && e.clientY >= rect.bottom - 18) {
      isManualResize = true;
    }
  };

  const adjustHeight = () => {
    if (isManualResize && textarea.value.trim().length > 0) {
      return;
    }
    if (textarea.value.trim().length === 0) {
      isManualResize = false;
    }

    textarea.style.height = 'auto';
    const computed = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(textarea) : null;
    const lineHeight = computed ? (parseFloat(computed.lineHeight) || 18) : 18;
    const paddingTop = computed ? (parseFloat(computed.paddingTop) || 4) : 4;
    const paddingBottom = computed ? (parseFloat(computed.paddingBottom) || 4) : 4;
    const borderTop = computed ? (parseFloat(computed.borderTopWidth) || 0) : 0;
    const borderBottom = computed ? (parseFloat(computed.borderBottomWidth) || 0) : 0;
    
    const extraHeight = paddingTop + paddingBottom + borderTop + borderBottom;
    const singleLineHeight = lineHeight + extraHeight;
    const maxHeight = (lineHeight * parsedMax) + extraHeight;

    const scrollH = textarea.scrollHeight;
    if (scrollH <= singleLineHeight + 2) {
      textarea.style.height = `${singleLineHeight}px`;
      textarea.style.overflowY = 'hidden';
    } else if (scrollH >= maxHeight) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.height = `${scrollH}px`;
      textarea.style.overflowY = 'hidden';
    }
  };

  const onInput = () => {
    adjustHeight();
  };

  textarea.addEventListener('mousedown', onMouseDown);
  textarea.addEventListener('input', onInput);

  adjustHeight();

  return {
    adjustHeight,
    reset: () => {
      isManualResize = false;
      textarea.value = '';
      adjustHeight();
    },
    destroy: () => {
      textarea.removeEventListener('mousedown', onMouseDown);
      textarea.removeEventListener('input', onInput);
    }
  };
}
