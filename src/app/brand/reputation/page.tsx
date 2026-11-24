/** /brand/reputation - the Reputation tab. Data: solo document `reputation`. */
import { ReputationView } from '@/components/reputation/reputation-view';

export const metadata = { title: 'Reputation' };

export default function BrandReputationPage() {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ReputationView />
    </div>
  );
}
