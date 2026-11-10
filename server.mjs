import http from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PayPal} from './paypal.mjs';
import {reconcile,seal,verifyChain,VERSION} from './core.mjs';
import {storeVerifiedWebhook,loadVerifiedWebhooks} from './webhooks.mjs';
import {explain} from './ai.mjs';
const port=Number(process.env.PORT || 4317), replayMode=process.env.CFR_READ_ONLY_DEMO==='1', bindHost='127.0.0.1', origin='http://127.0.0.1:'+port;
const webhookPort=Number(process.env.WEBHOOK_PORT || 4321), webhookEnabled=!replayMode&&!!process.env.PAYPAL_WEBHOOK_ID;
if(!Number.isInteger(webhookPort)||webhookPort<1024||webhookPort>65535||webhookPort===port) throw new Error('INVALID_WEBHOOK_PORT');
const paypal=new PayPal();
await mkdir('data',{recursive:true});
let state;
if(replayMode) state={createKey:null,captureKey:null,order:null};
else {try {state=JSON.parse(await readFile('data/session.json','utf8'));} catch {state={createKey:randomUUID(),captureKey:randomUUID(),order:null};}}
async function save(){if(!replayMode)await writeFile('data/session.json',JSON.stringify(state));}
await save();
const records=new Map(), recordDir=replayMode?'fixtures':'data';
for(const f of await readdir(recordDir)) if(/^CFR-[\w-]+\.json$/.test(f)) {
  try {const r=JSON.parse(await readFile(recordDir+'/'+f,'utf8'));records.set(r.id,r);} catch {}
}
const ordered=[...records.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
if(!verifyChain(ordered)) throw new Error('EVIDENCE_CHAIN_INVALID');
records.clear();for(const r of ordered)records.set(r.id,r);
let busy=false;
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)throw new Error('BODY_TOO_LARGE');}return JSON.parse(data||'{}');}
async function rawBody(req,max=262144){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
const server=http.createServer(async(req,res)=>{
  try {
    if(!replayMode && req.headers.host!=='127.0.0.1:'+port && req.headers.host!=='localhost:'+port) return send(res,403,{error:'HOST_DENIED'});
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && ['/','/approved','/cancelled'].includes(url.pathname)) {
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      return res.end(await readFile('public/index.html'));
    }
    if(req.method==='GET' && ['/app.js','/style.css'].includes(url.pathname)) {
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css','X-Content-Type-Options':'nosniff'});
      return res.end(await readFile('public'+url.pathname));
    }
    if(req.method==='GET' && url.pathname==='/api/status') return send(res,200,{version:VERSION,sandbox:true,readOnlyDemo:replayMode,configured:!replayMode&&!!(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET),webhook:{configured:webhookEnabled,localPort:webhookEnabled?webhookPort:null},order:replayMode?null:(state.order?{id:state.order.id,approvalUrl:state.order.approvalUrl,cachedStatus:state.order.status}:null),records:[...records.values()].map(r=>({id:r.id,verdict:r.result.verdict,createdAt:r.createdAt})).reverse()});
    if(req.method==='GET' && /^\/api\/records\/CFR-[\w-]+$/.test(url.pathname)){
      const r=records.get(url.pathname.split('/').at(-1)); return send(res,r?200:404,r||{error:'NOT_FOUND'});
    }
    if(req.method!=='POST') return send(res,404,{error:'NOT_FOUND'});
    let originAllowed=false;
    if(replayMode){try{originAllowed=new URL(req.headers.origin||'').host===req.headers.host;}catch{originAllowed=false;}}
    else originAllowed=[origin,'http://localhost:'+port].includes(req.headers.origin);
    if(!originAllowed||req.headers['x-cfr-request']!=='1') return send(res,403,{error:'ORIGIN_DENIED'});
    if(replayMode&&url.pathname!=='/api/explain') return send(res,403,{error:'READ_ONLY_REPLAY'});
    const input=await body(req);
    if(busy)return send(res,409,{error:'Another operation is running. Please wait.'});
    busy=true;
    try {
      if(url.pathname==='/api/demo/create'){
        if(!state.order) {state.order=await paypal.create(state.createKey,origin);await save();}
        return send(res,200,state.order);
      }
      if(url.pathname==='/api/demo/capture'){
        if(!state.order) return send(res,400,{error:'Create the sandbox order first.'});
        const current=await paypal.evidence(state.order.id);
        if(current.order?.status==='COMPLETED') {state.order.status='COMPLETED';await save();return send(res,200,{id:state.order.id,status:'COMPLETED'});}
        if(current.order?.status!=='APPROVED') return send(res,409,{error:'Buyer approval is required before capture.'});
        const captured=await paypal.capture(state.order.id,state.captureKey);state.order.status=captured.status;await save();return send(res,200,captured);
      }
      if(url.pathname==='/api/reconcile'){
        const claim={text:input.text,orderId:input.orderId,amount:input.amount,currency:input.currency,reference:input.reference||undefined,expected:input.expected,claimedAt:new Date().toISOString()};
        const invalid=reconcile(claim,null);
        const evidence=invalid.code==='INVALID_CLAIM'?{source:'NONE',observedAt:new Date().toISOString(),error:'INVALID_CLAIM'}:await paypal.evidence(claim.orderId);
        if(!evidence.error && evidence.source==='PAYPAL_SANDBOX_API'){
          try {evidence.verifiedWebhooks=await loadVerifiedWebhooks('data/webhooks',{orderId:claim.orderId,captureId:evidence.capture?.id});evidence.webhookDelivery=evidence.verifiedWebhooks.length?'VERIFIED_DELIVERY':'NOT_OBSERVED';}
          catch {evidence.verifiedWebhooks=[];evidence.webhookDelivery='INTEGRITY_FAILURE';evidence.webhookError='WEBHOOK_STORE_INVALID';}
        }
        if(state.order?.id===claim.orderId && evidence.order?.status){state.order.status=evidence.order.status;await save();}
        const result=reconcile(claim,evidence);
        const record={id:'CFR-'+randomUUID(),version:VERSION,createdAt:new Date().toISOString(),environment:'SANDBOX',claim,evidence,result};
        const sealed=seal(record,[...records.values()].at(-1)?.sha256||null);
        await writeFile('data/'+sealed.id+'.json',JSON.stringify(sealed,null,2),{flag:'wx'}); records.set(sealed.id,sealed);
        return send(res,200,sealed);
      }
      if(url.pathname==='/api/explain'){
        const record=records.get(input.id);if(!record)return send(res,404,{error:'NOT_FOUND'});
        const question=typeof input.question==='string'?input.question:'';
        if(question.length>300)return send(res,400,{error:'QUESTION_TOO_LONG'});
        const explanation=await explain(record,question);
        if(!replayMode)await writeFile('data/ai-'+record.id+'.json',JSON.stringify({recordId:record.id,recordHash:record.sha256,generatedAt:new Date().toISOString(),...explanation},null,2));
        return send(res,200,explanation);
      }
      return send(res,404,{error:'NOT_FOUND'});
    } finally {busy=false;}
  } catch(e){send(res,502,{error:/^PAYPAL_/.test(e.message)?e.message:'Operation failed; no successful outcome is asserted.'});}
});
server.listen(port,bindHost,()=>console.log(replayMode?'Commerce Flight Recorder read-only replay: port '+port:'Commerce Flight Recorder sandbox: '+origin));

