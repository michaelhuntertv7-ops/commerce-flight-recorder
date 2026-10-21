const $=id=>document.getElementById(id);
let current=null, ai=null;
const notify=t=>$('status').textContent=t;
async function api(path,body){
  const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-CFR-Request':'1'},body:JSON.stringify(body)}:{});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;
}
function render(record){
  current=record;ai=null;$('empty').hidden=true;$('result').hidden=false;$('export').disabled=false;
  $('verdict').textContent=record.result.verdict;$('verdictBox').className=record.result.verdict.toLowerCase();
  for(const id of ['reason','fulfillment','scope'])$(id).textContent=record.result[id];
  $('orderState').textContent=record.evidence.order?.status||'UNAVAILABLE';
  $('captureState').textContent=record.evidence.capture?.status||'NO CAPTURE EVIDENCE';
  $('events').textContent=(record.evidence.events?.length||0)+' related · '+(record.evidence.eventStatus||'UNAVAILABLE').replaceAll('_',' ');
  $('delivery').textContent='Not observed — not claimed';
  $('raw').textContent=JSON.stringify(record,null,2);
  $('aiText').textContent='Generate an optional local AI explanation of the evidence.';
  $('aiLabel').textContent='Ollama · Llama 3.2 3B · Verdict cannot be changed by AI';
}
function order(o){if(!o)return;$('order').value=o.id;if(o.approvalUrl){$('approve').href=o.approvalUrl;$('approve').classList.remove('disabled');}}
async function refresh(){
  const s=await api('/api/status');if(!$('order').value)order(s.order);
  $('history').replaceChildren(...s.records.map(r=>{const b=document.createElement('button');b.textContent=r.verdict+' · '+new Date(r.createdAt).toLocaleTimeString();b.onclick=()=>run(b,async()=>render(await api('/api/records/'+r.id)));return b;}));
}
async function run(button,task){button.disabled=true;try{await task();}catch(e){notify(e.message);}finally{button.disabled=false;}}
$('create').onclick=()=>run($('create'),async()=>{notify('Creating or reusing the sandbox test order…');order(await api('/api/demo/create',{}));notify('Sandbox order ready. Verify now to expose the uncaptured-payment claim.');});
$('capture').onclick=()=>run($('capture'),async()=>{notify('Checking buyer approval and capturing sandbox funds…');const r=await api('/api/demo/capture',{});notify('PayPal returned '+r.status+'. Run independent verification next.');});
$('verify').onclick=()=>run($('verify'),async()=>{
  notify('Independently reading PayPal order and capture evidence…');
  const r=await api('/api/reconcile',{text:$('claim').value,expected:$('assertion').value,orderId:$('order').value.trim(),amount:$('amount').value.trim(),currency:$('currency').value.trim().toUpperCase()});
  render(r);notify('Flight record saved · '+r.result.verdict);await refresh();
});
$('explain').onclick=()=>run($('explain'),async()=>{if(!current)return;const id=current.id;$('aiText').textContent='Local AI is reading the evidence. First use may take up to two minutes…';const a=await api('/api/explain',{id});if(current.id!==id)return;ai=a;$('aiText').textContent=a.explanation;$('aiLabel').textContent=a.label;});
$('export').onclick=()=>{if(!current)return;const blob=new Blob([JSON.stringify({record:current,aiExplanation:ai},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=current.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
refresh().catch(e=>notify(e.message));
if(location.pathname==='/approved')notify('Returned from sandbox approval. Capture the test payment, then verify independently.');
if(location.pathname==='/cancelled')notify('Sandbox checkout cancelled. No successful payment is asserted.');
