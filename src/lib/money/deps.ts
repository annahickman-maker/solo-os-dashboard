/**
 * What the money code needs from the CRM, passed in rather than imported, so
 * it runs the same in the Worker (./crm-deps.ts) and under node --test (fakes).
 */

import type { Lead, Workflow } from "../crm/types.ts";
import type { MoneyClient } from "./db.ts";
import type { StripeOptions } from "./stripe-client.ts";
import type { DeliveryOutcome } from "./delivery.ts";

export interface MoneyDeps {
  /** lib/crm/leads.ts upsertLead. Money only ever creates with it, triggers off. */
  upsertLead(
    db: MoneyClient,
    input: { email: string; name?: string | null; source?: string | null },
    opts: { actor: string; fireTriggers: false }
  ): Promise<{ lead: Lead; created: boolean }>;
  /** lib/crm/engine.ts fireTrigger. */
  fireTrigger(
    db: MoneyClient,
    event: { type: "tag_added" | "status_changed"; lead: Lead; data: Record<string, unknown> }
  ): Promise<unknown>;
  /** lib/crm/engine.ts enrollLead. */
  enrollLead(db: MoneyClient, workflow: Workflow, lead: Lead, source: string): Promise<{ enrolled: boolean; reason?: string }>;
  /**
   * ./delivery.ts deliverDigitalOrder with the CRM sender: emails a paid
   * digital order its link, once. Optional so a Home (or a test) without it
   * still records payments.
   */
  deliver?(db: MoneyClient, orderId: string): Promise<DeliveryOutcome>;
  /** Env and fetch for Stripe calls; defaults to process.env and global fetch. */
  stripe?: StripeOptions;
}
