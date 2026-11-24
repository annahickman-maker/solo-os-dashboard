/**
 * The real DeliveryDeps: the CRM's own sender, as a transactional email, so
 * a delivery obeys safe mode, suppression and is recorded in email_sends.
 * Routes and the webhook use this; tests pass a fake transport.
 */
import { sendCrmEmail } from "@/lib/crm/email";
import type { AdminClient } from "@/lib/crm/types";
import type { DeliveryDeps } from "./delivery";

export const crmDeliveryDeps: DeliveryDeps = {
  send: (db, email) =>
    sendCrmEmail(db as AdminClient, {
      lead: email.lead,
      subject: email.subject,
      bodyMd: email.bodyMd,
      preheader: email.preheader,
      templateId: email.templateId,
      actor: email.actor,
      transactional: true,
    }),
};
