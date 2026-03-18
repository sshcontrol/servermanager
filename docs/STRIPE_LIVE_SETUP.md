# Stripe Live Mode Setup Guide

When switching from Stripe **test keys** to **live keys**, several configuration steps are required. Test and live modes use separate credentials and webhooks.

## Checklist for Going Live

### 1. Webhook Secret (Most Common Issue)

**Test and live webhooks use different signing secrets.** Using the test webhook secret with live events causes signature verification to fail (HTTP 400).

**Steps:**

1. In [Stripe Dashboard](https://dashboard.stripe.com), switch to **Live mode** (toggle in top-right).
2. Go to **Developers → Webhooks**.
3. Click **Add endpoint**.
4. **Endpoint URL:** `https://your-production-domain.com/api/webhooks/stripe`
   - Must be HTTPS.
   - Must be publicly reachable by Stripe.
5. **Events to send:** Select:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. Click **Add endpoint**.
7. Click **Reveal** under **Signing secret** and copy the value (starts with `whsec_`).
8. In SSHCONTROL: **Superadmin → Payment** → paste this as **Webhook secret** and save.

### 2. API Keys

1. In Stripe Dashboard (Live mode), go to **Developers → API keys**.
2. Copy **Publishable key** (starts with `pk_live_`) and **Secret key** (starts with `sk_live_`).
3. In SSHCONTROL: **Superadmin → Payment** → save both keys.

### 3. Plan Price IDs (Optional)

If your plans use **Stripe Price ID** (e.g. `price_xxx`):

- Test mode price IDs (`price_1ABC...` from test) **do not exist** in live mode.
- Create products and prices in **Live mode** (Stripe Dashboard → Products).
- Update each plan in **Superadmin → Plans** with the new live `price_xxx` IDs.

**Alternative:** Leave **Stripe Price ID** empty. The app will use `price_data` (amount from plan) and works with both test and live keys.

### 4. Customer IDs

If tenants have `stripe_customer_id` from test mode, those IDs are invalid with live keys. The app will automatically retry checkout with `customer_email` instead when Stripe rejects the customer. New customers will be created in live mode.

### 5. Verify Webhook Reachability

1. In Stripe Dashboard → Webhooks → your endpoint.
2. Click **Send test webhook**.
3. Check that the request succeeds (green checkmark).
4. If it fails: verify URL, HTTPS, firewall, and that the backend is running.

### 6. Check Backend Logs

If payments fail, check backend logs for:

- `Stripe webhook signature verification failed` → Wrong webhook secret (test vs live).
- `Stripe rejected customer_id` or `Stripe rejected price_id` → App will retry with fallback; if it still fails, check the full error.

## Quick Reference

| Item        | Test Mode              | Live Mode                    |
|------------|------------------------|------------------------------|
| Publishable key | `pk_test_...`     | `pk_live_...`                |
| Secret key      | `sk_test_...`     | `sk_live_...`                |
| Webhook secret  | From test webhook | From live webhook (different) |
| Price IDs       | `price_xxx` (test) | `price_xxx` (live, separate) |
| Customer IDs    | `cus_xxx` (test)  | `cus_xxx` (live, separate)   |

## Troubleshooting

**Checkout fails with "No such customer" or "No such price"**

- Clear `stripe_price_id` on plans (use price_data) or create live prices.
- The app retries with `customer_email` when customer is invalid.

**Webhook returns 400 "Invalid signature"**

- Ensure you created the webhook endpoint in **Live mode** in Stripe Dashboard.
- Use the signing secret from that live webhook, not the test one.

**Payment succeeds on Stripe but plan not updated**

- Webhook may be failing (check Stripe Dashboard → Webhooks → endpoint → recent deliveries).
- The **verify-session** fallback runs when the user lands on the payment result page; if that works, the plan updates. If both fail, check backend logs.
