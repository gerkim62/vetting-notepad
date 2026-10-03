/**
 * Auto-expanding multiline textarea utility
 * Starts at single row height, auto-expands up to maxLines, and enables vertical scrolling beyond maxLines.
 * Preserves user manual resize drag handle and allows dynamic line-limit adjustments.
 */

export interface AutoExpandOptions {
  maxLines?: number;
  onResizeLines?: (lines: number) => void;
}

export interface AutoExpandController {
  adjustHeight: () => void;
  setMaxLines: (lines: number) => void;
  reset: () => void;
  destroy: () => void;
}

export function attachAutoExpand(
  textarea: HTMLTextAreaElement | null,
  maxLinesOrOptions: number | AutoExpandOptions = 4
): AutoExpandController {
  if (!textarea) {
    return {
      adjustHeight: () => {},
      setMaxLines: () => {},
      reset: () => {},
      destroy: () => {}
    };
  }

  const options: AutoExpandOptions =
    typeof maxLinesOrOptions === 'number'
      ? { maxLines: maxLinesOrOptions }
      : maxLinesOrOptions || {};

  const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);
  const rawMax = textarea.dataset.maxLines ? parseInt(textarea.dataset.maxLines, 10) : (options.maxLines || 4);
  let parsedMax = clamp(isNaN(rawMax) ? 4 : rawMax, 2, 10);
  textarea.dataset.maxLines = String(parsedMax);

  textarea.style.resize = 'vertical';
  textarea.style.minHeight = '24px';
  textarea.style.boxSizing = 'border-box';

  let isManualResize = false;

  const onMouseDown = (e: MouseEvent): void => {
    const rect = textarea.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && e.clientX >= rect.right - 18 && e.clientY >= rect.bottom - 18) {
      isManualResize = true;
    }
  };

  const getMetrics = () => {
    const computed = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(textarea) : null;
    const lineHeight = computed ? (parseFloat(computed.lineHeight) || 18) : 18;
    const paddingTop = computed ? (parseFloat(computed.paddingTop) || 4) : 4;
    const paddingBottom = computed ? (parseFloat(computed.paddingBottom) || 4) : 4;
    const borderTop = computed ? (parseFloat(computed.borderTopWidth) || 0) : 0;
    const borderBottom = computed ? (parseFloat(computed.borderBottomWidth) || 0) : 0;
    const extraHeight = paddingTop + paddingBottom + borderTop + borderBottom;
    return { lineHeight, extraHeight };
  };

  const onMouseUp = (): void => {
    if (isManualResize) {
      const { lineHeight, extraHeight } = getMetrics();
      const currentH = textarea.offsetHeight;
      const calculatedLines = clamp(Math.round((currentH - extraHeight) / lineHeight), 2, 10);
      parsedMax = calculatedLines;
      textarea.dataset.maxLines = String(calculatedLines);
      if (typeof options.onResizeLines === 'function') {
        options.onResizeLines(calculatedLines);
      }
    }
  };

  const adjustHeight = (): void => {
    if (isManualResize && textarea.value.trim().length > 0) {
      return;
    }
    if (textarea.value.trim().length === 0) {
      isManualResize = false;
    }

    textarea.style.height = 'auto';
    const { lineHeight, extraHeight } = getMetrics();
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

  const onInput = (): void => {
    adjustHeight();
  };

  const setMaxLines = (lines: number): void => {
    parsedMax = clamp(lines, 2, 10);
    textarea.dataset.maxLines = String(parsedMax);
    isManualResize = false;
    adjustHeight();
  };

  textarea.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  textarea.addEventListener('input', onInput);

  adjustHeight();

  return {
    adjustHeight,
    setMaxLines,
    reset: () => {
      isManualResize = false;
      textarea.value = '';
      adjustHeight();
    },
    destroy: () => {
      textarea.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      textarea.removeEventListener('input', onInput);
    }
  };
}
