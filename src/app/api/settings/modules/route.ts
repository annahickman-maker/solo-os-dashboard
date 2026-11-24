import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { listAgentKeys } from "@/lib/api/agent-keys";
import { readSafeMode } from "@/lib/money/db-util";
import { moneyDb } from "@/lib/money/db";
import { isMoneyReady, keyLivemode, stripeSecretKey } from "@/lib/money/stripe-client";
import { socialPublishingEnabled } from "@/lib/social/feature";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * GET /api/settings/modules - which optional pieces are switched on. Owner
 * session only. Presence checks only: a key being set does not prove it
 * works, and no secret value ever leaves the server.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  const [safeMode, checkoutKey, deliveryTable] = await Promise.all([
    readSafeMode(moneyDb(supabase)).catch(() => true),
    checkoutKeyState(supabase),
    supabase
      .from("order_deliveries")
      .select("order_id", { head: true, count: "exact" })
      .limit(1)
      .then((r) => !r.error, () => false),
  ]);

  return NextResponse.json(
    {
      social: {
        enabled: socialPublishingEnabled(process.env.SOCIAL_PUBLISHING_ENABLED),
      },
      email: { configured: !!process.env.RESEND_API_KEY, safe_mode: safeMode },
      payments: {
        configured: isMoneyReady(process.env),
        test_mode: keyLivemode(process.env) === false,
        secret_key: stripeSecretKey(process.env) !== null,
        webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET?.trim(),
      },
      checkout_key: checkoutKey,
      bookings: { webhook_secret: !!process.env.CALCOM_WEBHOOK_SECRET?.trim() },
      digital_delivery: { ready: deliveryTable },
      studio: { bundled: false },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Whether an active key can open checkout, and whether it holds more than it needs. */
async function checkoutKeyState(supabase: ReturnType<typeof createAdminClient>) {
  try {
    const keys = (await listAgentKeys(supabase)).filter((k) => !k.revoked_at && k.scopes.includes("money:checkout"));
    const narrow = keys.find((k) => k.scopes.length === 1);
    const key = narrow ?? keys[0];
    return key ? { minted: true, name: key.name, only_checkout: key.scopes.length === 1 } : { minted: false };
  } catch {
    return { minted: false, unavailable: true };
  }
}
