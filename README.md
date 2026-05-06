# Telegram Mini App Runbook

## 1) Security setup

1. Rotate the previously exposed bot token in BotFather.
2. Put the new value in `.env`:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_BARISTA_GROUP_ID`
   - `TELEGRAM_MINI_APP_URL`

## 2) Start services

1. Backend API:
   - `npm run start`
2. Frontend mini app:
   - `npm run dev:frontend`

## 3) Configure Telegram webhook

Call backend endpoint:

`POST /api/telegram/set-webhook`

JSON body:

`{ "url": "https://<your-public-api-domain>/api/telegram/webhook" }`

## 4) End-to-end verification

1. In Telegram private chat with the bot, run `/start`.
2. Bot should reply welcome message with **Open Mini App** button.
3. Open mini app, add drink, checkout and complete KHQR payment.
4. In barista group:
   - A paid order message appears with buttons:
     - `Start Preparing`
     - `Done Prepare`
5. Click `Done Prepare`.
6. User should receive ready notification in private chat.

## 5) Reporting verification

- `GET /api/reports/daily-summary`
- `GET /api/reports/orders`
- `GET /api/reports/failures`

Open frontend **Owner dashboard** tab to inspect KPIs, order timeline, and latest event logs.

## Production demo deployment

Recommended demo stack:

- Frontend: Cloudflare Workers/Pages
- Backend: Koyeb Free Node.js service
- Database: Supabase Free or Neon Free Postgres

Backend environment variables for Koyeb:

- `PORT`
- `DATABASE_URL`
- `BAKONG_ACCOUNT_USERNAME`
- `BAKONG_MERCHANT_TOKEN`
- `BAKONG_USE_SIT`
- `MERCHANT_DISPLAY_NAME`
- `MERCHANT_CITY`
- `BAKONG_QR_CURRENCY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BARISTA_GROUP_ID`
- `TELEGRAM_MINI_APP_URL`

Use these Koyeb settings:

- Build command: `npm install`
- Run command: `npm run start`
- Health check path: `/api/health`

After the backend has a public Koyeb URL, set the Telegram webhook:

`POST https://<koyeb-backend-domain>/api/telegram/set-webhook`

JSON body:

`{ "url": "https://<koyeb-backend-domain>/api/telegram/webhook" }`

For the Cloudflare frontend build, set:

- `VITE_API_BASE_URL=https://<koyeb-backend-domain>`
