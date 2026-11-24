/** /brand/offer - the Offer tab. Data: solo document `offer`. */
import { OfferView } from '@/components/offer/offer-view';

export const metadata = { title: 'Offer' };

export default function BrandOfferPage() {
  return (
    <div className="solo flex-1 min-h-0">
      <OfferView />
    </div>
  );
}
