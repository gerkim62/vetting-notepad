import { calculateNoteStats, formatNoteDualCopy, isMarkdownText, markdownToHtml } from '../../extension/lib/notepad.js';

describe('Rich Text Notepad Engine', () => {
  it('calculates word and character counts accurately', () => {
    const text = 'Safaricom M-PESA float reversal\nTicket: SR-10293\nCustomer satisfied';
    const stats = calculateNoteStats(text);
    expect(stats.chars).toBe(text.trim().length);
    expect(stats.words).toBe(8);
  });

  it('handles empty or whitespace-only text for counts', () => {
    const stats = calculateNoteStats('   \n  \t  ');
    expect(stats.chars).toBe(0);
    expect(stats.words).toBe(0);
  });

  it('formats dual-copy payload properly', () => {
    const html = '<p><strong>Safaricom</strong> Note</p>';
    const plain = 'Safaricom Note';
    const payload = formatNoteDualCopy(html, plain);
    expect(payload.html).toBe(html);
    expect(payload.text).toBe(plain);
  });

  describe('Markdown Paste Support', () => {
    it('detects markdown patterns accurately', () => {
      expect(isMarkdownText('## Title')).toBe(true);
      expect(isMarkdownText('- bullet point')).toBe(true);
      expect(isMarkdownText('* bullet point')).toBe(true);
      expect(isMarkdownText('1. numbered item')).toBe(true);
      expect(isMarkdownText('This is **bold** text')).toBe(true);
      expect(isMarkdownText('Just regular text without any markdown')).toBe(false);
    });

    it('converts markdown syntax to structured HTML for Quill', () => {
      const md = '## Call Summary\n**Agent**: John Doe\n- Customer verified ID\n- Issue resolved';
      const html = markdownToHtml(md);
      expect(html).toContain('<h2>Call Summary</h2>');
      expect(html).toContain('<strong>Agent</strong>: John Doe');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>Customer verified ID</li>');
      expect(html).toContain('<li>Issue resolved</li>');
      expect(html).toContain('</ul>');
    });

    it('supports h1 through h6 headings, blockquotes, and code blocks', () => {
      const md = '# H1\n###### H6\n> Important warning\n```js\nconst x = 1;\n```\n---';
      const html = markdownToHtml(md);
      expect(html).toContain('<h1>H1</h1>');
      expect(html).toContain('<h6>H6</h6>');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<pre><code');
      expect(html).toContain('<hr>');
    });

    it('sanitizes malicious script tags and inline handlers for XSS protection', () => {
      const malicious = '## Safe Title\n<script>alert("hacked")</script><img src=x onerror=alert(1)>';
      const html = markdownToHtml(malicious);
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('onerror');
      expect(html).toContain('<h2>Safe Title</h2>');
    });
  });
});
