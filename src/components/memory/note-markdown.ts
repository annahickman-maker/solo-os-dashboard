/**
 * Notes are stored as plain Markdown so Memory search reads clean text.
 * The editor works in ProseMirror JSON; this turns it into Markdown.
 * Supported: headings, paragraphs, bullet and numbered lists (nested),
 * bold, italic, strike, inline code, hard breaks, blockquotes, rules.
 */
export type PmMark = { type: string };
export type PmNode = { type: string; text?: string; marks?: PmMark[]; attrs?: Record<string, unknown>; content?: PmNode[] };

function inline(nodes: PmNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type !== 'text' || !n.text) return '';
      let t = n.text;
      const marks = (n.marks || []).map((m) => m.type);
      if (marks.includes('code')) t = '`' + t + '`';
      if (marks.includes('bold')) t = `**${t}**`;
      if (marks.includes('italic')) t = `*${t}*`;
      if (marks.includes('strike')) t = `~~${t}~~`;
      return t;
    })
    .join('');
}

function block(node: PmNode, indent: string): string[] {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return [`${indent}${'#'.repeat(level)} ${inline(node.content)}`];
    }
    case 'paragraph':
      return [`${indent}${inline(node.content)}`];
    case 'blockquote':
      return (node.content || []).flatMap((c) => block(c, indent)).map((l) => `> ${l}`);
    case 'horizontalRule':
      return [`${indent}---`];
    case 'codeBlock':
      return [`${indent}\`\`\``, ...inline(node.content).split('\n').map((l) => indent + l), `${indent}\`\`\``];
    case 'bulletList':
    case 'orderedList': {
      const start = Number(node.attrs?.start) || 1;
      return (node.content || []).flatMap((item, i) => {
        const marker = node.type === 'bulletList' ? '- ' : `${start + i}. `;
        const parts = item.content || [];
        const lines: string[] = [];
        parts.forEach((p, j) => {
          if (j === 0 && p.type === 'paragraph') lines.push(`${indent}${marker}${inline(p.content)}`);
          else lines.push(...block(p, indent + ' '.repeat(marker.length)));
        });
        if (!lines.length) lines.push(`${indent}${marker}`);
        return lines;
      });
    }
    default:
      return node.content ? node.content.flatMap((c) => block(c, indent)) : [];
  }
}

export function toMarkdown(doc: PmNode): string {
  const out: string[] = [];
  for (const node of doc.content || []) {
    const lines = block(node, '');
    out.push(lines.join('\n'));
    out.push("");
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Plain first line for the title, without Markdown markers. */
export function titleFromMarkdown(md: string): string {
  const first = md.split('\n').map((l) => l.trim()).find(Boolean) || 'Untitled note';
  return first.replace(/^(#+|[-*]|\d+\.|>)\s*/, '').replace(/[*_~`]/g, '').slice(0, 120) || 'Untitled note';
}
