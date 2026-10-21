export async function explain(record, fetcher = fetch) {
  // AI only chooses a concise phrasing. It cannot alter the sealed deterministic verdict.
  const model = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  try {
    const r = await fetcher('http://127.0.0.1:11434/api/generate', {
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),
      body:JSON.stringify({model,stream:false,keep_alive:'5m',options:{temperature:0,num_predict:120,num_ctx:2048},
        format:{type:'object',properties:{explanation:{type:'string'}},required:['explanation'],additionalProperties:false},
        system:'Explain the supplied reconciliation result to a small business operator in one or two sentences. Use only supplied facts. Do not promise safety, give new instructions, or invent facts. No tools. Output JSON with explanation.',
        prompt:JSON.stringify({verdict:record.result.verdict,reason:record.result.reason,orderState:record.evidence.order?.status,captureState:record.evidence.capture?.status || 'NO_CAPTURE',eventStatus:record.evidence.eventStatus || 'UNAVAILABLE',scope:record.result.scope})
      })
    });
    if(!r.ok) throw new Error('AI unavailable');
    const data=await r.json(), output=JSON.parse(data.response);
    if(typeof output.explanation !== 'string' || !output.explanation.trim() || output.explanation.length>1000) throw new Error('Invalid AI output');
    return {status:'GENERATED',provider:'Ollama local',model,explanation:output.explanation,label:'AI-assisted explanation — advisory; the deterministic verdict above is authoritative.'};
  } catch {
    return {status:'UNAVAILABLE',provider:'Ollama local',model,explanation:record.result.reason,label:'Deterministic explanation; AI unavailable. Verdict unchanged.'};
  }
}
