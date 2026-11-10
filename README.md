# Commerce Flight Recorder

**The black box for AI payments: verify what an agent actually did with money.**

Commerce Flight Recorder is a PayPal AI Hackathon project for merchants and commerce operators deploying AI agents. When an agent says a payment succeeded, CFR does not trust the sentence. It independently reads PayPal sandbox state, correlates signed webhook evidence when available, reconciles the facts, seals a flight record, and gives the operator a clear decision before fulfillment continues.

**Sandbox only. No real funds. Work in progress.**

## The problem

AI agents can sound certain even when payment state is not. A merchant may be one automated step away from shipping goods, provisioning a service, or releasing value based on an agent message that says “done.” Commerce Flight Recorder puts independent provider evidence between that message and the business action.

## The 10-second product story

1. **Agent claim** — “Payment completed. Fulfillment may proceed.”
2. **Independent truth** — CFR reads the PayPal order, independent capture state, and verified PayPal webhook receipts tied to that payment.
3. **Merchant decision** — deterministic reconciliation returns `CONFIRMED`, `DIVERGENCE`, or `INCOMPLETE`, with a fulfillment-hold recommendation whenever the evidence does not support the claim.
4. **AI evidence analyst** — an operator can ask a plain-language question about the selected sealed flight record. The local model classifies what evidence the operator is asking about; the answer itself is assembled deterministically from the sealed record, so the model cannot invent or change payment facts.

## Why it is different

Commerce Flight Recorder is not another pre-payment policy gate or agent firewall. It focuses on the **false-success problem after an AI agent acts**: the agent says “done,” but the merchant still needs independent proof of what PayPal actually recorded before releasing value.

CFR preserves the agent narrative as a claim, retrieves PayPal state independently, correlates verified webhook receipts when available, compares the two realities, and seals the result as a hash-chained flight record. The memorable failure case is not “the agent was denied permission”; it is **the agent sounded successful while authoritative payment evidence still contradicted it**.

The product is not a replacement for payment authorization or intent systems. It is the post-action runtime-truth layer that asks: **what actually happened, does PayPal agree with the agent’s story, and does the merchant have enough payment evidence to act?**

## Judge demo

The local experience is designed around one claim with two different realities:

1. Create the fixed **$10 USD PayPal sandbox** order.
2. Before capture, verify the default success claim. CFR should show that the payment is not complete and recommend a fulfillment hold.
3. Approve the order with a PayPal **personal sandbox** buyer.
4. Capture the payment with the merchant sandbox app.
5. Verify again. A matching order and independently retrieved completed capture can confirm the narrow payment assertion.
6. When a registered sandbox webhook is configured, a PayPal-signed `PAYMENT.CAPTURE.COMPLETED` webhook event can be persisted, integrity-checked, correlated to the exact order/capture, and surfaced in the same flight record.
7. Ask the local AI evidence analyst a question such as: **“What payment evidence supports this verdict?”**
8. Inspect or export the sealed evidence record.

The UI automatically opens the most recent sealed flight record so value is visible immediately rather than behind an empty setup screen.

## PayPal implementation

CFR uses the PayPal Developer Platform in **sandbox only**:

- Orders v2 for order creation and authoritative order readback.
- Payments v2 for independent capture lookup and capture state.
- Stable request IDs for bounded create/capture idempotency.
- PayPal webhook-signature verification for registered sandbox webhooks.
- Transaction-bound webhook correlation by order/capture identifiers.
- Fail-closed handling for provider errors, stale evidence, malformed state, duplicate captures, replay conflicts, and webhook-store integrity failures.

The PayPal API origin is hard-coded to `https://api-m.sandbox.paypal.com`; production endpoints are not configurable in this prototype.

## AI implementation

The evidence analyst runs locally through Ollama using `llama3.2:3b` by default. The model receives only the operator's bounded question and classifies it into one evidence focus: payment proof, verdict reason, webhook evidence, scope limits, or fulfillment action.

The model **does not author the factual answer**. CFR assembles that answer from the selected sealed flight record after the AI routes the question. The model has no payment tools, no PayPal credentials, and no authority to change the deterministic verdict. If AI routing is unavailable or malformed, CFR falls back to a deterministic evidence explanation.

## Judge quickstart

### Fastest path — credential-free read-only replay

No PayPal credentials, `.env`, npm install, or live provider call is required:

```sh
CFR_READ_ONLY_DEMO=1 npm run judge:check
npm test
npm run replay
```

On Windows PowerShell, use `$env:CFR_READ_ONLY_DEMO='1'; npm run judge:check`. Then open `http://127.0.0.1:4318` after `npm run replay`.

This mode loads two certified PayPal Sandbox observations: an earlier false-success `DIVERGENCE` and a later webhook-backed `CONFIRMED` payment. Payment-write endpoints are disabled, the server binds to loopback only, and no PayPal credentials are configured or required.

