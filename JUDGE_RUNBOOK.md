# Judge Runbook — Commerce Flight Recorder

This runbook is optimized for the PayPal AI Hackathon judging path. It keeps the product sandbox-only and never requires real funds.

## What the judge should understand in 10 seconds

An AI agent can say a payment succeeded before the merchant has authoritative proof. Commerce Flight Recorder independently checks PayPal state, correlates verified webhook evidence when available, reconciles the facts, and tells the operator whether the payment evidence supports acting.

## Fast local setup

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env`.
3. Add your own PayPal **sandbox** Client ID and Secret to `.env`. Never commit them.
4. Run `npm run judge:check`.
5. Run `npm test`.
6. Run `npm start` and open `http://127.0.0.1:4317`.

The judge preflight prints only PASS/WARN/FAIL states and never prints credential values.

## 2:27 certified demo-film path

The film uses a **judge-safe read-only replay** built from certified PayPal Sandbox observations. The replay performs no live PayPal API call and exposes no payment-write capability. The repository run instructions separately allow judges to reproduce the sandbox path with their own sandbox credentials.

### 0:00–0:16 — Problem and product thesis
Open on the merchant problem and the CFR thesis: agent language is a claim, not proof. Keep the read-only PayPal Sandbox replay badge visible.

### 0:16–0:48.4 — Certified false-success contradiction
Show the sealed `DIVERGENCE` record derived from the earlier real sandbox observation: the agent claims payment completion while PayPal is `PAYER_ACTION_REQUIRED` with **no capture evidence**. CFR recommends a fulfillment hold.

### 0:48.4–1:22 — Separate certified completed-payment case
Switch clearly to the later certified PayPal Sandbox record. Show order `COMPLETED`, independent capture `COMPLETED`, and one verified PayPal-signed `PAYMENT.CAPTURE.COMPLETED` webhook receipt correlated to that payment. Do not imply it is the same order as the divergence case.

### 1:22–1:44 — Bounded AI analyst
Ask: “What payment evidence supports this verdict?” Keep the evidence-backed answer and unchanged deterministic verdict visible. AI interprets the operator question; sealed evidence supplies the factual answer and AI cannot execute payment actions.

### 1:44–2:05 — Merchant impact
Show failure mode → business consequence → CFR intervention. Emphasize goods, access, or downstream work being released on unsupported payment claims.

### 2:05–2:22 — Reliability proof
Show: **57 deterministic product/verification tests + 4 public replay integrity tests = 61/61 total current suite PASS**.

### 2:22–2:27 — Close
End on: **“Don’t ship on a sentence. Ship on evidence.”**

## What is real versus bounded

Real in the demo: PayPal sandbox order creation, approval, capture, authoritative readback, Payments v2 capture lookup, and signed webhook verification when the webhook path is configured.

Bounded by design: fixed sandbox environment, one purchase unit, one full capture, local single-user UI, and local AI evidence navigation. CFR is not presented as a production compliance system or as proof of physical fulfillment.

## If the AI model is unavailable

The payment-verification path remains fully functional. CFR falls back to a deterministic evidence explanation because the AI analyst is not allowed to become payment authority.
