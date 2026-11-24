import { redirect } from 'next/navigation';

/** /crm has no room of its own; Contacts (/crm/leads) is the front door of the CRM. */
export default function CrmIndex() {
  redirect('/crm/leads');
}
