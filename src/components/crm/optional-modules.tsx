'use client';

/**
 * Setup card: the optional connections (email delivery, social calendar,
 * payments, Content studio). Same design as the sales page connections card.
 * Reads presence flags from /api/settings/modules; never a secret value.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from './kit';
import { ConnectionsCard, type ConnectionRow } from './connections-card';

type Modules = {
  social: { enabled: boolean };
  email: { configured: boolean; safe_mode?: boolean };
  payments: { configured: boolean; test_mode: boolean };
  studio: { bundled: boolean };
};

function rows(m: Modules): ConnectionRow[] {
  return [
    {
      label: 'Email delivery',
      state: m.email.configured ? (m.email.safe_mode === false ? 'ok' : 'warn') : 'off',
      detail: m.email.configured
        ? m.email.safe_mode === false
          ? 'Key set and live. Check your sender before big sends.'
          : 'Key set. Verify your sender and leave safe mode before sending.'
        : 'Not set. Emails are recorded as simulated.',
    },
    {
      label: 'Social calendar',
      state: m.social.enabled ? 'ok' : 'off',
      detail: m.social.enabled ? (
        <>
          On.{' '}
          <Link className="underline" href="/social/accounts">
            Manage connected accounts
          </Link>
          .
        </>
      ) : (
        'Off. Ask your manager to activate it.'
      ),
    },
    {
      label: 'Payment connection',
      state: m.payments.configured ? (m.payments.test_mode ? 'warn' : 'ok') : 'off',
      detail: m.payments.configured
        ? `${m.payments.test_mode ? 'Test keys set: no real money moves.' : 'Live keys set.'} Key presence does not prove checkout works.`
        : 'Not set.',
    },
    {
      label: 'Content studio',
      state: m.studio.bundled ? 'ok' : 'off',
      detail: m.studio.bundled ? 'Installed.' : 'Coming soon. A separate optional add-on, not included by default.',
    },
  ];
}

export default function OptionalModules() {
  const [data, setData] = useState<Modules | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    api<Modules>('/api/settings/modules', { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Could not check');
      });
    return () => c.abort();
  }, []);

  return (
    <ConnectionsCard
      title="Optional connections"
      intro="Your dashboard works without these extras. Ask your manager to set up the ones you need using your own accounts."
      rows={data ? rows(data) : null}
      error={error}
      footer={
        <Link className="underline" href="/crm/settings/agents">
          Manage agent access
        </Link>
      }
    />
  );
}