if(webhookEnabled){
  const allowedWebhookEvents=new Set(['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED']);
  const webhookServer=http.createServer(async(req,res)=>{
    const reply=status=>{res.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end();};
    try{
      if(req.method!=='POST'||req.url!=='/paypal-webhook') return reply(404);
      const raw=await rawBody(req);
      const verified=await paypal.verifyWebhook(req.headers,raw,process.env.PAYPAL_WEBHOOK_ID);
      if(!allowedWebhookEvents.has(verified.event_type)){console.log(JSON.stringify({webhook:'IGNORED_VERIFIED_EVENT',eventType:verified.event_type}));return reply(204);}
      const stored=await storeVerifiedWebhook('data/webhooks',verified,raw,req.headers);
      console.log(JSON.stringify({webhook:'VERIFIED',eventId:verified.id,eventType:verified.event_type,duplicate:stored.duplicate}));
      return reply(204);
    }catch(e){console.log(JSON.stringify({webhook:'REJECTED',code:e?.message||'VERIFY_FAILED'}));return reply(e?.message==='BODY_TOO_LARGE'?413:400);}
  });
  webhookServer.listen(webhookPort,'127.0.0.1',()=>console.log('CFR webhook receiver: http://127.0.0.1:'+webhookPort+'/paypal-webhook'));
}
