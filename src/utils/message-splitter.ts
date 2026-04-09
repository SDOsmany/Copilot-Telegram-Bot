import { TELEGRAM_MAX_MESSAGE_LENGTH, MAX_MESSAGE_PARTS } from '../constants';

/**
 * Splits a long line into chunks of maximum length.
 * 
 * @param line - Line to split
 * @param maxLength - Maximum length per chunk
 * @returns Array of line chunks
 */
function splitLongLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) return [line];
  const parts: string[] = [];
  let start = 0;
  while (start < line.length) {
    parts.push(line.slice(start, start + maxLength));
    start += maxLength;
  }
  return parts;
}

/**
 * Attempts to add next chunk to current buffer, flushing if necessary.
 * 
 * @param result - Result array to flush to
 * @param current - Current buffer
 * @param nextChunk - Next chunk to add
 * @param maxLength - Maximum buffer length
 * @returns Updated buffer and flush status
 */
function pushChunk(
  result: string[],
  current: string,
  nextChunk: string,
  maxLength: number
): { current: string; flushed: boolean } {
  if (!nextChunk) return { current, flushed: false };
  if (current.length + nextChunk.length <= maxLength) {
    return { current: current + nextChunk, flushed: false };
  }
  if (current.length > 0) {
    result.push(current);
  }
  return { current: nextChunk, flushed: true };
}

/**
 * Splits a text segment respecting paragraph and line boundaries.
 * 
 * @param segment - Text segment to split
 * @param maxLength - Maximum length per chunk
 * @returns Array of text chunks
 */
function splitTextSegment(segment: string, maxLength: number): string[] {
  const result: string[] = [];
  const paragraphs = segment.split(/\n{2,}/);
  let current = '';

  paragraphs.forEach((paragraph, index) => {
    const prefix = index === 0 ? '' : '\n\n';
    const candidate = `${prefix}${paragraph}`;
    if (candidate.length <= maxLength) {
      const merged = pushChunk(result, current, candidate, maxLength);
      current = merged.current;
      return;
    }

    const lines = paragraph.split('\n');
    lines.forEach((line, lineIndex) => {
      const linePrefix = lineIndex === 0 ? prefix : '\n';
      const lineText = `${linePrefix}${line}`;
      if (lineText.length <= maxLength) {
        const merged = pushChunk(result, current, lineText, maxLength);
        current = merged.current;
        return;
      }

      const chunks = splitLongLine(lineText, maxLength);
      chunks.forEach((chunk) => {
        if (chunk.length > maxLength) return;
        const merged = pushChunk(result, current, chunk, maxLength);
        current = merged.current;
      });
    });
  });

  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Splits a long message into multiple chunks respecting Telegram's length limits.
 * Preserves code blocks and paragraph boundaries.
 * Operates on raw Markdown text.
 * 
 * @param text - The text to split
 * @param maxLength - Maximum length per message chunk
 * @returns Array of message chunks
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const segments: Array<{ type: 'text' | 'code'; value: string }> = [];
  const codeRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  const result: string[] = [];
  let current = '';

  for (const segment of segments) {
    if (segment.type === 'code') {
      if (segment.value.length > maxLength) {
        if (current.length > 0) {
          result.push(current);
          current = '';
        }
        result.push(...splitTextSegment(segment.value, maxLength));
        continue;
      }
      const merged = pushChunk(result, current, segment.value, maxLength);
      current = merged.current;
      continue;
    }

    const parts = splitTextSegment(segment.value, maxLength);
    parts.forEach((part) => {
      const merged = pushChunk(result, current, part, maxLength);
      current = merged.current;
    });
  }

  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Finds open HTML tags that haven't been closed yet.
 * Returns the tag names in order so they can be re-opened in the next chunk.
 */
function findUnclosedTags(html: string): string[] {
  const openTags: string[] = [];
  const tagRegex = /<\/?([a-z]+)[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    const fullMatch = m[0];
    const tagName = m[1].toLowerCase();
    if (fullMatch.startsWith('</')) {
      // Closing tag — pop the last matching open tag
      const idx = openTags.lastIndexOf(tagName);
      if (idx !== -1) openTags.splice(idx, 1);
    } else if (!fullMatch.endsWith('/>')) {
      openTags.push(tagName);
    }
  }
  return openTags;
}

/**
 * Splits already-formatted HTML text into chunks that respect Telegram's
 * message length limit. Ensures HTML tags are properly closed/reopened
 * across chunk boundaries.
 *
 * @param html - The HTML-formatted text to split
 * @param maxLength - Maximum length per message chunk (default: Telegram's 4096)
 * @returns Array of self-contained HTML chunks, capped at MAX_MESSAGE_PARTS
 */
export function splitHtmlMessage(html: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (html.length <= maxLength) return [html];

  const result: string[] = [];
  let remaining = html;

  while (remaining.length > 0 && result.length < MAX_MESSAGE_PARTS) {
    if (remaining.length <= maxLength) {
      result.push(remaining);
      break;
    }

    // Reserve space for closing tags we might need to add
    // Worst case: a few nested tags like </code></pre></b></i> ≈ ~50 chars
    const safeLimit = maxLength - 60;

    // Find a good split point: prefer splitting at paragraph/line boundaries
    let splitAt = safeLimit;

    // Try to split at a double newline (paragraph break)
    const doubleNewline = remaining.lastIndexOf('\n\n', safeLimit);
    if (doubleNewline > safeLimit * 0.5) {
      splitAt = doubleNewline;
    } else {
      // Try single newline
      const singleNewline = remaining.lastIndexOf('\n', safeLimit);
      if (singleNewline > safeLimit * 0.5) {
        splitAt = singleNewline;
      } else {
        // Try space
        const space = remaining.lastIndexOf(' ', safeLimit);
        if (space > safeLimit * 0.3) {
          splitAt = space;
        }
      }
    }

    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    // Close any unclosed tags in this chunk
    const unclosed = findUnclosedTags(chunk);
    for (let i = unclosed.length - 1; i >= 0; i--) {
      chunk += `</${unclosed[i]}>`;
    }

    result.push(chunk);

    // Re-open tags for the next chunk
    if (remaining.length > 0 && unclosed.length > 0) {
      const reopenPrefix = unclosed.map((tag) => `<${tag}>`).join('');
      remaining = reopenPrefix + remaining;
    }
  }

  // If we hit the cap, append a truncation notice
  if (remaining.length > 0 && result.length >= MAX_MESSAGE_PARTS) {
    const lastIdx = result.length - 1;
    const truncNotice = '\n\n⚠️ <i>Message truncated (too long)</i>';
    if (result[lastIdx].length + truncNotice.length <= maxLength) {
      result[lastIdx] += truncNotice;
    }
  }

  return result;
}
