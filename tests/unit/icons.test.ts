import { describe, it, expect, beforeEach } from 'vitest';
import { renderIcon, initIcons } from '../../src/lib/icons.js';

describe('Unified Lucide Icon Provider', () => {
  it('renders SVG HTML string for valid Lucide icon', () => {
    const svg = renderIcon('Copy', { size: 14, class: 'test-class' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="14"');
    expect(svg).toContain('height="14"');
    expect(svg).toContain('lucide-copy');
    expect(svg).toContain('test-class');
    expect(svg).toContain('</svg>');
  });

  it('renders Coffee and Utensils icons instead of emojis', () => {
    const coffeeSvg = renderIcon('Coffee', { size: 16 });
    expect(coffeeSvg).toContain('lucide-coffee');

    const utensilsSvg = renderIcon('Utensils', { size: 16 });
    expect(utensilsSvg).toContain('lucide-utensils');
  });

  it('handles unknown icon gracefully', () => {
    // @ts-expect-error Testing invalid name fallback
    const result = renderIcon('NonExistentIcon');
    expect(result).toBe('');
  });

  describe('DOM Hydration via initIcons()', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="container">
          <i data-lucide="settings" id="iconSettings"></i>
          <span data-lucide="check" id="iconCheck"></span>
        </div>
      `;
    });

    it('transforms [data-lucide] placeholders into SVG elements', () => {
      initIcons(document.getElementById('container') || undefined);

      const settingsSvg = document.querySelector('#container svg.lucide-settings');
      expect(settingsSvg).not.toBeNull();
      expect(settingsSvg?.getAttribute('viewBox')).toBe('0 0 24 24');

      const checkSvg = document.querySelector('#container svg.lucide-check');
      expect(checkSvg).not.toBeNull();
    });
  });
});
