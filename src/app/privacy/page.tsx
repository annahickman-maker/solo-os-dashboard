// Public privacy page. Needed for OAuth consent screens (for example Google)
// before a private connection can be published. The business name and contact
// email come from backend_settings key `business_profile` ({ name, email }).
import { createAdminClient } from '@/lib/supabase/server';

export const metadata = { title: 'Privacy · Solo OS' };
export const dynamic = 'force-dynamic';

type BusinessProfile = { name: string | null; email: string | null };

async function loadBusinessProfile(): Promise<BusinessProfile> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('backend_settings')
      .select('value')
      .eq('key', 'business_profile')
      .maybeSingle();
    const value = (data?.value ?? {}) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { name: text(value.name), email: text(value.email) };
  } catch {
    return { name: null, email: null };
  }
}

export default async function PrivacyPage() {
  const profile = await loadBusinessProfile();
  const ownerLower = profile.name ?? 'the owner of this dashboard';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-16 text-[14px] leading-relaxed text-zinc-300">
        <h1 className="text-lg font-semibold text-white mb-6">Privacy policy</h1>
        <p className="mb-4">
          This Solo OS dashboard is a private tool used only by {ownerLower} to run their own business. It has no other
          users and is not offered to the public.
        </p>
        <h2 className="text-[15px] font-semibold text-white mt-8 mb-2">Connected accounts</h2>
        <p className="mb-4">
          When {ownerLower} connects their own accounts (such as YouTube or other social platforms), the dashboard uses
          those platforms&apos; APIs to read account and content details and analytics, and to publish or update their
          own content at their request. This data is stored in a private database and is never sold, shared or used for
          advertising.
        </p>
        <p className="mb-4">
          Use of information received from Google APIs adheres to the{' '}
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p className="mb-4">
          Access can be removed at any time from the connected platform&apos;s own account settings (for Google, the{' '}
          <a className="underline" href="https://myaccount.google.com/permissions">
            Google account permissions
          </a>{' '}
          page), which stops all further access.
        </p>
        <h2 className="text-[15px] font-semibold text-white mt-8 mb-2">Contact</h2>
        <p>
          {profile.email ? (
            <>
              Questions: <a className="underline" href={`mailto:${profile.email}`}>{profile.email}</a>
            </>
          ) : (
            <>Questions: contact {ownerLower} directly.</>
          )}
        </p>
      </div>
    </div>
  );
}
