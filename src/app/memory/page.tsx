'use client';

/**
 * Memory: your own words, searchable. Ask a question and get an answer
 * from your transcripts and notes with the sources, browse everything, and
 * add more by pasting or uploading. Automatic imports are set up in
 * Setup > Memory connections (MEMORY.md).
 */
import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, PrimaryBtn, useToast } from '@/components/crm/kit';
import { AddDocument } from '@/components/memory/add-document';
import { AskPanel } from '@/components/memory/ask-panel';
import { DocumentList } from '@/components/memory/document-list';

export default function MemoryPage() {
  const { show, node: toastNode } = useToast();
  const [adding, setAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <PageHeader title="Memory" className="!px-4 sm:!px-12">
        <Link href="/memory/new" className="text-[13px] px-3.5 py-2 rounded-lg border border-minimal-border text-white hover:border-zinc-500">
          New note
        </Link>
        <PrimaryBtn onClick={() => setAdding(true)}>Upload a file</PrimaryBtn>
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-4 sm:px-12 pb-16">
        <div className="flex flex-col gap-10 max-w-4xl">
          <AskPanel />
          <DocumentList refreshKey={refreshKey} />
        </div>
      </div>
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
