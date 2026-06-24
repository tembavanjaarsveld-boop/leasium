# Turn on error alerts (Sentry) — click-by-click

**What this does, in plain terms:** right now, if Leasium breaks for you or a
tenant, nobody is told. This switches on error monitoring so you get an email
(and/or Slack message) the moment something goes wrong, with enough detail to
fix it. ~10 minutes, no coding.

You'll touch three websites:
- **Sentry** — the error-watching service (gives you 2 "DSN" codes to copy).
- **Render** — where Leasium's backend runs (you paste 1 code here).
- **Vercel** — where the Leasium website runs (you paste the other code here).

The Leasium code is already built for this — these steps just plug in the codes
and switch it on. **Anything in `<angle brackets>` is a value you paste; type the
rest exactly.**

---

## Part A — Get your codes from Sentry (~3 min)

1. Go to **https://sentry.io** and sign in (or "Get started" to create a free
   account if you don't have one).
2. If asked, create an organisation (name it e.g. `Leasium`).
3. Create **two projects** (top-left "Projects" → "Create Project"):
   - One with platform **Python** → name it `leasium-api`.
   - One with platform **Next.js** → name it `leasium-web`.
   (If these already exist, just open them.)
4. For each project, open **Settings → Client Keys (DSN)** and copy the **DSN**.
   It looks like `https://abc123@o456.ingest.sentry.io/789`.
   - Keep the `leasium-api` DSN and the `leasium-web` DSN side by side — label
     which is which. You'll paste them in Parts B and C.
5. Also create one **Auth Token** for source maps (lets Sentry show readable
   errors): **Settings → Auth Tokens → Create New Token**, give it the
   "project:releases" scope, copy it. Note your **organisation slug** and the
   `leasium-web` **project slug** (they're in the page URLs).

> These DSN/token values are secrets — don't paste them into chat or email.

---

## Part B — Render (backend) (~2 min)

1. Go to **https://dashboard.render.com** and sign in.
2. Open the **Leasium API** service (the web service running the backend).
3. Left menu → **Environment**.
4. Click **Add Environment Variable** and add these two (Key on the left, Value
   on the right), then **Save Changes**:

   | Key | Value |
   |---|---|
   | `SENTRY_DSN` | `<your leasium-api DSN>` |
   | `SENTRY_ENVIRONMENT` | `production` |

5. Saving will **redeploy** the backend automatically. Wait for it to go green
   ("Live").

---

## Part C — Vercel (website) (~3 min)

1. Go to **https://vercel.com** and sign in.
2. Open the **leasium** project → **Settings → Environment Variables**.
3. Add each of these (set the environment to **Production**), then **Save**:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SENTRY_DSN` | `<your leasium-web DSN>` |
   | `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` |
   | `SENTRY_AUTH_TOKEN` | `<the auth token from Part A step 5>` |
   | `SENTRY_ORG` | `<your Sentry org slug>` |
   | `SENTRY_PROJECT` | `leasium-web` |

4. Redeploy the site so the new settings take effect: **Deployments** tab →
   open the latest → **⋯ menu → Redeploy**.

---

## Part D — Prove it works (~1 min)

1. After both redeploys finish, in Sentry open each project → **Issues**.
2. Backend test: visit `https://leasium.ai` and click around for a minute.
3. If you want a guaranteed test event, tell me and I'll add a tiny temporary
   "test error" button to a preview build, we confirm it lands in Sentry, then
   remove it.
4. You should see events appear under **Issues** tagged `environment: production`.
   If they do — monitoring is live. 🎉

---

## Part E — Get notified (alerts) (~2 min)

In Sentry, for **each** project: **Alerts → Create Alert → Issues**:

1. **New issue alert:** "When **a new issue is created**" → send to **your email**
   (and Slack if connected). Name it `New error`.
2. **Spike alert:** "When **number of events** in **1 hour** is **more than 50**"
   → send to email/Slack. Name it `Error spike`.

(To wire Slack: **Settings → Integrations → Slack → Add** once, then pick the
channel in the alert.)

---

## When you're done

Tick off sections 1–2 in `docs/mvp-readiness-punchlist-2026-06-19.md`. That
closes the last leg of Stabilization v2 — the platform will then be clean data
+ CI safety net + live error monitoring.

**Prefer not to do this solo?** Tell me and I'll walk you through it live,
one click at a time — you drive the keyboard for the secret bits, I tell you
exactly what to click and paste at each step.
