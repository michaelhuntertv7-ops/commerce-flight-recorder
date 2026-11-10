import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,money,seal,verifySeal,verifyChain} from '../core.mjs';
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
test('hash chain accepts intact sequence and rejects broken predecessor',()=>{const a=seal({id:'A'});const b=seal({id:'B'},a.sha256);assert.equal(verifyChain([a,b]),true);b.previousHash='bad';assert.equal(verifyChain([a,b]),false);});
test('verified completion webhook corroborates a completed capture',()=>{const e=evidence();e.verifiedWebhooks=[{verification:'SUCCESS',event_type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'CAPTURE123',order_id:'ORDER123456'}];const r=reconcile(claim(),e,now);assert.equal(r.code,'CAPTURE_AND_WEBHOOK_CONFIRMED');assert.equal(r.verdict,'CONFIRMED');});
test('verified adverse webhook overrides an otherwise completed snapshot',()=>{const e=evidence();e.verifiedWebhooks=[{verification:'SUCCESS',event_type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'CAPTURE123',order_id:'ORDER123456'}];const r=reconcile(claim(),e,now);assert.equal(r.code,'VERIFIED_ADVERSE_WEBHOOK');assert.equal(r.verdict,'DIVERGENCE');});
test('unrelated verified webhook cannot corroborate another payment',()=>{const e=evidence();e.verifiedWebhooks=[{verification:'SUCCESS',event_type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'OTHER12345',order_id:'OTHERORDER1'}];assert.equal(reconcile(claim(),e,now).code,'CAPTURE_CONFIRMED');});
test('webhook store integrity failure blocks confirmation',()=>{const e=evidence();e.webhookError='WEBHOOK_STORE_INVALID';const r=reconcile(claim(),e,now);assert.equal(r.code,'WEBHOOK_EVIDENCE_INVALID');assert.equal(r.verdict,'INCOMPLETE');});
test('AI routing failure retains deterministic evidence explanation',async()=>{const result=reconcile(claim(),evidence(),now);const r=await explain({result,evidence:evidence()},'Why?',async()=>{throw Error('private-key');});assert.equal(r.status,'UNAVAILABLE');assert.ok(r.explanation.includes(result.reason));assert.equal(JSON.stringify(r).includes('private-key'),false);});
test('malformed AI routing output is not accepted',async()=>{const r=await explain({result:reconcile(claim(),evidence(),now),evidence:evidence()},'Why?',async()=>({ok:true,json:async()=>({response:'not json'})}));assert.equal(r.status,'UNAVAILABLE');});
test('AI evidence navigator receives only the bounded operator question',async()=>{let sent;const record={result:reconcile(claim(),evidence(),now),evidence:evidence()};const r=await explain(record,'What payment evidence supports this verdict?',async(_url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({response:JSON.stringify({focus:'PAYMENT_EVIDENCE'})})};});assert.equal(r.status,'GENERATED');assert.equal(r.focus,'PAYMENT_EVIDENCE');const prompt=JSON.parse(sent.prompt);assert.deepEqual(Object.keys(prompt),['question']);assert.equal(prompt.question,'What payment evidence supports this verdict?');assert.ok(r.explanation.includes(record.result.reason));assert.equal(JSON.stringify(sent).includes('clientSecret'),false);});
test('AI cannot author factual answer text',async()=>{const record={result:reconcile(claim(),evidence(),now),evidence:evidence()};const r=await explain(record,'Did the order arrive?',async()=>({ok:true,json:async()=>({response:JSON.stringify({focus:'WEBHOOK_EVIDENCE',explanation:'Goods were delivered.'})})}));assert.equal(r.status,'UNAVAILABLE');assert.equal(/goods were delivered/i.test(r.explanation),false);});
test('webhook evidence explanation distinguishes event receipt from fulfillment',async()=>{const e=evidence();e.verifiedWebhooks=[{verification:'SUCCESS',event_type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'CAPTURE123',order_id:'ORDER123456'}];const record={result:reconcile(claim(),e,now),evidence:e};const r=await explain(record,'What does the webhook prove?',async()=>({ok:true,json:async()=>({response:JSON.stringify({focus:'WEBHOOK_EVIDENCE'})})}));assert.equal(r.status,'GENERATED');assert.match(r.explanation,/event message to CFR/i);assert.match(r.explanation,/does not prove shipping/i);});
test('PayPal authentication failure cannot leak a secret',async()=>{const p=new PayPal({clientId:'private-client',secret:'private-secret',fetcher:async()=>({ok:false,status:401})});const e=await p.evidence('ORDER123456');assert.equal(e.error,'PAYPAL_AUTH_FAILED');assert.equal(JSON.stringify(e).includes('private-secret'),false);});
test('PayPal provider calls only fixed sandbox host',async()=>{const urls=[];const p=new PayPal({clientId:'test',secret:'test',fetcher:async(url)=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/token')?{access_token:'hidden',expires_in:100}:{id:'ORDER123456',status:'CREATED',purchase_units:[{amount:{value:'10.00',currency_code:'USD'}}]}};}});await p.evidence('ORDER123456');assert.ok(urls.length>=2);assert.ok(urls.every(u=>u.startsWith('https://api-m.sandbox.paypal.com/')));});
test('PayPal webhook verification preserves the original event JSON bytes',async()=>{const calls=[];const raw='{"id":"WH-12345678","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAPTURE123","supplementary_data":{"related_ids":{"order_id":"ORDER123456"}}}}';const p=new PayPal({clientId:'test',secret:'test',fetcher:async(url,init={})=>{calls.push({url,init});if(url.endsWith('/v1/oauth2/token'))return {ok:true,json:async()=>({access_token:'hidden',expires_in:100})};return {ok:true,json:async()=>({verification_status:'SUCCESS'})};}});const r=await p.verifyWebhook({'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api-m.sandbox.paypal.com/cert','paypal-transmission-id':'abc','paypal-transmission-sig':'sig','paypal-transmission-time':'2026-10-21T12:00:00Z'},raw,'WH-ID-123456');assert.equal(r.verification,'SUCCESS');assert.equal(r.resource_id,'CAPTURE123');const body=calls.at(-1).init.body;assert.ok(body.includes('"webhook_event":'+raw));});
test('PayPal webhook verification fails closed when signature verification fails',async()=>{const raw='{"id":"WH-12345678","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAPTURE123"}}';const p=new PayPal({clientId:'test',secret:'test',fetcher:async(url)=>url.endsWith('/v1/oauth2/token')?{ok:true,json:async()=>({access_token:'hidden',expires_in:100})}:{ok:true,json:async()=>({verification_status:'FAILURE'})}});await assert.rejects(p.verifyWebhook({'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api-m.sandbox.paypal.com/cert','paypal-transmission-id':'abc','paypal-transmission-sig':'sig','paypal-transmission-time':'2026-10-21T12:00:00Z'},raw,'WH-ID-123456'),/WEBHOOK_VERIFICATION_FAILED/);});
test('provider rejects arbitrary endpoints',async()=>{const p=new PayPal();await assert.rejects(p.request('https://api-m.paypal.com'),/denied/);});
test('identifiers cannot inject URLs',async()=>{const p=new PayPal();await assert.rejects(p.evidence('../payments'),/INVALID_ORDER_ID/);});
