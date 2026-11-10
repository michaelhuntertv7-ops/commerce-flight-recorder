import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

function digest(value){return createHash('sha256').update(value).digest('hex');}
function safeHeader(headers,name){const v=headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];return Array.isArray(v)?v[0]:v;}
function receiptHash(receipt){const {integritySha256,...payload}=receipt;return digest(JSON.stringify(payload));}
export function verifyWebhookReceipt(receipt){return !!receipt && typeof receipt.integritySha256==='string' && receipt.integritySha256===receiptHash(receipt);}

export async function storeVerifiedWebhook(dir,verified,rawBody,headers={}){
  if(verified?.verification!=='SUCCESS') throw new Error('WEBHOOK_NOT_VERIFIED');
  if(!/^WH-[A-Z0-9-]{8,80}$/.test(verified.id||'')) throw new Error('INVALID_WEBHOOK_EVENT');
  if(typeof verified.event_type!=='string'||!verified.event_type.length) throw new Error('INVALID_WEBHOOK_EVENT');
  if(typeof rawBody!=='string'||!rawBody.length) throw new Error('INVALID_WEBHOOK_BODY');
  await mkdir(dir,{recursive:true});
  const receipt={source:'PAYPAL_SANDBOX_WEBHOOK',receivedAt:new Date().toISOString(),verification:'SUCCESS',eventId:verified.id,eventType:verified.event_type,createTime:verified.create_time||null,resourceId:verified.resource_id||null,orderId:verified.order_id||null,transmissionId:safeHeader(headers,'paypal-transmission-id')||null,bodySha256:digest(rawBody)};
  receipt.integritySha256=receiptHash(receipt);
  const path=dir+'/'+receipt.eventId+'.json';
  try {await writeFile(path,JSON.stringify(receipt,null,2),{flag:'wx'});return {receipt,duplicate:false};}
  catch(e){
    if(e?.code!=='EEXIST') throw e;
    const existing=JSON.parse(await readFile(path,'utf8'));
    if(!verifyWebhookReceipt(existing)) throw new Error('WEBHOOK_STORE_INVALID');
    if(existing.bodySha256!==receipt.bodySha256||existing.eventType!==receipt.eventType||existing.resourceId!==receipt.resourceId||existing.orderId!==receipt.orderId) throw new Error('WEBHOOK_EVENT_CONFLICT');
    return {receipt:existing,duplicate:true};
  }
}

export async function loadVerifiedWebhooks(dir,{orderId,captureId}={}){
  let files=[];try{files=await readdir(dir);}catch(e){if(e?.code==='ENOENT')return[];throw e;}
  const receipts=[];
  for(const f of files.filter(x=>/^WH-[A-Z0-9-]{8,80}\.json$/.test(x)).sort()){
    const r=JSON.parse(await readFile(dir+'/'+f,'utf8'));
    if(!verifyWebhookReceipt(r)) throw new Error('WEBHOOK_STORE_INVALID');
    if((captureId&&r.resourceId===captureId)||(orderId&&(r.orderId===orderId||r.resourceId===orderId))) receipts.push({id:r.eventId,event_type:r.eventType,create_time:r.createTime,verification:r.verification,resource_id:r.resourceId,order_id:r.orderId,received_at:r.receivedAt,body_sha256:r.bodySha256});
  }
  return receipts;
}
