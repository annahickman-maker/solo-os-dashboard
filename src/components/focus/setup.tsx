'use client';
/** First-run (and new-90-days) setup: focus statement and start date. Targets are set from the "set target" panel. */
import { useState } from 'react';
import { Field, PrimaryBtn, TextArea, TextInput } from '@/components/crm/kit';
import {
  FOCUS_WINDOW_DAYS, addDays, newPlan, parseDateKey, toDateKey, type ArchivedFocusPlan, type FocusPlan,
} from './types';

export function fmtDate(key: string) {
  const d = parseDateKey(key);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : key;
}

export function FocusSetup({ previous, onStart, onRestore }: {
  previous?: ArchivedFocusPlan; onStart: (plan: FocusPlan) => void; onRestore?: () => void;
}) {
  const [statement, setStatement] = useState('');
  const [startDate, setStartDate] = useState(() => toDateKey(new Date()));
  const validDate = parseDateKey(startDate) !== null;
  const ready = statement.trim().length > 0 && validDate;

  const submit = () => {
    if (!ready) return;
    onStart(newPlan({ statement: statement.trim(), startDate, revenueModel: previous?.revenueModel }));
  };

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-white">
          {previous ? 'What comes next?' : 'Pick one thing for the next 90 days.'}
        </h2>
        <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
          Two short steps. Then set your targets with the Set target button. You can change any of it later.
        </p>
      </div>

      <div className="border border-minimal-border rounded-lg p-6 flex flex-col gap-5">
        <Field label="1. Your focus">
          <TextArea rows={2} value={statement} autoFocus className="resize-y"
            placeholder="What are you focused on for the next 90 days?"
            onChange={(e) => setStatement(e.target.value)} />
        </Field>

        <Field label="2. Start date"
          hint={validDate ? `Ends ${fmtDate(addDays(startDate, FOCUS_WINDOW_DAYS))}, ${FOCUS_WINDOW_DAYS} days later` : undefined}>
          <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>

        <div className="flex flex-wrap items-center justify-end gap-4">
          {previous && onRestore && (
            <button type="button" className="text-[13px] text-zinc-500 hover:text-white underline underline-offset-2" onClick={onRestore}>
              Back to my last plan
            </button>
          )}
          <PrimaryBtn disabled={!ready} onClick={submit}>Start my 90 days</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
