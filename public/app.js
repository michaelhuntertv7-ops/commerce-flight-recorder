const $=id=>document.getElementById(id);
let current=null, ai=null, activeOrder=null, readOnlyDemo=false;
const defaultClaim='Payment completed successfully. Fulfillment may proceed.';
const notify=t=>$('status').textContent=t;
async function api(path,body){
  const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-CFR-Request':'1'},body:JSON.stringify(body)}:{});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;
}
function shortClaim(text){const clean=(text||'').replace(/\s+/g,' ').trim();return clean.length>52?clean.slice(0,49)+'…':clean||'No claim supplied';}
function bindClaim(claim={}){
  $('claim').value=claim.text||defaultClaim;
  $('assertion').value=claim.expected||'PAYMENT_COMPLETED';
  $('order').value=claim.orderId||'';
  $('amount').value=claim.amount||'10.00';
  $('currency').value=claim.currency||'USD';
}
function reviewMode(){
  $('approve').classList.add('disabled');$('approve').removeAttribute('href');$('capture').disabled=true;
}
function demoMode(o){
  if(!o)return;activeOrder=o;current=null;ai=null;bindClaim({text:defaultClaim,expected:'PAYMENT_COMPLETED',orderId:o.id,amount:'10.00',currency:'USD'});
  if(o.approvalUrl){$('approve').href=o.approvalUrl;$('approve').classList.remove('disabled');}else{$('approve').classList.add('disabled');$('approve').removeAttribute('href');}
  $('capture').disabled=false;$('empty').hidden=false;$('result').hidden=true;$('export').disabled=true;
}
function render(record){
  current=record;ai=null;bindClaim(record.claim);reviewMode();$('empty').hidden=true;$('result').hidden=false;$('export').disabled=false;
  $('verdict').textContent=record.result.verdict;$('verdictBox').className=record.result.verdict.toLowerCase();
  for(const id of ['reason','fulfillment','scope'])$(id).textContent=record.result[id];
  $('agentClaimShort').textContent=shortClaim(record.claim?.text);
  $('orderState').textContent=record.evidence.order?.status||'UNAVAILABLE';
  $('captureState').textContent=record.evidence.capture?.status||'NO CAPTURE EVIDENCE';
  const apiEvents=record.evidence.events?.length||0, verifiedDeliveries=record.evidence.verifiedWebhooks?.length||0;
  $('events').textContent=apiEvents+' API event'+(apiEvents===1?'':'s')+' · '+verifiedDeliveries+' verified webhook'+(verifiedDeliveries===1?'':'s');
  $('delivery').textContent=record.evidence.webhookDelivery==='INTEGRITY_FAILURE'?'Integrity failure — hold':verifiedDeliveries?verifiedDeliveries+' PayPal-signed webhook'+(verifiedDeliveries===1?'':'s'):'Not observed — not claimed';
  $('raw').textContent=JSON.stringify(record,null,2);
  $('aiText').textContent='Ask a plain-language question about this flight record. AI interprets what you are asking; the answer itself is assembled from sealed evidence, not invented by the model.';
  $('aiLabel').textContent='Local AI routes the question · sealed evidence supplies the answer · verdict stays deterministic';
}
async function refresh(){
  const s=await api('/api/status');activeOrder=s.order||activeOrder;readOnlyDemo=!!s.readOnlyDemo;
  if(readOnlyDemo){$('environmentBadge').textContent='PAYPAL SANDBOX REPLAY · READ ONLY';$('replayNotice').hidden=false;$('create').disabled=true;$('verify').disabled=true;$('capture').disabled=true;$('approve').classList.add('disabled');$('approve').removeAttribute('href');}
  $('history').replaceChildren(...s.records.map(r=>{const b=document.createElement('button');b.textContent=r.verdict+' · '+new Date(r.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});b.setAttribute('aria-label','Open '+r.verdict+' flight record from '+new Date(r.createdAt).toLocaleString());b.onclick=()=>run(b,async()=>{render(await api('/api/records/'+r.id));notify('Viewing sealed flight record. Use demo Step 1 to switch back to the active sandbox order.');});return b;}));
  if(!current&&s.records.length){render(await api('/api/records/'+s.records[0].id));notify(readOnlyDemo?'Judge-safe replay loaded · certified Sandbox evidence · payment writes disabled.':'Latest sealed flight record loaded. Use demo Step 1 to start or resume the active sandbox order.');}
  else if(!current&&activeOrder&&!readOnlyDemo)demoMode(activeOrder);
}
async function run(button,task){button.disabled=true;try{await task();}catch(e){notify(e.message);}finally{button.disabled=false;}}
$('create').onclick=()=>run($('create'),async()=>{notify('Starting or resuming the sandbox order…');demoMode(await api('/api/demo/create',{}));notify('Active sandbox order loaded. Verify before capture to expose the false-success risk.');});
$('capture').onclick=()=>run($('capture'),async()=>{notify('Checking buyer approval and capturing sandbox funds…');const r=await api('/api/demo/capture',{});notify('PayPal returned '+r.status+'. Verify again to see whether the merchant decision changes.');});
$('verify').onclick=()=>run($('verify'),async()=>{
  notify('Checking the agent claim against independent PayPal evidence…');
  const r=await api('/api/reconcile',{text:$('claim').value,expected:$('assertion').value,orderId:$('order').value.trim(),amount:$('amount').value.trim(),currency:$('currency').value.trim().toUpperCase()});
  render(r);notify('Flight record sealed · '+r.result.verdict+' · '+(r.result.verdict==='CONFIRMED'?'payment evidence supports the claim':'CFR recommends holding the business action'));await refresh();
});
$('explain').onclick=()=>run($('explain'),async()=>{if(!current)return;const id=current.id,question=$('aiQuestion').value.trim();$('aiText').textContent='The local evidence analyst is reading this sealed flight record…';const a=await api('/api/explain',{id,question});if(current.id!==id)return;ai=a;$('aiText').textContent=a.explanation;$('aiLabel').textContent=a.label;});
$('export').onclick=()=>{if(!current)return;const blob=new Blob([JSON.stringify({record:current,aiExplanation:ai},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=current.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
refresh().catch(e=>notify(e.message));
if(location.pathname==='/approved')notify('Sandbox buyer approved the order. Use demo Step 1 to resume it, then capture and verify what PayPal actually recorded.');
if(location.pathname==='/cancelled')notify('Sandbox checkout was cancelled. No successful payment is asserted.');
