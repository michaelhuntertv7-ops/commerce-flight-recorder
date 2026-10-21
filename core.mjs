import { createHash } from 'node:crypto';
export const VERSION = '0.1.0';
export function money(value) {
  if (typeof value !== 'string' || !/^\d{1,10}\.\d{2}$/.test(value)) return null;
  return BigInt(value.replace('.', ''));
}
export function reconcile(claim, evidence, now = Date.now()) {
  const result = (verdict, code, reason) => ({ verdict, code, reason, fulfillment: verdict === 'CONFIRMED' ? 'PAYMENT VERIFIED — REVIEW OTHER FULFILLMENT CHECKS' : 'HOLD FULFILLMENT', scope: 'Payment captured for this order, amount and currency at observation time. Not a guarantee against future refunds, disputes or reversals.' });
  if (!claim || typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 2000 || claim.expected !== 'PAYMENT_COMPLETED' || !/^[A-Z0-9]{8,32}$/.test(claim.orderId || '') || money(claim.amount) === null || !/^[A-Z]{3}$/.test(claim.currency || ''))
    return result('INCOMPLETE', 'INVALID_CLAIM', 'A valid claim, order ID, amount, currency and explicit payment-completed assertion are required.');
  if (!evidence || evidence.source !== 'PAYPAL_SANDBOX_API' || evidence.error)
    return result('INCOMPLETE', 'API_UNAVAILABLE', 'Authoritative PayPal sandbox evidence is unavailable.');
  const age = now - Date.parse(evidence.observedAt);
  if (!Number.isFinite(age) || age < -5000 || age > 120000)
    return result('INCOMPLETE', 'STALE_EVIDENCE', 'The evidence timestamp is invalid or older than two minutes.');
  const o = evidence.order;
  if (!o || !o.id || !o.status) return result('INCOMPLETE', 'MISSING_ORDER', 'PayPal order evidence is incomplete.');
  if (o.id !== claim.orderId) return result('DIVERGENCE', 'ORDER_MISMATCH', 'The PayPal order identifier differs from the claim.');
  if (!Array.isArray(o.purchase_units) || o.purchase_units.length !== 1)
    return result('INCOMPLETE', 'UNSUPPORTED_ORDER', 'This prototype verifies single-purchase-unit orders only.');
  const unit = o.purchase_units[0];
  if (money(unit.amount?.value) === null || !unit.amount?.currency_code)
    return result('INCOMPLETE', 'MISSING_AMOUNT', 'PayPal order amount evidence is incomplete.');
  if (money(unit.amount.value) !== money(claim.amount) || unit.amount.currency_code !== claim.currency)
    return result('DIVERGENCE', 'AMOUNT_MISMATCH', 'The order amount or currency differs from the claim.');
  if (claim.reference && unit.reference_id !== claim.reference)
    return result('DIVERGENCE', 'REFERENCE_MISMATCH', 'The business reference differs from the claim.');
  const linked = unit.payments?.captures || [];
  if (!Array.isArray(linked)) return result('INCOMPLETE', 'MALFORMED_CAPTURES', 'PayPal capture evidence has an unexpected structure.');
  if (linked.length > 1) return result('DIVERGENCE', 'MULTIPLE_CAPTURES', 'Multiple captures require review; this prototype expects one full capture.');
  if (!linked.length) {
    if (['CREATED','SAVED','PAYER_ACTION_REQUIRED','APPROVED','VOIDED'].includes(o.status))
      return result('DIVERGENCE', 'NOT_CAPTURED', 'PayPal has no capture for this order. Approval or creation is not payment completion.');
    return result('INCOMPLETE', 'MISSING_CAPTURE', 'No authoritative capture is available to prove payment completion.');
  }
  const c = evidence.capture;
  if (!c || !c.id || !c.status) return result('INCOMPLETE', 'MISSING_CAPTURE', 'Independent capture lookup did not return complete evidence.');
  if (c.id !== linked[0].id || (c.supplementary_data?.related_ids?.order_id && c.supplementary_data.related_ids.order_id !== o.id))
    return result('DIVERGENCE', 'CAPTURE_MISMATCH', 'The independently retrieved capture does not match the order.');
  if (['PENDING','DECLINED','DENIED','FAILED','REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(c.status))
    return result('DIVERGENCE', 'CAPTURE_NOT_COMPLETED', 'PayPal capture status is ' + c.status + ', not a currently completed payment.');
  if (c.status !== 'COMPLETED') return result('INCOMPLETE', 'UNKNOWN_STATE', 'PayPal returned an unsupported capture state.');
  if (money(c.amount?.value) === null || !c.amount?.currency_code)
    return result('INCOMPLETE', 'MISSING_CAPTURE_AMOUNT', 'Capture amount evidence is incomplete.');
  if (money(c.amount.value) !== money(claim.amount) || c.amount.currency_code !== claim.currency)
    return result('DIVERGENCE', 'CAPTURE_AMOUNT_MISMATCH', 'The captured amount or currency differs from the claim.');
  if (o.status !== 'COMPLETED' || linked[0].status !== c.status)
    return result('INCOMPLETE', 'CONFLICTING_STATE', 'Order and independently retrieved capture states disagree. Recheck before fulfillment.');
  if (unit.payments?.refunds?.length || evidence.events?.some(e => /REFUND|REVERSE|DENIED/.test(e.event_type || '')))
    return result('INCOMPLETE', 'ADVERSE_EVENT', 'Related refund or adverse-event evidence requires review.');
  return result('CONFIRMED', 'CAPTURE_CONFIRMED', 'PayPal independently reports one completed capture matching the claimed order, amount and currency.');
}
export function seal(record, previousHash = null) {
  const payload = { ...record, previousHash };
  return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
export function verifySeal(record) {
  const { sha256, ...payload } = record;
  return sha256 === createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
