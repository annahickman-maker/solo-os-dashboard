import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSystemPrompt, buildUserPrompt, cleanOptions, parseSource } from './prompt.ts';

const tool = { id: 'titles', label: 'title options', description: '', count: 3, instruction: 'Write titles.' };
const config = { board: 'longform' as const, medium: 'a long form YouTube video', role: 'a scriptwriter', tools: [tool] };

test('parseSource trims, caps and rejects empty input', () => {
  assert.equal(parseSource(null), null);
  assert.equal(parseSource({ title: '  ', notes: '' }), null);
  const s = parseSource({ title: ' A ', notes: 'x'.repeat(9000), platforms: ['Reels', 3], fromVideo: { title: 'V', notes: '' } });
  assert.equal(s?.title, 'A');
  assert.equal(s?.notes.length, 8000);
  assert.deepEqual(s?.platforms, ['Reels']);
  assert.deepEqual(s?.fromVideo, { title: 'V', notes: '' });
});

test('prompts carry the brand, the card and the requested count', () => {
  const system = buildSystemPrompt(config, 'BRAND', 'OFFERS');
  assert.match(system, /BRAND/);
  assert.match(system, /OFFERS/);
  const user = buildUserPrompt(tool, { title: 'My video', notes: 'notes here', fromVideo: { title: 'Long one', notes: 'n' } });
  assert.match(user, /exactly 3 options/);
  assert.match(user, /My video/);
  assert.match(user, /Long one/);
});

test('cleanOptions keeps strings, swaps dashes and caps the count', () => {
  assert.deepEqual(cleanOptions(['a \u2014 b', 2, ' ', 'c', 'd'], 2), ['a - b', 'c']);
  assert.deepEqual(cleanOptions('nope', 3), []);
});
