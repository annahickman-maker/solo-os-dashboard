'use client';

/** A new note, written straight into memory. Saves itself as you type. */
import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/crm/kit';
import { NoteEditor, newNoteId } from '@/components/memory/note-editor';

export default function NewNotePage() {
  const [id] = useState(newNoteId);
  return (
    <div className="flex flex-col h-full">
      <PageHeader title={<Link href="/memory" className="hover:underline">Memory</Link>} className="!px-4 sm:!px-12" />
      <div className="flex-1 overflow-y-auto px-4 sm:px-12 pb-10">
        <NoteEditor sourceId={id} />
      </div>
    </div>
  );
}
