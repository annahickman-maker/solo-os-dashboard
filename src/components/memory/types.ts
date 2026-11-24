/** Shapes the Memory page reads from /api/memory/*. */
export type Kind = 'conversation' | 'content' | 'note';

export const KIND_LABEL: Record<Kind, string> = { conversation: 'Conversation', content: 'Content', note: 'Note' };

export type DocumentSummary = {
  id: string;
  source: string;
  source_id: string;
  title: string;
  kind: Kind;
  occurred_at: string | null;
  url: string | null;
  chunk_count: number;
  bytes: number;
  created_at: string;
  updated_at: string;
};

export type Source = {
  number: number;
  document_id: string;
  title: string;
  kind: Kind;
  occurred_at: string | null;
  url: string | null;
  chunk_index: number;
  snippet: string;
};

export type Hit = Omit<Source, 'number'> & { matched: 'both' | 'meaning' | 'keywords' };

export function docDate(d: { occurred_at: string | null; created_at?: string }): string {
  const iso = d.occurred_at || d.created_at;
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function docHref(id: string, chunk?: number): string {
  return `/memory/${id}${chunk !== undefined ? `#passage-${chunk}` : ''}`;
}
