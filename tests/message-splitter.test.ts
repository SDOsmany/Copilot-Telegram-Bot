import { describe, expect, it } from 'vitest';
import { splitMessage, splitHtmlMessage } from '../src/utils/message-splitter';

describe('splitMessage', () => {
  it('splits long text into chunks', () => {
    const text = 'a'.repeat(5000);
    const parts = splitMessage(text, 4096);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
  });

  it('keeps code blocks together when possible', () => {
    const text = 'Intro\n\n```js\nconsole.log("test");\n```\n\nOutro';
    const parts = splitMessage(text, 4096);
    expect(parts.length).toBe(1);
    expect(parts[0]).toContain('```js');
  });
});

describe('splitHtmlMessage', () => {
  it('returns single chunk for short HTML', () => {
    const html = '<b>Hello</b> world';
    const parts = splitHtmlMessage(html, 4096);
    expect(parts).toEqual([html]);
  });

  it('splits long HTML into multiple chunks', () => {
    const html = '<b>' + 'a'.repeat(5000) + '</b>';
    const parts = splitHtmlMessage(html, 4096);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('closes and reopens tags across chunk boundaries', () => {
    const html = '<pre><code>' + 'x'.repeat(5000) + '</code></pre>';
    const parts = splitHtmlMessage(html, 4096);
    expect(parts.length).toBeGreaterThan(1);
    // First chunk should have closing tags
    expect(parts[0]).toMatch(/<\/code><\/pre>$/);
    // Second chunk should reopen tags
    expect(parts[1]).toMatch(/^<pre><code>/);
  });

  it('respects MAX_MESSAGE_PARTS cap', () => {
    const html = 'a'.repeat(100000);
    const parts = splitHtmlMessage(html, 100);
    expect(parts.length).toBeLessThanOrEqual(20);
  });

  it('each chunk fits within maxLength', () => {
    const html = '<b>' + 'word '.repeat(2000) + '</b>';
    const parts = splitHtmlMessage(html, 4096);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it('handles nested tags correctly', () => {
    const html = '<pre><code><b>' + 'y'.repeat(5000) + '</b></code></pre>';
    const parts = splitHtmlMessage(html, 4096);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toMatch(/<\/b><\/code><\/pre>$/);
    expect(parts[1]).toMatch(/^<pre><code><b>/);
  });
});
