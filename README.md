# Commerce Flight Recorder

Prove what actually happened after an AI agent says a payment succeeded.

**Work in progress — PayPal AI Hackathon entry. Sandbox only.**

An agent reports that a customer payment succeeded. A business needs independent evidence before shipping. Commerce Flight Recorder checks PayPal Orders v2 and Payments v2, compares the claimed order, amount and currency to an independently retrieved capture, and records CONFIRMED, DIVERGENCE or INCOMPLETE.

## Run locally

Requires Node.js 22 or newer. No npm dependencies.

```sh
git clone https://github.com/michaelhuntertv7-ops/commerce-flight-recorder.git
cd commerce-flight-recorder
cp .env.example .env
# Fill in sandbox credentials locally. Never commit .env.
npm test
npm start
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred. Open http://127.0.0.1:4317 in your browser.

## PayPal configuration

Create a Merchant app in the PayPal Developer **Sandbox** dashboard. Put its client ID and secret in `.env`. The API origin is hard-coded to `https://api-m.sandbox.paypal.com`; production endpoints are not configurable. Use the developer dashboard's personal sandbox account for buyer approval. Never enter real payment details in this demo.

## Demonstration

1. Create the fixed $10 USD sandbox order with the demo control.
2. Leave it uncaptured. Verify the default agent claim. PayPal's actual state yields DIVERGENCE and HOLD FULFILLMENT.
3. Open the sandbox approval link and sign in as a sandbox buyer. Approve the test payment.
4. Capture using the separate demo control. Run verification again. A matching full capture yields CONFIRMED.
5. Optionally generate a local AI explanation and export the Flight Record JSON.

Create/capture use stable request IDs saved in ignored `data/session.json`. The existing demo order is reused after restart. Verification itself only reads PayPal state. To deliberately begin another demo, stop the app and move `data/session.json` to a private backup before restarting. Preserve previous records.

## AI integration

Install Ollama from its official site and run `ollama pull llama3.2:3b` if the model is not already installed. Keep Ollama running locally at port 11434. The local Llama 3.2 3B model summarizes only the deterministic result and selected evidence; it has no tools or credentials. Its response is explicitly advisory. AI failure returns the deterministic explanation and cannot change the verdict. Model weights have their own license and are not distributed here.

## Architecture

Browser claim → local server → PayPal Orders API → independent Payments capture lookup → deterministic reconciliation → SHA-256 Flight Record → optional local AI explanation.

PayPal event notifications are queried by capture ID and correlated to the order. API retrieval is **not webhook delivery proof**. This version does not operate a signed webhook receiver and always reports delivery as not observed. Missing events do not imply payment failure. A current direct order/capture match can confirm the narrowly scoped payment assertion without claiming webhook delivery.

## Boundaries and limitations

- Local prototype, bound to 127.0.0.1; not hardened for public multi-user hosting.
- One purchase unit, one full capture; multiple captures require review.
- Evidence is a point-in-time observation, not a guarantee against later refunds, disputes or reversals.
- Agent text is retained; the explicit structured assertion is the verification contract. Natural-language claim extraction is not implemented.
- Hash chaining helps detect modification if a trusted prior hash is retained. It is not a digital signature, trusted timestamp or tamper-proof ledger.
- Secrets and runtime evidence stay in ignored local files. Provider errors are reduced to safe error codes; no raw OAuth payloads are logged.
- Host and Origin checks restrict local API use. Never expose this development server through a public tunnel.
- AI explanations can be inaccurate; the deterministic verdict and underlying evidence remain authoritative.

## Tests

`npm test` runs deterministic unit tests for matching states, pending/denied/refunded states, uncaptured orders, amount/identifier mismatch, duplicate captures, missing and stale evidence, malformed claims, provider and AI failure, integrity checks and sandbox endpoint isolation. Live sandbox checks are separate from fixture-based unit tests.

## Sources

- https://developer.paypal.com/api/orders/v2
- https://developer.paypal.com/api/payments/v2
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://github.com/ollama/ollama/blob/main/docs/api.md
- https://paypalaihackathon.devpost.com/

## License

Apache-2.0. See LICENSE. No PayPal endorsement is implied.