### Full interactive PayPal Sandbox path

To reproduce fresh provider reads and sandbox payment actions with your own PayPal developer account:

```sh
cp .env.example .env
# Add your own PayPal sandbox Client ID and Secret locally.
npm run judge:check
npm test
npm start
```

`npm run judge:check` never prints credential values. In interactive mode it verifies required sandbox configuration; in read-only replay mode it verifies that credentials are unnecessary and payment writes are disabled.

See `JUDGE_RUNBOOK.md` for the exact under-three-minute demonstration path and what is real versus deliberately bounded.

## Impact case

The project makes one specific operational claim: **a merchant should not release value because an AI sentence sounds confident.** The demo proves the failure mode directly: before capture, the agent can claim payment completion while authoritative PayPal state does not support it. CFR turns that mismatch into an explicit fulfillment-hold recommendation. After capture and independent readback, the same claim can become evidence-backed.

This is deliberately different from pre-payment policy or approval layers. CFR focuses on **post-action runtime truth**: what PayPal actually recorded, whether asynchronous evidence agrees, and whether the merchant has enough payment evidence to act.

## Run locally

Requires Node.js 22 or newer. The application has no npm runtime dependencies.

```sh
git clone https://github.com/michaelhuntertv7-ops/commerce-flight-recorder.git
cd commerce-flight-recorder
cp .env.example .env
# Fill in PayPal sandbox credentials locally. Never commit .env.
npm test
npm start
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred. Open `http://127.0.0.1:4317`.

For the optional local analyst, install Ollama from its official site, run `ollama pull llama3.2:3b`, and keep Ollama available at `127.0.0.1:11434`.

## Webhook configuration

The main product UI remains bound to loopback. When a PayPal sandbox webhook has been registered separately, set `PAYPAL_WEBHOOK_ID` and optionally `WEBHOOK_PORT` (default `4321`). CFR then starts a **webhook-only loopback listener** at `/paypal-webhook`.

For an actual PayPal webhook-delivery test, expose only that webhook listener through a temporary HTTPS endpoint, register that exact URL in PayPal sandbox, and remove the registration/tunnel after the test. Do **not** expose the main UI server publicly through that tunnel.

Verified webhook receipts are stored under ignored runtime data, deduplicated by PayPal event ID, hash-checked before reuse, and attached only to matching order/capture evidence. A conflicting replay or tampered stored receipt fails closed.

## Evidence model

Browser claim → PayPal sandbox order/capture readback → optional verified webhook receipt → deterministic reconciliation → SHA-256 sealed flight record → optional bounded AI evidence analysis.

A completed capture can support the narrowly scoped payment-completed assertion. A verified adverse webhook can force divergence. A missing webhook receipt is never silently treated as payment failure, and webhook API history is never mislabeled as proof that CFR itself received a signed webhook message.

## Boundaries

- Sandbox only; no real money.
- Local single-user prototype; not hardened for production or public multi-user hosting.
- One purchase unit and one full capture in the current demo scope.
- Point-in-time evidence is not a guarantee against future refunds, disputes, reversals, or non-payment fulfillment risks.
- The explicit structured assertion is the current verification contract; AI does not extract or redefine payment authority from free text.
- Hash chaining detects local record modification when the prior chain is intact; it is not a blockchain, trusted timestamp service, or external digital notarization.
- Secrets and runtime evidence remain in ignored local files. Raw OAuth credentials are never logged.

## Certification

`npm test` currently runs **61 tests total**: **57 deterministic product/verification tests** plus **4 public replay integrity tests**. Coverage includes successful capture, pending/denied/refunded/reversed states, uncaptured orders, amount and identifier mismatches, duplicate captures, stale/malformed evidence, provider failure, AI routing failure, evidence-chain integrity, sandbox endpoint isolation, webhook signature verification, transaction correlation, duplicate webhook redelivery, replay conflict, persisted-webhook tampering, unrelated-event isolation, bounded AI question routing, rejection of model-authored factual text, deterministic separation of webhook evidence from fulfillment, and credential-safe replay fixtures.

Separate sandbox canaries have also proven an actual transaction-bound PayPal `PAYMENT.CAPTURE.COMPLETED` webhook message can be received, verified, persisted, correlated to the exact order/capture, and reconciled through the normal product path.

## Sources

- PayPal Orders v2: https://developer.paypal.com/api/orders/v2
- PayPal Payments v2: https://developer.paypal.com/api/payments/v2
- PayPal Webhooks: https://developer.paypal.com/api/rest/webhooks/rest/
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- PayPal AI Hackathon: https://paypalaihackathon.devpost.com/

## License

Apache-2.0. See `LICENSE`. No PayPal endorsement is implied.
