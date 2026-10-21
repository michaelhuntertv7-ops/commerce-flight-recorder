import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,money,seal,verifySeal} from '../core.mjs';
import {PayPal} from '../paypal.mjs';
import {explain} from '../ai.mjs';
const now=Date.parse('2026-10-21T12:00:00Z');
const claim=()=>({text:'Payment completed',expected:'PAYMENT_COMPLETED',orderId:'ORDER123456',amount:'10.00',currency:'USD'});
const evidence=()=>({source:'PAYPAL_SANDBOX_API',observedAt:new Date(now).toISOString(),order:{id:'ORDER123456',status:'COMPLETED',purchase_units:[{reference_id:'CFR-DEMO',amount:{value:'10.00',currency_code:'USD'},payments:{captures:[{id:'CAPTURE123',status:'COMPLETED'}]}}]},capture:{id:'CAPTURE123',status:'COMPLETED',amount:{value:'10.00',currency_code:'USD'}},events:[]});
test('matching order, independently fetched capture and amount confirms',()=>assert.equal(reconcile(claim(),evidence(),now).verdict,'CONFIRMED'));
for(const status of ['PENDING','DECLINED','DENIED','FAILED','REFUNDED','PARTIALLY_REFUNDED','REVERSED'])
test(status+' cannot confirm completion',()=>{const e=evidence();e.capture.status=status;assert.equal(reconcile(claim(),e,now).verdict,'DIVERGENCE');});
for(const status of ['CREATED','APPROVED','PAYER_ACTION_REQUIRED','VOIDED'])
test(status+' without a capture diverges',()=>{const e=evidence();e.order.status=status;e.order.purchase_units[0].payments.captures=[];e.capture=null;assert.equal(reconcile(claim(),e,now).code,'NOT_CAPTURED');});
const cases=[
 ['mismatched order',e=>e.order.id='OTHER12345','DIVERGENCE'],
 ['mismatched capture',e=>e.capture.id='OTHER12345','DIVERGENCE'],
 ['mismatched order amount',e=>e.order.purchase_units[0].amount.value='9.99','DIVERGENCE'],
 ['mismatched capture amount',e=>e.capture.amount.value='9.99','DIVERGENCE'],
 ['currency mismatch',e=>e.capture.amount.currency_code='EUR','DIVERGENCE'],
 ['duplicate capture',e=>e.order.purchase_units[0].payments.captures.push({...e.order.purchase_units[0].payments.captures[0]}),'DIVERGENCE'],
 ['missing capture',e=>e.capture=null,'INCOMPLETE'],
 ['missing order',e=>e.order=null,'INCOMPLETE'],
 ['unknown capture state',e=>e.capture.status='NEW_UNKNOWN','INCOMPLETE'],
 ['conflicting order state',e=>e.order.status='APPROVED','INCOMPLETE'],
 ['stale evidence',e=>e.observedAt=new Date(now-120001).toISOString(),'INCOMPLETE'],
 ['future evidence',e=>e.observedAt=new Date(now+6000).toISOString(),'INCOMPLETE'],
 ['invalid timestamp',e=>e.observedAt='bad','INCOMPLETE'],
 ['provider failure',e=>e.error='PAYPAL_HTTP_500','INCOMPLETE'],
 ['missing amount',e=>delete e.capture.amount,'INCOMPLETE'],
 ['untrusted source',e=>e.source='AGENT_CLAIM','INCOMPLETE'],
 ['adverse event',e=>e.events=[{event_type:'PAYMENT.CAPTURE.REFUNDED'}],'INCOMPLETE'],
 ['multiple purchase units',e=>e.order.purchase_units.push(e.order.purchase_units[0]),'INCOMPLETE'],
 ['malformed captures',e=>e.order.purchase_units[0].payments.captures='bad','INCOMPLETE']
];
for(const [name,change,expected] of cases)test(name,()=>{const e=evidence();change(e);assert.equal(reconcile(claim(),e,now).verdict,expected);});
test('malformed claim fails closed',()=>assert.equal(reconcile({text:''},evidence(),now).code,'INVALID_CLAIM'));
test('unsupported assertion fails closed',()=>assert.equal(reconcile({...claim(),expected:'REFUNDED'},evidence(),now).code,'INVALID_CLAIM'));
test('business reference mismatch',()=>assert.equal(reconcile({...claim(),reference:'WRONG'},evidence(),now).code,'REFERENCE_MISMATCH'));
test('money uses exact integers',()=>{assert.equal(money('10.01'),1001n);assert.equal(money('1e2'),null);assert.equal(money('-1.00'),null);});
test('record integrity detects modifications',()=>{const r=seal({claim:claim()});assert.equal(verifySeal(r),true);r.claim.amount='99.00';assert.equal(verifySeal(r),false);});
test('AI failure retains deterministic reason',async()=>{const result=reconcile(claim(),evidence(),now);const r=await explain({result,evidence:evidence()},async()=>{throw Error('private-key');});assert.equal(r.status,'UNAVAILABLE');assert.equal(r.explanation,result.reason);assert.equal(JSON.stringify(r).includes('private-key'),false);});
test('malformed AI output is not accepted',async()=>{const r=await explain({result:reconcile(claim(),evidence(),now),evidence:evidence()},async()=>({ok:true,json:async()=>({response:'not json'})}));assert.equal(r.status,'UNAVAILABLE');});
test('PayPal authentication failure cannot leak a secret',async()=>{const p=new PayPal({clientId:'private-client',secret:'private-secret',fetcher:async()=>({ok:false,status:401})});const e=await p.evidence('ORDER123456');assert.equal(e.error,'PAYPAL_AUTH_FAILED');assert.equal(JSON.stringify(e).includes('private-secret'),false);});
test('PayPal provider calls only fixed sandbox host',async()=>{const urls=[];const p=new PayPal({clientId:'test',secret:'test',fetcher:async(url)=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/token')?{access_token:'hidden',expires_in:100}:{id:'ORDER123456',status:'CREATED',purchase_units:[{amount:{value:'10.00',currency_code:'USD'}}]}};}});await p.evidence('ORDER123456');assert.ok(urls.length>=2);assert.ok(urls.every(u=>u.startsWith('https://api-m.sandbox.paypal.com/')));});
test('provider rejects arbitrary endpoints',async()=>{const p=new PayPal();await assert.rejects(p.request('https://api-m.paypal.com'),/denied/);});
test('identifiers cannot inject URLs',async()=>{const p=new PayPal();await assert.rejects(p.evidence('../payments'),/INVALID_ORDER_ID/);});
