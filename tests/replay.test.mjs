import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {verifyChain} from '../core.mjs';

async function fixtures(){
  const files=(await readdir('fixtures')).filter(f=>/^CFR-REPLAY-.*\.json$/.test(f)).sort();
  return Promise.all(files.map(async f=>JSON.parse(await readFile('fixtures/'+f,'utf8'))));
}

test('public replay fixtures form an intact sealed chain',async()=>{
  const rows=(await fixtures()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  assert.equal(rows.length,2);assert.equal(verifyChain(rows),true);
  assert.ok(rows.every(r=>r.environment==='SANDBOX_REPLAY'&&/read-only public replay/i.test(r.replayNotice)));
});

test('public replay contains one false-success divergence with no capture',async()=>{
  const rows=await fixtures(), r=rows.find(x=>x.result.verdict==='DIVERGENCE');
  assert.ok(r);assert.equal(r.result.code,'NOT_CAPTURED');assert.equal(r.evidence.capture,null);assert.match(r.result.fulfillment,/RECOMMEND FULFILLMENT HOLD/);
});

test('public replay contains one webhook-backed confirmed payment',async()=>{
  const rows=await fixtures(), r=rows.find(x=>x.result.code==='CAPTURE_AND_WEBHOOK_CONFIRMED');
  assert.ok(r);assert.equal(r.evidence.order.status,'COMPLETED');assert.equal(r.evidence.capture.status,'COMPLETED');assert.equal(r.evidence.verifiedWebhooks.length,1);assert.equal(r.evidence.verifiedWebhooks[0].verification,'SUCCESS');
});

test('public replay fixtures contain no credential-like material',async()=>{
  for(const r of await fixtures()){
    const text=JSON.stringify(r).toLowerCase();
    for(const forbidden of ['client_secret','access_token','refresh_token','paypal_client_secret','password']) assert.equal(text.includes(forbidden),false);
  }
});
