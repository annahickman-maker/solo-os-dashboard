'use client';

/**
 * Memory: your own words, searchable. Ask a question and get an answer
 * from your transcripts and notes with the sources, browse everything, and
 * add more by pasting or uploading. Automatic imports are set up in
 * Setup > Memory connections (MEMORY.md).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/crm/kit';
import { FilterTabs, ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import type { Kind } from '@/components/memory/types';
import { AddDocument } from '@/components/memory/add-document';
import { AskPanel } from '@/components/memory/ask-panel';
import { DocumentList } from '@/components/memory/document-list';

const KIND_TABS = [
  { value: '', label: 'all' },
  { value: 'conversation', label: 'conversations' },
  { value: 'content', label: 'content' },
  { value: 'note', label: 'notes' },
];

export default function MemoryPage() {
  const { show, node: toastNode } = useToast();
  const [adding, setAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [kind, setKind] = useState<'' | Kind>('');

  return (
    <div className="stack wide">
      {toastNode}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 'var(--h3)', fontWeight: 600, margin: 0 }}>Memory</h1>
        </div>
        <div className="lib-actions">
          <Link href="/memory/new" style={ghostButtonStyle}>New note</Link>
          <button type="button" style={solidButtonStyle} onClick={() => setAdding(true)}>Upload</button>
        </div>
      </div>

      <FilterTabs ariaLabel="kind" options={KIND_TABS} value={kind} onChange={(v) => setKind(v as '' | Kind)} />
      <AskPanel />
      <DocumentList refreshKey={refreshKey} kind={kind} />

      {adding && (
        <AddDocument
          uploadOnly
          onClose={() => setAdding(false)}
          onAdded={(message) => {
            setAdding(false);
            setRefreshKey((k) => k + 1);
            show(message);
          }}
        />
      )}
    </div>
  );
}
