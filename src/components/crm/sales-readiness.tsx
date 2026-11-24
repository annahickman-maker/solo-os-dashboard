'use client';

/**
 * Setup card: which pieces the sales page needs are in place, for each of its
 * four flows (leads, payment, bookings, digital delivery). Reads presence
 * flags from /api/settings/modules; never a secret value.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from './kit';
import { ConnectionsCard, type ConnectionRow } from './connections-card';

type Modules = {
  email: { configured: boolean; safe_mode?: boolean };
  payments: { configured: boolean; test_mode: boolean; secret_key?: boolean; webhook_secret?: boolean };
  checkout_key?: { minted: boolean; name?: string; only_checkout?: boolean; unavailable?: boolean };
  bookings?: { webhook_secret: boolean };
  digital_delivery?: { ready: boolean };
};

function rows(m: Modules, captureKey: boolean): ConnectionRow[] {
  const key = m.checkout_key;
  return [
    {
      label: 'Capture key',
      state: captureKey ? 'ok' : 'off',
      detail: captureKey ? 'Generated below. The site holds the same value as CRM_CAPTURE_KEY.' : 'Generate it below, then give it to the site as CRM_CAPTURE_KEY.',
    },
    {
      label: 'Stripe secret key',
      state: m.payments.secret_key ? 'ok' : 'off',
      detail: m.payments.secret_key ? (m.payments.test_mode ? 'Test key set: no real money moves.' : 'Live key set.') : 'Not set (STRIPE_SECRET_KEY).',
    },
    {
      label: 'Stripe webhook secret',
      state: m.payments.webhook_secret ? 'ok' : 'off',
      detail: m.payments.webhook_secret ? 'Set. Paid orders are recorded.' : 'Not set (STRIPE_WEBHOOK_SECRET). Checkout stays off without it.',
    },
    {
      label: 'Checkout key',
      state: key?.minted ? (key.only_checkout ? 'ok' : 'warn') : 'off',
      detail: key?.minted
        ? key.only_checkout
          ? `"${key.name}" can open checkout and nothing else.`
          : `"${key.name}" holds more than money:checkout. Mint a key with only that scope for the site.`
        : key?.unavailable
          ? 'Agent keys are unavailable (migration 015).'
          : 'Not minted. Create one with only money:checkout in Agent access.',
    },
    {
      label: 'Email sending',
      state: !m.email.configured ? 'off' : m.email.safe_mode === false ? 'ok' : 'warn',
      detail: !m.email.configured
        ? 'No RESEND_API_KEY: every email, including deliveries, is simulated.'
        : m.email.safe_mode === false
          ? 'Live: deliveries and reminders really send.'
          : 'Safe mode: deliveries are recorded as simulated until you go live.',
    },
    {
      label: 'Digital delivery',
      state: m.digital_delivery?.ready ? 'ok' : 'off',
      detail: m.digital_delivery?.ready ? 'Ready: a paid digital product emails its link once.' : 'Apply migration 021 to turn it on.',
    },
    {
      label: 'Cal.com webhook secret',
      state: m.bookings?.webhook_secret ? 'ok' : 'off',
      detail: m.bookings?.webhook_secret ? 'Set. Bookings arrive as contacts with an open deal.' : 'Not set (CALCOM_WEBHOOK_SECRET). See BOOKINGS.md.',
    },
  ];
}

export default function SalesReadiness({ captureKey }: { captureKey: boolean }) {
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
      title="Sales page connections"
      intro="What your sales page needs to collect contacts, take payment, book calls and deliver digital products. A key being set does not prove it works: make one test purchase and one test booking."
      rows={data ? rows(data, captureKey) : null}
      error={error}
      footer={
        <>
          <Link className="underline" href="/crm/settings/agents?preset=checkout">
            Mint the checkout key
          </Link>
          <Link className="underline" href="/sales">
            Products and orders
          </Link>
        </>
      }
    />
  );
}
