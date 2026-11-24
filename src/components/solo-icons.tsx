// Solo OS room icons: an original line set.
// 24 grid, 1.6 stroke, round caps, currentColor.

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const analytics = (
  <><path d="M4 19.5h16" /><path d="M5 15.5l4.5-4.5 3.5 3 6-6.5" /><path d="M15.5 7.5H19v3.5" /></>
);
const articles = (
  <><path d="M6.5 3.5h7.5l4.5 4.5v10.5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" /><path d="M14 3.5V8h4.5" /><path d="M8 12.5h8M8 16h5" /></>
);
const brand = (
  <><path d="M12 3.5l2.3 6.2 6.2 2.3-6.2 2.3L12 20.5l-2.3-6.2L3.5 12l6.2-2.3z" /></>
);
const carousels = (
  <><rect x="6.5" y="4.5" width="11" height="15" rx="2.5" /><path d="M3.5 7v10M20.5 7v10" /></>
);
const email = (
  <><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="M4.5 7.5l7.5 5.5 7.5-5.5" /></>
);
const focus = (
  <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1.2" /></>
);
const longform = (
  <><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="M10.5 9.5l4 2.5-4 2.5z" /></>
);
const shortform = (
  <><rect x="7" y="3.5" width="10" height="17" rx="2.5" /><path d="M11 10l3 2-3 2z" /></>
);
const leads = (
  <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.3 3.9-5 7-5s5.8 1.7 7 5" /></>
);
const library = (
  <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M4 16l4.5-4.5 4 4 2.5-2.5 5 4.5" /><circle cx="15.5" cy="9" r="1.5" /></>
);
const memory = (
  <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4v3.5H8" /><path d="M12 8v4l2.5 2" /></>
);
const more = (
  <><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></>
);
const pipeline = (
  <><rect x="3.5" y="4" width="4.5" height="16" rx="1.8" /><rect x="9.75" y="4" width="4.5" height="11" rx="1.8" /><rect x="16" y="4" width="4.5" height="7" rx="1.8" /></>
);
const sales = (
  <><path d="M4 5.5h2.2l2 9.5h9.3l2-7H7.4" /><circle cx="9.5" cy="18.5" r="1.3" /><circle cx="16.5" cy="18.5" r="1.3" /></>
);
const setup = (
  <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>
);
const social = (
  <><path d="M4.5 11.5a7.5 7 0 1 1 3.4 5.9L4 18.5l1.3-3.4a6.8 6.8 0 0 1-.8-3.6z" /><path d="M9 11.5h.01M12.5 11.5h.01M16 11.5h.01" /></>
);

export const SOLO_ICONS = { analytics, articles, brand, carousels, email, focus, leads, longform, shortform, library, memory, more, pipeline, sales, setup, social };
export type SoloIconName = keyof typeof SOLO_ICONS;

export function SoloIcon({ name, className = 'w-5 h-5 shrink-0' }: { name: SoloIconName; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} {...P}>
      {SOLO_ICONS[name]}
    </svg>
  );
}
