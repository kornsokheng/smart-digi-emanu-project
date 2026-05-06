const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { checkDbHealth } = require("./db");
const { generateKhqr } = require("./controllers/generateKhqrController");
const { verifyPayment } = require("./controllers/verifyPaymentController");
const {
    createOrderDraft,
    getDailySummaryReport,
    getFailuresReport,
    getOrdersReport,
} = require("./controllers/orderController");
const {
    handleTelegramUpdate,
    isEnabled,
    setWebhook,
} = require("./services/telegramBot");

function validateStartupConfig() {
    if (process.env.NODE_ENV === "production" && isEnabled()) {
        if (!process.env.TELEGRAM_BARISTA_GROUP_ID) {
            throw new Error(
                "TELEGRAM_BARISTA_GROUP_ID is required when Telegram bot is enabled"
            );
        }
        if (!process.env.TELEGRAM_MINI_APP_URL) {
            throw new Error(
                "TELEGRAM_MINI_APP_URL is required when Telegram bot is enabled"
            );
        }
    }
}

function createApp() {
    validateStartupConfig();

    const app = express();
    app.use(cors({ origin: true, credentials: true }));
    app.use(express.json());

    function asyncRoute(handler) {
        return async (req, res, next) => {
            try {
                await handler(req, res, next);
            } catch (err) {
                next(err);
            }
        };
    }

    app.post("/api/payment/generate", asyncRoute(generateKhqr));
    app.post("/api/payment/check", asyncRoute(verifyPayment));
    app.post("/api/orders/create", asyncRoute(createOrderDraft));

    app.post("/api/telegram/webhook", async (req, res) => {
        try {
            await handleTelegramUpdate(req.body);
        } catch (err) {
            console.error("telegram webhook error", err);
        }
        res.json({ ok: true });
    });

    app.post("/api/telegram/set-webhook", asyncRoute(async (req, res) => {
        const webhookUrl = req.body?.url;
        const result = await setWebhook(webhookUrl);
        if (!result.ok) {
            return res.status(400).json(result.body || { ok: false });
        }
        return res.json(result.body);
    }));

    app.get("/api/reports/daily-summary", asyncRoute(getDailySummaryReport));
    app.get("/api/reports/orders", asyncRoute(getOrdersReport));
    app.get("/api/reports/failures", asyncRoute(getFailuresReport));

    app.get("/api/health", (_req, res) => {
        res.json({ ok: true });
    });

    app.get("/api/health/db", asyncRoute(async (_req, res) => {
        res.json(await checkDbHealth());
    }));

    const distDir = path.join(__dirname, "..", "frontend", "dist");
    const distIndex = path.join(distDir, "index.html");
    if (fs.existsSync(distIndex)) {
        app.use(express.static(distDir));
        app.get(/^\/(?!api).*/, (_req, res) => {
            res.sendFile(distIndex);
        });
    }

    app.use((err, _req, res, _next) => {
        console.error("request error", err);
        res.status(500).json({
            ok: false,
            error: "Internal server error",
            message:
                process.env.NODE_ENV === "production"
                    ? undefined
                    : err?.message,
        });
    });

    return app;
}

module.exports = { createApp };
