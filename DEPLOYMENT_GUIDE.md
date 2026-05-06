# Deployment Guide

This project uses three hosted pieces:

- **Frontend mini app:** Cloudflare Workers static assets
- **Backend API:** Render Web Service
- **Database:** Supabase Postgres

## 1) Supabase Database

Create a Supabase project on the Free plan.

Important settings:

- Use the closest region available.
- Save the database password somewhere safe.
- Do not commit the password to GitHub.

Get the connection string:

1. Open Supabase project.
2. Go to **Project Settings -> Database**.
3. Copy the **Transaction pooler** URI.
4. Use port `6543`.

Correct format:

```text
postgresql://postgres.xxxxx:PASSWORD@aws-...pooler.supabase.com:6543/postgres
```

Avoid the direct IPv6 URL on port `5432`; Render Free may fail with `ENETUNREACH`.

If the password has special characters such as `@`, `&`, `#`, `/`, use a simpler password with only letters and numbers, or URL-encode it.

## 2) Render Backend

Create a Render **Web Service** from GitHub:

```text
kornsokheng/smart-digi-emanu-project
```

Use these settings:

```text
Runtime: Node
Branch: main
Root Directory: empty
Build Command: npm install
Start Command: npm run start
Health Check Path: /api/health
Instance Type: Free
```

Environment variables:

```text
DATABASE_URL=<Supabase transaction pooler URL>
DATABASE_SSL=true
NODE_ENV=production
BAKONG_ACCOUNT_USERNAME=sokheng_korn@bkrt
BAKONG_MERCHANT_TOKEN=<Bakong token>
BAKONG_USE_SIT=false
MERCHANT_DISPLAY_NAME=Lumho
MERCHANT_CITY=Phnom Penh
BAKONG_QR_CURRENCY=KHR
TELEGRAM_BOT_TOKEN=<Telegram bot token>
TELEGRAM_BARISTA_GROUP_ID=<Telegram group id>
TELEGRAM_MINI_APP_URL=https://smart-digi-menu.kornsokheng2.workers.dev
```

Do not set `BAKONG_API_BASE_URL` unless you know it is correct.

After deploy, test:

```text
https://smart-digi-emanu-project.onrender.com/api/health
https://smart-digi-emanu-project.onrender.com/api/health/db
```

Expected:

```json
{ "ok": true }
```

```json
{ "ok": true, "engine": "postgres" }
```

## 3) Cloudflare Frontend

Before deploying Cloudflare, build the frontend with the Render API URL:

```powershell
$env:VITE_API_BASE_URL='https://smart-digi-emanu-project.onrender.com'
npm run build --prefix frontend
Remove-Item Env:\VITE_API_BASE_URL
npm run deploy
```

Cloudflare URL:

```text
https://smart-digi-menu.kornsokheng2.workers.dev
```

## 4) Telegram Webhook

Set Telegram webhook to Render, not localhost and not a temporary tunnel:

```powershell
$token = '<TELEGRAM_BOT_TOKEN>'
Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -ContentType "application/json" `
  -Body '{"url":"https://smart-digi-emanu-project.onrender.com/api/telegram/webhook"}'
```

Check webhook:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$token/getWebhookInfo" `
  -ContentType "application/json" `
  -Body '{}'
```

Expected:

```text
url = https://smart-digi-emanu-project.onrender.com/api/telegram/webhook
last_error_message = empty
```

## 5) Final Test

1. Send `/start` to the Telegram bot.
2. Open the mini app.
3. Add an item.
4. Generate KHQR.
5. Pay with bank app.
6. Return to Telegram mini app.
7. Wait for payment success.
8. Check barista group receives order.

Reports:

```text
https://smart-digi-emanu-project.onrender.com/api/reports/orders?limit=5
https://smart-digi-emanu-project.onrender.com/api/reports/daily-summary
```

## Important Notes

- Render Free sleeps after inactivity. First request can be slow.
- Keep secrets only in Render or local `.env`, never GitHub.
- Use Supabase pooler port `6543`, not direct database port `5432`.
- If payment works locally but not Render, compare Render env vars with `.env`.
- After changing backend code, push to GitHub and deploy latest commit on Render.
- After changing frontend code or API URL, rebuild with `VITE_API_BASE_URL` and run `npm run deploy`.
- After changing `TELEGRAM_MINI_APP_URL`, redeploy/restart backend and send `/start` again. Old Telegram buttons keep old URLs.
