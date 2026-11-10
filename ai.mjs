const FOCUS = new Set(['PAYMENT_EVIDENCE','DECISION_REASON','WEBHOOK_EVIDENCE','SCOPE_LIMITS','FULFILLMENT_ACTION']);

function answerFromRecord(record, focus) {
  const orderState=record.evidence.order?.status || 'UNAVAILABLE';
  const captureState=record.evidence.capture?.status || 'NO_CAPTURE';
  const webhookCount=Array.isArray(record.evidence.verifiedWebhooks)?record.evidence.verifiedWebhooks.length:0;
  if(focus==='PAYMENT_EVIDENCE'){
    const webhookText=webhookCount?`${webhookCount} verified PayPal webhook receipt${webhookCount===1?'':'s'} correlated to this payment`:'no verified PayPal webhook receipt attached to this record';
    return `${record.result.reason} Evidence snapshot: PayPal order ${orderState}; independent capture ${captureState}; ${webhookText}.`;
  }
  if(focus==='WEBHOOK_EVIDENCE'){
    return webhookCount
      ? `CFR holds ${webhookCount} verified PayPal webhook receipt${webhookCount===1?'':'s'} correlated to this payment. A webhook receipt proves PayPal delivered a signed event message to CFR; it does not prove shipping, goods delivery, service delivery, or fulfillment.`
      : 'No verified PayPal webhook receipt is attached to this flight record. That absence is not treated as proof that the payment failed.';
  }
  if(focus==='SCOPE_LIMITS') return `${record.result.scope} It does not prove that goods, services, shipping, or fulfillment were completed.`;
  if(focus==='FULFILLMENT_ACTION') return record.result.verdict==='CONFIRMED'
    ? `${record.result.fulfillment}. The payment check passed, but normal non-payment fulfillment checks still apply.`
    : `${record.result.fulfillment}. Resolve the payment-evidence issue before the business proceeds.`;
  return `${record.result.verdict}: ${record.result.reason} ${record.result.fulfillment}.`;
}

export async function explain(record, question = 'What payment evidence supports this verdict?', fetcher = fetch) {
  const model = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  const operatorQuestion = typeof question === 'string' && question.trim() && question.length <= 300 ? question.trim() : 'Explain this payment decision.';
  let focus='DECISION_REASON';
  try {
    const r=await fetcher('http://127.0.0.1:11434/api/generate',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),
      body:JSON.stringify({model,stream:false,keep_alive:'5m',options:{temperature:0,num_predict:30,num_ctx:1024},
        format:{type:'object',properties:{focus:{type:'string',enum:[...FOCUS]}},required:['focus'],additionalProperties:false},
        system:'Classify the operator question for an evidence navigator. Do not answer the question and do not add facts. Return exactly one JSON field named focus. Choose PAYMENT_EVIDENCE for questions about proof of payment or what supports the verdict; DECISION_REASON for why the verdict is confirmed/held/divergent; WEBHOOK_EVIDENCE for signed events or webhook meaning; SCOPE_LIMITS for what the record does not prove or limitations; FULFILLMENT_ACTION for what the operator should do next.',
        prompt:JSON.stringify({question:operatorQuestion})
      })
    });
    if(!r.ok) throw new Error('AI unavailable');
    const data=await r.json(), output=JSON.parse(data.response);
    if(!output||typeof output!=='object'||Object.keys(output).length!==1||!FOCUS.has(output.focus)) throw new Error('Invalid AI output');
    focus=output.focus;
    return {status:'GENERATED',provider:'Ollama local',model,question:operatorQuestion,focus,explanation:answerFromRecord(record,focus),label:'AI interpreted the question; answer assembled from sealed evidence. Deterministic verdict unchanged.'};
  } catch {
    return {status:'UNAVAILABLE',provider:'Ollama local',model,question:operatorQuestion,focus,explanation:answerFromRecord(record,focus),label:'Deterministic evidence explanation shown; AI question routing unavailable. Verdict unchanged.'};
  }
}
