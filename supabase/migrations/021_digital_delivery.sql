-- Refuse schema-name collisions. The migration runner skips already-recorded files.
DO $$ BEGIN
  if to_regclass('public.products') is null then raise exception 'Solo OS: 021 needs the money tables from 017_money.sql'; end if;
  if to_regclass('public.order_deliveries') is not null then raise exception 'Solo OS: existing order_deliveries table requires a reviewed adoption; no automatic replacement'; end if;
END $$;

-- Digital products: a product kind that is delivered by email the moment it
-- is paid for (see MONEY.md, "Digital products").
--
-- Additive only:
-- - products.kind also accepts 'digital'. The old check is replaced by a wider
--   one; every existing row still passes it, nothing is rewritten.
-- - products.delivery_url: the https link a buyer receives (a private
--   download, a course login, a shared folder). Never listed publicly:
--   GET /api/public/products names its columns and leaves this one out.
-- - order_deliveries: one row per paid order, keyed by the order. The primary
--   key is the claim, so a webhook that is retried, or two deliveries racing,
--   can never email the buyer twice.

-- ── products.kind accepts 'digital' ─────────────────────────────────────────

DO $$
DECLARE c record;
BEGIN
  -- The unnamed column check from 017 (products_kind_check by default; found by
  -- its definition so a renamed constraint is replaced too).
  for c in
    select conname from pg_constraint
    where conrelid = 'public.products'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%invoice_item%'
      and pg_get_constraintdef(oid) not like '%interval%'
  loop
    execute format('alter table public.products drop constraint %I', c.conname);
  end loop;
END $$;

alter table public.products add constraint products_kind_check
  check (kind in ('one_time', 'subscription', 'deposit', 'invoice_item', 'digital'));

alter table public.products add column if not exists delivery_url text;
alter table public.products drop constraint if exists products_delivery_url_https;
alter table public.products add constraint products_delivery_url_https
  check (delivery_url is null or (delivery_url ~ '^https://' and length(delivery_url) <= 2000));

comment on column public.products.delivery_url is
  'Digital products only: the https link emailed to the buyer once the order is paid. Private: never served by the public product list.';

-- ── order_deliveries ────────────────────────────────────────────────────────

create table if not exists public.order_deliveries (
  order_id      uuid primary key references public.orders(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  email         text,
  -- sending: claimed by a delivery in progress. sent / simulated (safe mode) /
  -- suppressed (bounced or complained address): done. failed: the owner can
  -- send it again from the Sales page.
  status        text not null default 'sending'
                check (status in ('sending', 'sent', 'simulated', 'suppressed', 'failed')),
  attempts      integer not null default 1 check (attempts > 0),
  email_send_id uuid,                    -- the email_sends row the CRM recorded
  error         text,
  claimed_at    timestamptz,             -- a claim older than five minutes belongs to a delivery that died
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists order_deliveries_status_idx on public.order_deliveries (status);

drop trigger if exists order_deliveries_updated_at on public.order_deliveries;
create trigger order_deliveries_updated_at before update on public.order_deliveries
  for each row execute function public.update_updated_at();

-- Service role only, like the other money tables.
alter table public.order_deliveries enable row level security;
revoke all on public.order_deliveries from anon, authenticated;
grant all on public.order_deliveries to service_role;

comment on table public.order_deliveries is
  'One digital delivery per paid order. The primary key is the claim that keeps a retried webhook from emailing twice.';
