import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCards, richText } from '../public/content.js';
import { deckCSV } from '../public/downloads.js';

test('CSV/TSV paste supports headers, quoted commas, escaped quotes, newlines and round trips', () => {
  const cards = [{ front: 'Name the "water, plant" tissue', back: 'Xylem\nCarries water', hint: 'Stem', tags: ['biology', 'plants'] }];
  assert.deepEqual(parseCards(deckCSV({ cards })), [{ ...cards[0], tags: 'biology, plants' }]);
  assert.deepEqual(parseCards('\uFEFFQuestion\tAnswer\r\nHello\tWorld\r\n'), [{ front: 'Hello', back: 'World', hint: '', tags: '' }]);
  assert.equal(parseCards('front;back;hint\nQ;A;H')[0].hint, 'H');
  assert.equal(parseCards('Back,Tags,Front\nA,tag,Q')[0].front, 'Q');
});

test('malformed imports cannot quietly shift or discard missing questions', () => {
  assert.throws(() => parseCards('\tAnswer\tHint'), /needs both/);
  assert.throws(() => parseCards('Question\t'), /needs both/);
  assert.throws(() => parseCards('Front,Back\nQ,'), /needs both/);
  assert.throws(() => parseCards('"Unclosed,Answer'), /closing quote/);
  assert.throws(() => parseCards('"Q"unexpected,A'), /Unexpected text/);
  assert.throws(() => parseCards('Q,A,H,T,extra'), /too many columns/);
  assert.throws(() => parseCards('Front,Back'), /between 1/);
});

test('simple card formatting escapes active HTML before adding allowed markup', () => {
  assert.equal(richText('**Bold** *italic* `code`\n<script>bad()</script>'), '<strong>Bold</strong> <em>italic</em> <code>code</code><br>&lt;script&gt;bad()&lt;/script&gt;');
  assert.doesNotMatch(richText('**<img src=x onerror=alert(1)>**'), /<img|<script/);
});
