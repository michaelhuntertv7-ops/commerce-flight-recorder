const BASE = 'https://api-m.sandbox.paypal.com';
export class PayPal {
  constructor({ clientId = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET, fetcher = fetch } = {}) {
    this.clientId = clientId; this.secret = secret; this.fetcher = fetcher;
  }
  async request(path, { method = 'GET', body, requestId } = {}) {
    if (!/^\/(v2\/checkout\/orders|v2\/payments\/captures|v1\/notifications\/webhooks-events)(\/|\?|$)/.test(path)) throw new Error('Endpoint denied');
    if (!this.clientId || !this.secret) throw new Error('PAYPAL_NOT_CONFIGURED');
    if (!this.token || Date.now() >= this.expires) {
      const r = await this.fetcher(BASE + '/v1/oauth2/token', { method:'POST', headers:{Authorization:'Basic '+Buffer.from(this.clientId+':'+this.secret).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded'}, body:'grant_type=client_credentials', signal:AbortSignal.timeout(15000), redirect:'error' });
      if (!r.ok) throw new Error('PAYPAL_AUTH_FAILED');
      const t = await r.json();
      if (typeof t.access_token !== 'string') throw new Error('PAYPAL_AUTH_FAILED');
      this.token = t.access_token; this.expires = Date.now() + Math.min(Math.max(Number(t.expires_in || 60)-30, 1), 3600)*1000;
    }
    const r = await this.fetcher(BASE + path, { method, headers:{ Authorization:'Bearer '+this.token, 'Content-Type':'application/json', Prefer:'return=representation', ...(requestId ? {'PayPal-Request-Id':requestId} : {}) }, body:body ? JSON.stringify(body):undefined, signal:AbortSignal.timeout(20000), redirect:'error' });
    if (!r.ok) throw new Error('PAYPAL_HTTP_'+r.status);
    return r.json();
  }
  async evidence(orderId) {
    if (!/^[A-Z0-9]{8,32}$/.test(orderId)) throw new Error('INVALID_ORDER_ID');
    const startedAt = new Date().toISOString();
    try {
      const raw = await this.request('/v2/checkout/orders/'+orderId);
      const order = { id:raw.id, status:raw.status, purchase_units:raw.purchase_units?.map(u=>({ reference_id:u.reference_id, amount:u.amount, payments:{ captures:u.payments?.captures?.map(c=>({id:c.id,status:c.status})), refunds:u.payments?.refunds?.map(r=>({id:r.id,status:r.status})) } })) };
      const linked = order.purchase_units?.flatMap(u=>u.payments.captures || []) || [];
      let capture = null, events = [], eventStatus = 'NOT_QUERIED_NO_CAPTURE';
      if (linked.length === 1 && /^[A-Z0-9]{8,32}$/.test(linked[0].id)) {
        const c = await this.request('/v2/payments/captures/'+linked[0].id);
        capture = {id:c.id,status:c.status,amount:c.amount,create_time:c.create_time,update_time:c.update_time,supplementary_data:c.supplementary_data};
        try {
          const response = await this.request('/v1/notifications/webhooks-events?transaction_id='+capture.id+'&page_size=20');
          events = (response.events || []).filter(e=>e.resource?.id===capture.id || e.resource?.supplementary_data?.related_ids?.order_id===orderId).map(e=>({id:e.id,event_type:e.event_type,create_time:e.create_time,resource_id:e.resource?.id}));
          eventStatus = events.length ? 'API_RETRIEVED_NOT_DELIVERY_PROOF' : 'NO_RELATED_EVENTS_RETURNED';
        } catch { eventStatus = 'EVENT_API_UNAVAILABLE'; }
      }
      return {source:'PAYPAL_SANDBOX_API',startedAt,observedAt:new Date().toISOString(),order,capture,events,eventStatus,webhookDelivery:'NOT_OBSERVED',endpoints:['GET /v2/checkout/orders/{id}',...(capture ? ['GET /v2/payments/captures/{id}','GET /v1/notifications/webhooks-events'] : [])]};
    } catch(e) {
      return {source:'PAYPAL_SANDBOX_API',startedAt,observedAt:new Date().toISOString(),error:/^PAYPAL_/.test(e.message)?e.message:'PROVIDER_UNAVAILABLE',webhookDelivery:'NOT_OBSERVED'};
    }
  }
  async create(requestId, origin) {
    const order = await this.request('/v2/checkout/orders',{method:'POST',requestId,body:{intent:'CAPTURE',purchase_units:[{reference_id:'CFR-DEMO',description:'Commerce Flight Recorder sandbox demonstration',amount:{currency_code:'USD',value:'10.00'}}],payment_source:{paypal:{experience_context:{brand_name:'Commerce Flight Recorder Sandbox',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:origin+'/approved',cancel_url:origin+'/cancelled'}}}}});
    const approval = order.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
    if (approval && new URL(approval).hostname !== 'www.sandbox.paypal.com') throw new Error('NON_SANDBOX_APPROVAL_DENIED');
    return {id:order.id,status:order.status,approvalUrl:approval};
  }
  async capture(orderId, requestId) {
    if (!/^[A-Z0-9]{8,32}$/.test(orderId)) throw new Error('INVALID_ORDER_ID');
    const o=await this.request('/v2/checkout/orders/'+orderId+'/capture',{method:'POST',requestId,body:{}});
    return {id:o.id,status:o.status};
  }
}
