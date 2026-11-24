import test from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, titleFromMarkdown, type PmNode } from './note-markdown.ts';

const t = (text: string, marks: string[] = []): PmNode => ({ type: 'text', text, marks: marks.map((type) => ({ type })) });

test('headings, bold, lists become Markdown', () => {
  const doc: PmNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('Pricing ideas')] },
      { type: 'paragraph', content: [t('Raise prices when '), t('full', ['bold'])] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [t('one')] }] },
        { type: 'listItem', content: [
          { type: 'paragraph', content: [t('two')] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('nested')] }] }] },
        ] },
      ] },
      { type: 'orderedList', attrs: { start: 1 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [t('first')] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [t('second')] }] },
      ] },
    ],
  };
  assert.equal(toMarkdown(doc), '## Pricing ideas\n\nRaise prices when **full**\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n');
});

test('title strips markers', () => {
  assert.equal(titleFromMarkdown('## **Big** idea\nmore'), 'Big idea');
  assert.equal(titleFromMarkdown('- a bullet'), 'a bullet');
  assert.equal(titleFromMarkdown('\n\n'), 'Untitled note');
});
