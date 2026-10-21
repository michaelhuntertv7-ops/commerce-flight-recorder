import http from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PayPal} from './paypal.mjs';
import {reconcile,seal,VERSION} from './core.mjs';
import {explain} from './ai.mjs';
const port=Number(process.env.PORT || 4317), origin='http://127.0.0.1:'+port;
const paypal=new PayPal();
await mkdir('data',{recursive:true});
let state;
try {state=JSON.parse(await readFile('data/session.json','utf8'));} catch {state={createKey:randomUUID(),captureKey:randomUUID(),order:null};}
async function save(){await writeFile('data/session.json',JSON.stringify(state));}
await save();
const records=new Map();
for(const f of await readdir('data')) if(/^CFR-[\w-]+\.json$/.test(f)) {
  try {const r=JSON.parse(await readFile('data/'+f,'utf8'));records.set(r.id,r);} catch {}
}
const ordered=[...records.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
records.clear();for(const r of ordered)records.set(r.id,r);
let busy=false;
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)throw new Error('BODY_TOO_LARGE');}return JSON.parse(data||'{}');}
const server=http.createServer(async(req,res)=>{
  try {
    if(req.headers.host!=='127.0.0.1:'+port && req.headers.host!=='localhost:'+port) return send(res,403,{error:'HOST_DENIED'});
    const url=new URL(req.url,origin);
    if(req.method==='GET' && ['/','/approved','/cancelled'].includes(url.pathname)) {
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      return res.end(await readFile('public/index.html'));
    }
    if(req.method==='GET' && ['/app.js','/style.css'].includes(url.pathname)) {
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css','X-Content-Type-Options':'nosniff'});
      return res.end(await readFile('public'+url.pathname));
    }
    if(req.method==='GET' && url.pathname==='/api/status') return send(res,200,{version:VERSION,sandbox:true,configured:!!(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET),order:state.order,records:[...records.values()].map(r=>({id:r.id,verdict:r.result.verdict,createdAt:r.createdAt})).reverse()});
    if(req.method==='GET' && /^\/api\/records\/CFR-[\w-]+$/.test(url.pathname)){
      const r=records.get(url.pathname.split('/').at(-1)); return send(res,r?200:404,r||{error:'NOT_FOUND'});
    }
    if(req.method!=='POST') return send(res,404,{error:'NOT_FOUND'});
    if(![origin,'http://localhost:'+port].includes(req.headers.origin)||req.headers['x-cfr-request']!=='1') return send(res,403,{error:'ORIGIN_DENIED'});
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
        if(current.order?.status==='COMPLETED') return send(res,200,{id:state.order.id,status:'COMPLETED'});
        if(current.order?.status!=='APPROVED') return send(res,409,{error:'Buyer approval is required before capture.'});
        return send(res,200,await paypal.capture(state.order.id,state.captureKey));
      }
      if(url.pathname==='/api/reconcile'){
        const claim={text:input.text,orderId:input.orderId,amount:input.amount,currency:input.currency,reference:input.reference||undefined,expected:input.expected,claimedAt:new Date().toISOString()};
        const invalid=reconcile(claim,null);
        const evidence=invalid.code==='INVALID_CLAIM'?{source:'NONE',observedAt:new Date().toISOString(),error:'INVALID_CLAIM'}:await paypal.evidence(claim.orderId);
        const result=reconcile(claim,evidence);
        const record={id:'CFR-'+randomUUID(),version:VERSION,createdAt:new Date().toISOString(),environment:'SANDBOX',claim,evidence,result};
        const sealed=seal(record,[...records.values()].at(-1)?.sha256||null);
        await writeFile('data/'+sealed.id+'.json',JSON.stringify(sealed,null,2),{flag:'wx'}); records.set(sealed.id,sealed);
        return send(res,200,sealed);
      }
      if(url.pathname==='/api/explain'){
        const record=records.get(input.id);if(!record)return send(res,404,{error:'NOT_FOUND'});
        const explanation=await explain(record);
        await writeFile('data/ai-'+record.id+'.json',JSON.stringify({recordId:record.id,recordHash:record.sha256,generatedAt:new Date().toISOString(),...explanation},null,2));
        return send(res,200,explanation);
      }
      return send(res,404,{error:'NOT_FOUND'});
    } finally {busy=false;}
  } catch(e){send(res,502,{error:/^PAYPAL_/.test(e.message)?e.message:'Operation failed; no successful outcome is asserted.'});}
});
server.listen(port,'127.0.0.1',()=>console.log('Commerce Flight Recorder sandbox: '+origin));
