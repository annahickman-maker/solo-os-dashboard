 'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, GhostBtn, PageHeader } from '@/components/crm/kit';
import { selection } from '@/lib/analytics/selection';
import type { summariseWebsite } from '@/lib/analytics/website';
import { useNavModules } from '@/components/nav';
import FunnelReport from './funnel-report';
import FunnelBoxes from './funnel-boxes';
import FlowCards from './flow-cards';

/**
 * /crm/analytics: three views, picked with the tabs at the top (?view=):
 *  1. Views to sales: the three funnel boxes (default).
 *  2. Sales page: the Website and Funnels reports.
 *  3. Client pipeline: the flow cards, only with the Client pipeline module on.
 * Every number fills itself; ANALYTICS.md says from where.
 */
type View='funnel'|'site'|'pipeline';
const VIEWS:{id:View;label:string}[]=[{id:'funnel',label:'Views to sales'},{id:'site',label:'Sales page'},{id:'pipeline',label:'Client pipeline'}];
type Report=ReturnType<typeof summariseWebsite>&{truncated:boolean;generated_at:string;sources:string[]};
export default function AnalyticsShell() {
 const router=useRouter(),params=useSearchParams(),modules=useNavModules();
 const {report,days,funnel,page,source,device}=selection(new URLSearchParams(params.toString()));
 const [data,setData]=useState<Report|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const views=VIEWS.filter(v=>v.id!=='pipeline'||modules.pipeline);
 const asked=params.get('view') as View|null;
 const view:View=views.some(v=>v.id===asked)?(asked as View):'funnel';
 useEffect(()=>{
  if(report!=='website'||view!=='site')return;
  const controller=new AbortController();
  // Clear the previous filter result while the replacement request is pending.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setData(null);setError('');
  api<Report>('/api/crm/analytics?'+new URLSearchParams({days:String(days),page,source,device}),{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted)setData(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[report,days,page,source,device,retry,view]);
 function change(values:Record<string,string>){const q=new URLSearchParams(params.toString());for(const [k,v]of Object.entries(values)){if(v)q.set(k,v);else q.delete(k);}router.replace('/crm/analytics?'+q,{scroll:false});}
 const field='rounded border border-minimal-border bg-minimal-bg px-3 py-2 text-sm';
 return <div className="h-full overflow-y-auto"><PageHeader title="Analytics" className="!px-4 sm:!px-12"><GhostBtn onClick={()=>setRetry(n=>n+1)}>Refresh</GhostBtn></PageHeader>
 <nav role="tablist" aria-label="Analytics view" className="px-4 sm:px-12 flex items-center gap-1 border-b border-minimal-border shrink-0 overflow-x-auto">{views.map(v=><button key={v.id} type="button" role="tab" aria-selected={view===v.id} onClick={()=>change({view:v.id==='funnel'?'':v.id})} className={`px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${view===v.id?'border-white text-white':'border-transparent text-minimal-muted hover:text-white'}`}>{v.label}</button>)}</nav>
 {view==='funnel'&&<section aria-label="Views to sales" className="px-4 sm:px-12 pt-6 pb-10 flex flex-col gap-3"><FunnelBoxes refresh={retry}/></section>}
 {view==='site'&&<section aria-label="Sales page" className="pt-6 pb-2"><div className="px-4 sm:px-12 flex flex-col gap-4">
 <div className="flex flex-wrap gap-4"><label>Report <select className={field} value={report} onChange={e=>change({report:e.target.value,page:''})}><option value="website">Website</option><option value="funnel">Funnels</option></select></label>
 <label>Period <select className={field} value={days} onChange={e=>change({days:e.target.value})}>{[7,30,90,0].map(n=><option key={n} value={n}>{n?`Last ${n} days`:'All time'}</option>)}</select></label>
 {report==='website'&&<><label>Source <select className={field} value={source} onChange={e=>change({source:e.target.value})}><option value="">All sources</option>{[...new Set([...(data?.sources||[]),...(source?[source]:[])])].map(s=><option key={s} value={s}>{s}</option>)}</select></label><label>Device <select className={field} value={device} onChange={e=>change({device:e.target.value})}><option value="">All devices</option>{['mobile','tablet','desktop','unknown'].map(s=><option key={s} value={s}>{s}</option>)}</select></label></>}</div></div>
 {report==='funnel'?<div className="pt-6"><FunnelReport key={`${days}:${funnel}:${retry}`} initialDays={days} initialFunnel={funnel}/></div>:<div className="px-4 sm:px-12 py-6">
 {page&&<button className={field} onClick={()=>change({page:''})}>All pages</button>}
 {error?<p role="alert">{error}</p>:!data?<p role="status">Loading analytics…</p>:<>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-6">{[['Page views',data.views],['CTA / offer clicks',data.clicks],['Email capture events',data.captures]].map(([label,value])=><div key={label} className="border border-minimal-border rounded p-4"><p className="text-sm text-minimal-muted">{label}</p><p className="text-2xl">{value}</p></div>)}</div>
 {data.truncated&&<p role="status">Showing the most recent 50,000 matching events. Totals are partial; choose a shorter period.</p>}
 {!data.pages.length?<p>No recorded website events for this period.</p>:<div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Page','Views','Clicks','Captures'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.pages.map(p=><tr key={p.page} className="border-t border-minimal-border"><td className="p-3">{p.page==='(unknown)'?p.page:<button onClick={()=>change({page:p.page})} className="underline">{p.page}</button>}</td><td>{p.views}</td><td>{p.clicks}</td><td>{p.captures}</td></tr>)}</tbody></table></div>}

 </>}
 </div>}
 </section>}
 {view==='pipeline'&&<section aria-label="Client pipeline" className="px-4 sm:px-12 pt-6 pb-10 flex flex-col gap-3"><FlowCards modules={modules} refresh={retry}/></section>}
 </div>;
}
