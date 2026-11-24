import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as signing from './signing.ts';
import * as scopes from './agent-key-scopes.ts';
import {scopedRouteAllowed} from './scoped-routes.ts';
import type {AuthResult} from './auth.ts';

// Execute the actual auth implementation with synthetic credentials and provider
// boundaries. Neither the developer's environment nor a real database is read.
function fixture(overrides:Record<string,string>={}, grants=['events:read']) {
 const env={API_SECRET_KEY:'test-master',CONTENT_AGENT_API_KEY:'test-old-agent',API_REQUEST_SIGNING_SECRET:'test-signing',...overrides};
 let keyLookups=0;
 const dependencies:Record<string,unknown>={
  'next/server':{},
  '@/lib/supabase/server':{createAdminClient:()=>({}),createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'test-owner',app_metadata:{}}},error:null})}})},
  './signing':signing,'./agent-key-scopes':scopes,'./scoped-routes':{scopedRouteAllowed},
  './agent-keys':{verifyAgentKey:async()=>{keyLookups++;return {name:'manager',scopes:grants};}},
 };
 const js=ts.transpileModule(readFileSync(new URL('./auth.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{} as {authenticateSessionOrApiKey:(request:Request)=>Promise<AuthResult>;authenticateOwner:(request:Request)=>Promise<AuthResult>}};
 new Function('require','module','exports','process',js)((id:string)=>{assert.ok(id in dependencies,id);return dependencies[id];},loaded,loaded.exports,{env});
 return {auth:loaded.exports.authenticateSessionOrApiKey,owner:loaded.exports.authenticateOwner,lookups:()=>keyLookups};
}
function request(key:string,path='/api/events',method='GET',secret='test-signing',signed=true) {
 const time=String(Math.floor(Date.now()/1000));
 const headers:Record<string,string>={'x-api-key':key};
 if(signed){headers['x-timestamp']=time;headers['x-signature']=signing.computeSignature(secret,signing.buildSigningPayload(method,path,time,''));}
 return new Request('https://test.invalid'+path,{method,headers});
}
const minted='bbk_manager_'+ 'a'.repeat(32);
test('old master and env-agent signed requests keep working without the new key table',async()=>{
 const f=fixture();
 for(const key of ['test-master','test-old-agent']) assert.equal((await f.auth(request(key,'/api/crm/leads','POST'))).authenticated,true);
 assert.equal(f.lookups(),0);
});
test('legacy explicit unsigned mode is preserved but never bypasses minted signatures',async()=>{
 const f=fixture({API_SIGNATURE_REQUIRED:'false'});
 assert.equal((await f.auth(request('test-old-agent','/api/crm/leads','GET','',false))).authenticated,true);
 assert.equal((await f.auth(request(minted,'/api/events','GET','',false))).authenticated,false);
});
test('minted keys self-sign, cannot use the legacy secret, and are confined to reviewed routes',async()=>{
 const f=fixture();
 assert.equal((await f.auth(request(minted))).authenticated,false);
 assert.equal((await f.auth(request(minted,'/api/events','GET',minted))).authenticated,true);
 for(const [path,method] of [['/api/settings/agent-keys','POST'],['/api/crm/tick','POST'],['/api/crm/leads','GET'],['/api/events','POST'],['/api/crm/products','GET']]) {
  assert.equal((await f.auth(request(minted,path,method,minted))).authenticated,false,`${method} ${path}`);
 }
});
test('wrong legacy signatures are rejected and owner login is unchanged',async()=>{
 const f=fixture();assert.equal((await f.auth(request('test-old-agent','/api/home','GET','wrong'))).authenticated,false);
 const result=await f.auth(new Request('https://test.invalid/api/home'));
 assert.equal(result.authenticated,true);if(result.authenticated)assert.equal(result.mode,'session');
});
test('checkout-only key cannot read orders, mint keys, send invoices or use invented routes',()=>{
 assert.equal(scopedRouteAllowed('POST','/api/crm/checkout',['money:checkout']),true);
 for(const [method,path] of [['GET','/api/crm/orders'],['POST','/api/settings/agent-keys'],['POST','/api/crm/invoices'],['POST','/api/crm/checkout/anything']])assert.equal(scopedRouteAllowed(method,path,['money:checkout']),false);
});

test('solo documents: brand keys reach reputation and offer only, read and write kept apart',()=>{
 for(const key of ['reputation','offer']){
  assert.equal(scopedRouteAllowed('GET',`/api/solo/docs/${key}`,['brand:read']),true);
  assert.equal(scopedRouteAllowed('PUT',`/api/solo/docs/${key}`,['brand:read']),false);
  assert.equal(scopedRouteAllowed('PUT',`/api/solo/docs/${key}`,['brand:write']),true);
 }
 for(const path of ['/api/solo/docs/focus','/api/solo/docs/nav','/api/solo/docs/longform','/api/solo/docs/reputation/x'])assert.equal(scopedRouteAllowed('GET',path,['brand:read','brand:write']),false);
 assert.equal(scopedRouteAllowed('PUT','/api/solo/docs/longform',['content:write']),true);
});

test('owner approval connection permits signed master/admin and refuses ordinary employee keys',async()=>{
 const f=fixture({}, ['approvals:propose','leads:read']);
 for(const path of ['/api/agent/actions','/api/agent/actions/11111111-1111-4111-8111-111111111111']){
  for(const method of ['GET','POST']){
   assert.equal((await f.owner(request('test-master',path,method))).authenticated,true);
   assert.equal((await f.owner(request('test-master',path,method,'wrong'))).authenticated,false);
   assert.equal((await f.owner(request('test-old-agent',path,method))).authenticated,false);
   assert.equal((await f.owner(request(minted,path,method,minted))).authenticated,false);
  }
 }
 const session=await f.owner(new Request('https://test.invalid/api/agent/actions'));
 assert.equal(session.authenticated,true);if(session.authenticated)assert.equal(session.mode,'session');
});
