import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storeVerifiedWebhook,loadVerifiedWebhooks,verifyWebhookReceipt} from '../webhooks.mjs';

const verified=(overrides={})=>({id:'WH-12345678-ABCDEFG',event_type:'PAYMENT.CAPTURE.COMPLETED',create_time:'2026-10-21T23:37:12Z',verification:'SUCCESS',resource_id:'CAPTURE123',order_id:'ORDER123456',...overrides});
const headers={'paypal-transmission-id':'tx-123'};
async function sandbox(t){const dir=await mkdtemp(join(tmpdir(),'cfr-webhooks-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('verified webhook is stored once and correlated to capture/order',async t=>{const dir=await sandbox(t);const first=await storeVerifiedWebhook(dir,verified(),'{"event":"one"}',headers);assert.equal(first.duplicate,false);assert.equal(verifyWebhookReceipt(first.receipt),true);const rows=await loadVerifiedWebhooks(dir,{orderId:'ORDER123456',captureId:'CAPTURE123'});assert.equal(rows.length,1);assert.equal(rows[0].event_type,'PAYMENT.CAPTURE.COMPLETED');assert.equal(rows[0].verification,'SUCCESS');});

test('identical PayPal redelivery deduplicates by event id',async t=>{const dir=await sandbox(t);await storeVerifiedWebhook(dir,verified(),'{"event":"one"}',headers);const second=await storeVerifiedWebhook(dir,verified(),'{"event":"one"}',{'paypal-transmission-id':'tx-456'});assert.equal(second.duplicate,true);const rows=await loadVerifiedWebhooks(dir,{captureId:'CAPTURE123'});assert.equal(rows.length,1);});

test('same event id with different signed body fails closed as conflict',async t=>{const dir=await sandbox(t);await storeVerifiedWebhook(dir,verified(),'{"event":"one"}',headers);await assert.rejects(storeVerifiedWebhook(dir,verified(),'{"event":"changed"}',headers),/WEBHOOK_EVENT_CONFLICT/);});

test('tampered persisted webhook fails integrity validation',async t=>{const dir=await sandbox(t);const {receipt}=await storeVerifiedWebhook(dir,verified(),'{"event":"one"}',headers);const path=join(dir,receipt.eventId+'.json');const changed=JSON.parse(await readFile(path,'utf8'));changed.resourceId='OTHER';await writeFile(path,JSON.stringify(changed));await assert.rejects(loadVerifiedWebhooks(dir,{orderId:'ORDER123456'}),/WEBHOOK_STORE_INVALID/);});

test('unrelated verified event is not attached to another payment',async t=>{const dir=await sandbox(t);await storeVerifiedWebhook(dir,verified(),'{"event":"one"}',headers);const rows=await loadVerifiedWebhooks(dir,{orderId:'OTHERORDER1',captureId:'OTHERCAP1'});assert.deepEqual(rows,[]);});
