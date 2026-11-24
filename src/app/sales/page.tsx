'use client';

/**
 * Sales: what the sales page sells and what has been bought.
 *
 * Products (add and edit through /api/crm/products), orders with their
 * digital delivery (/api/crm/sales) and this month's paid total. Prices are
 * typed in major units ("49.00") and stored as minor units; checkout always
 * charges what the product here says, never a price from the browser.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  EmptyState,
  Field,
  GhostBtn,
  Loading,
  Modal,
  PageHeader,
  PrimaryBtn,
  Select,
  StatusDot,
  TextArea,
  TextInput,
  fmtDate,
  useToast,
} from '@/components/crm/kit';
import { formatMinor, parseMajorToMinor, toMajor } from '@/lib/money/money';

type Kind = 'one_time' | 'subscription' | 'deposit' | 'digital' | 'invoice_item';

type Product = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: Kind;
  amount_minor: number;
  currency: string;
  interval: 'month' | 'year' | null;
  active: boolean;
  stripe_price_id: string | null;
  delivery_url?: string | null;
};

type Delivery = {
  status: 'sending' | 'sent' | 'simulated' | 'suppressed' | 'failed';
  attempts: number;
  error: string | null;
  claimed_at: string | null;
  delivered_at: string | null;
};

type Order = {
  id: string;
  email: string | null;
  lead_id: string | null;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
  livemode: boolean | null;
  product_names: string[];
  delivery: Delivery | null;
};

type SalesData = {
  since: string;
  totals: { currency: string; total_minor: number; count: number }[];
  orders: Order[];
  has_more: boolean;
};

const KIND_LABEL: Record<Kind, string> = {
  one_time: 'One-time payment',
  subscription: 'Subscription',
  deposit: 'Deposit',
  digital: 'Digital product (emailed link)',
  invoice_item: 'Invoice item (not sold at checkout)',
};

const ORDER_DOTS: Record<string, string> = {
  paid: 'bg-green-500',
  trial: 'bg-blue-400',
  pending: 'bg-yellow-500',
  refunded: 'bg-zinc-500',
  void: 'bg-zinc-700',
};

const DELIVERY_LABEL: Record<Delivery['status'], string> = {
  sending: 'Sending',
  sent: 'Delivered',
  simulated: 'Simulated (safe mode)',
  suppressed: 'Not sent: address suppressed',
  failed: 'Failed',
};

/** Start of the owner's current month, in their own timezone. */
function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export default function SalesPage() {
  const { show, node: toastNode } = useToast();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [homeCurrency, setHomeCurrency] = useState('AUD');
  const [sales, setSales] = useState<SalesData | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        api<{ products: Product[]; home_currency: string }>('/api/crm/products?limit=200'),
        api<SalesData>(`/api/crm/sales?since=${encodeURIComponent(monthStart())}`),
      ]);
      setProducts(p.products);
      setHomeCurrency(p.home_currency || 'AUD');
      setSales(s);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load sales');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of products and orders
    void load();
  }, [load]);

  const resend = async (order: Order) => {
    if (order.delivery?.status === 'sent' && !window.confirm(`Email ${order.email || 'the buyer'} the delivery link again?`)) return;
    setResending(order.id);
    try {
      const r = await api<{ delivery: { status: string; reason?: string } }>('/api/crm/orders/deliver', {
        method: 'POST',
        body: JSON.stringify({ order_id: order.id }),
      });
      show(r.delivery.status === 'simulated' ? 'Simulated: safe mode is on' : 'Delivery sent');
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not send', 'err');
      await load();
    } finally {
      setResending(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <PageHeader title="Sales">
        <PrimaryBtn onClick={() => setEditing('new')}>Add product</PrimaryBtn>
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-4 sm:px-12 pb-16">
        {error && (
          <p role="alert" className="mb-6 text-[13px] text-red-400">
            {error}
          </p>
        )}
        {!products || !sales ? (
          error ? null : <Loading />
        ) : (
          <div className="flex flex-col gap-8 max-w-6xl">
            <Totals sales={sales} homeCurrency={homeCurrency} />

            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-[13px] font-semibold text-zinc-300">Products</h2>
                <p className="text-xs text-zinc-500">
                  A sales page button sells a product by its slug. <Link className="underline" href="/crm/settings">Setup</Link>{' '}
                  shows what checkout still needs.
                </p>
              </div>
              {products.length === 0 ? (
                <EmptyState
                  title="No products yet"
                  hint="Add what you sell. Give it the slug your sales page button uses, e.g. main-offer."
                />
              ) : (
                <ul className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
                  {products.map((p) => (
                    <li key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-white truncate">
                          {p.name}
                          {!p.active && <span className="ml-2 text-xs text-zinc-500">(inactive)</span>}
                        </p>
                        <p className="text-xs text-zinc-500 break-all">
                          <code>{p.slug}</code> · {KIND_LABEL[p.kind] ?? p.kind}
                          {p.kind === 'digital' && !p.delivery_url && <span className="text-red-400"> · no delivery link</span>}
                        </p>
                      </div>
                      <p className="text-[14px] text-white tabular-nums">
                        {formatMinor(p.amount_minor, p.currency, { exact: true })}
                        {p.interval ? ` / ${p.interval}` : ''}
                      </p>
                      <GhostBtn onClick={() => setEditing(p)}>Edit</GhostBtn>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-[13px] font-semibold text-zinc-300">Orders</h2>
              {sales.orders.length === 0 ? (
                <EmptyState title="No orders yet" hint="Orders appear here when someone checks out from your sales page." />
              ) : (
                <ul className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
                  {sales.orders.map((o) => (
                    <OrderRow key={o.id} order={o} busy={resending === o.id} onResend={() => resend(o)} />
                  ))}
                </ul>
              )}
              {sales.has_more && <p className="text-xs text-zinc-500">Showing the newest {sales.orders.length} orders.</p>}
            </section>
          </div>
        )}
      </div>
      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          homeCurrency={homeCurrency}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            show(msg);
            await load();
          }}
          onError={(m) => show(m, 'err')}
        />
      )}
    </div>
  );
}

function Totals({ sales, homeCurrency }: { sales: SalesData; homeCurrency: string }) {
  const month = new Date(sales.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const lines = sales.totals.length ? sales.totals : [{ currency: homeCurrency, total_minor: 0, count: 0 }];
  return (
    <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-zinc-300">Paid in {month}</h2>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {lines.map((t) => (
          <div key={t.currency}>
            <p className="text-2xl font-semibold text-white tabular-nums">{formatMinor(t.total_minor, t.currency, { exact: true })}</p>
            <p className="text-xs text-zinc-500">
              {t.count} {t.count === 1 ? 'order' : 'orders'} · net of refunds
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function deliveryStuck(d: Delivery): boolean {
  return d.status === 'sending' && (!d.claimed_at || Date.now() - Date.parse(d.claimed_at) > 5 * 60_000);
}

function OrderRow({ order, busy, onResend }: { order: Order; busy: boolean; onResend: () => void }) {
  const d = order.delivery;
  const canResend = order.status === 'paid' && !!d && (d.status !== 'sending' || deliveryStuck(d));
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-white break-all">{order.email || 'No email yet'}</p>
        <p className="text-xs text-zinc-500">
          {order.product_names.join(', ') || 'No product'} · {fmtDate(order.paid_at || order.created_at)}
          {order.livemode === false && ' · test'}
        </p>
        {d && (
          <p className={`text-xs mt-0.5 ${d.status === 'failed' || d.status === 'suppressed' ? 'text-red-400' : 'text-zinc-500'}`}>
            Delivery: {deliveryStuck(d) ? 'Stuck, send it again' : DELIVERY_LABEL[d.status]}
            {d.error && d.status === 'failed' ? ` (${d.error})` : ''}
          </p>
        )}
      </div>
      <p className="text-[14px] text-white tabular-nums">{formatMinor(order.total_minor, order.currency, { exact: true })}</p>
      <StatusDot status={order.status} map={ORDER_DOTS} />
      {canResend && (
        <GhostBtn disabled={busy} onClick={onResend}>
          {busy ? 'Sending…' : 'Send again'}
        </GhostBtn>
      )}
    </li>
  );
}

function ProductForm({
  product,
  homeCurrency,
  onClose,
  onSaved,
  onError,
}: {
  product: Product | null;
  homeCurrency: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [kind, setKind] = useState<Kind>(product?.kind ?? 'one_time');
  const [currency, setCurrency] = useState(product?.currency ?? homeCurrency);
  const [price, setPrice] = useState(product ? String(toMajor(product.amount_minor, product.currency)) : '');
  const [interval, setBillInterval] = useState<'month' | 'year'>(product?.interval ?? 'month');
  const [deliveryUrl, setDeliveryUrl] = useState(product?.delivery_url ?? '');
  const [stripePriceId, setStripePriceId] = useState(product?.stripe_price_id ?? '');
  const [active, setActive] = useState(product?.active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const code = currency.trim().toUpperCase();
    const amount = parseMajorToMinor(price, code);
    if (!name.trim()) return onError('Give the product a name');
    if (!/^[A-Z]{3}$/.test(code)) return onError('Currency is a three-letter code, e.g. AUD');
    if (amount === null) return onError('Price must be a number like 49 or 49.00');
    if (kind === 'digital' && !/^https:\/\//.test(deliveryUrl.trim())) return onError('A digital product needs an https:// delivery link');

    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      kind,
      amount_minor: amount,
      currency: code,
      interval: kind === 'subscription' ? interval : null,
      delivery_url: kind === 'digital' ? deliveryUrl.trim() : null,
      stripe_price_id: stripePriceId.trim() || null,
      active,
    };
    if (slug.trim()) body.slug = slug.trim();
    if (product) body.id = product.id;

    setSaving(true);
    try {
      await api('/api/crm/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onSaved(product ? 'Product saved' : 'Product added');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={product ? 'Edit product' : 'Add product'} onClose={onClose} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Main offer" required />
          </Field>
          <Field label="Slug" hint="Your sales page button uses this. Left empty, it is made from the name.">
            <TextInput value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="main-offer" />
          </Field>
        </div>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Price">
            <TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="49.00" required />
          </Field>
          <Field label="Currency">
            <TextInput value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </Field>
          {kind === 'subscription' && (
            <Field label="Billed every">
              <Select value={interval} onChange={(e) => setBillInterval(e.target.value as 'month' | 'year')}>
                <option value="month">month</option>
                <option value="year">year</option>
              </Select>
            </Field>
          )}
        </div>
        {kind === 'digital' && (
          <Field
            label="Delivery link"
            hint="Emailed to the buyer once they have paid (simulated while safe mode is on). Use a private link: it is never shown on your site."
          >
            <TextInput
              type="url"
              value={deliveryUrl}
              onChange={(e) => setDeliveryUrl(e.target.value)}
              placeholder="https://"
              required
            />
          </Field>
        )}
        <Field label="Description" hint="Optional. Shown on Stripe's checkout page.">
          <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Stripe price id" hint="Optional. Without one, checkout charges the price above. With one, they must match.">
          <TextInput value={stripePriceId} onChange={(e) => setStripePriceId(e.target.value)} placeholder="price_..." />
        </Field>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="text-[13px] text-zinc-400">Active: can be bought from your sales page</span>
        </label>
        <div className="flex justify-end gap-3">
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryBtn>
        </div>
      </form>
    </Modal>
  );
}
