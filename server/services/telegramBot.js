const {
    appendOrderEvent,
    getOrderById,
    getOrderItems,
    getTelegramUser,
    markOrderPreparing,
    markOrderReady,
    upsertTelegramUser,
} = require("../db");

function isEnabled() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function getConfig() {
    return {
        token: process.env.TELEGRAM_BOT_TOKEN,
        miniAppUrl: process.env.TELEGRAM_MINI_APP_URL || "http://localhost:5173",
        baristaGroupId: process.env.TELEGRAM_BARISTA_GROUP_ID,
    };
}

async function telegramApi(method, payload) {
    const { token } = getConfig();
    if (!token) return { ok: false, skipped: true };
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok, body };
}

async function setWebhook(webhookUrl) {
    if (!webhookUrl) {
        return { ok: false, body: { error: "webhookUrl is required" } };
    }
    return telegramApi("setWebhook", { url: webhookUrl });
}

function formatMoney(order) {
    if (!order) return "";
    if (order.currency === "KHR") return `${Math.round(Number(order.amount || 0))}៛`;
    return `$${Number(order.amount || 0).toFixed(2)}`;
}

function formatOrderLines(order, items) {
    const lines = [
        `Order #${order.id}`,
        `Customer: ${order.customer_name || order.user_id}`,
        `Amount: ${formatMoney(order)}`,
        `Status: ${order.status} / ${order.prepare_status || "pending_prepare"}`,
    ];
    if (items?.length) {
        lines.push("");
        lines.push("Items:");
        for (const item of items) {
            lines.push(`- ${item.name} x${item.qty} (${Math.round(Number(item.unit_price || 0))}៛)`);
        }
    }
    return lines.join("\n");
}

async function sendWelcome(chatId) {
    const { miniAppUrl } = getConfig();
    return telegramApi("sendMessage", {
        chat_id: chatId,
        text: "Welcome to Lumho cafe. Tap below to open mini app and order.",
        reply_markup: {
            inline_keyboard: [
                [{ text: "Open Mini App", web_app: { url: miniAppUrl } }],
            ],
        },
    });
}

async function sendOrderToBaristaGroup(orderId) {
    const { baristaGroupId } = getConfig();
    if (!baristaGroupId) return;
    const order = await getOrderById(orderId);
    if (!order) return;
    const items = await getOrderItems(orderId);
    const text = `New paid order received\n\n${formatOrderLines(order, items)}`;
    const res = await telegramApi("sendMessage", {
        chat_id: baristaGroupId,
        text,
        reply_markup: {
            inline_keyboard: [
                [{ text: "Start Preparing", callback_data: `PREPARING:${orderId}` }],
                [{ text: "Done Prepare", callback_data: `READY:${orderId}` }],
            ],
        },
    });
    await appendOrderEvent(orderId, "barista_group_alert", { ok: res.ok });
}

async function notifyUserPayment(orderId) {
    const order = await getOrderById(orderId);
    if (!order) return;
    const map = await getTelegramUser(order.user_id);
    const chatId = order.telegram_chat_id || map?.chat_id;
    if (!chatId) return;
    const items = await getOrderItems(orderId);
    const text = `Payment confirmed.\n\n${formatOrderLines(order, items)}\n\nWe are preparing your order.`;
    const res = await telegramApi("sendMessage", { chat_id: chatId, text });
    await appendOrderEvent(orderId, "user_payment_notified", { ok: res.ok });
}

async function notifyUserReady(orderId) {
    const order = await getOrderById(orderId);
    if (!order) return;
    const map = await getTelegramUser(order.user_id);
    const chatId = order.telegram_chat_id || map?.chat_id;
    if (!chatId) return;
    const text = `Order #${order.id} is ready. Please collect your drink.`;
    const res = await telegramApi("sendMessage", { chat_id: chatId, text });
    await appendOrderEvent(orderId, "user_ready_notified", { ok: res.ok });
}

async function answerCallback(callbackQueryId, text) {
    return telegramApi("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
    });
}

async function handleTelegramUpdate(update) {
    if (!isEnabled()) return;
    const msg = update?.message;
    if (msg?.text?.startsWith("/start")) {
        const userId = String(msg.from?.id || "");
        if (userId) {
            await upsertTelegramUser({
                userId,
                chatId: String(msg.chat?.id || userId),
                username: msg.from?.username || null,
                firstName: msg.from?.first_name || null,
                lastName: msg.from?.last_name || null,
            });
        }
        await sendWelcome(String(msg.chat?.id));
        return;
    }

    const cq = update?.callback_query;
    if (!cq?.data) return;
    const [action, orderIdRaw] = String(cq.data).split(":");
    const orderId = Number(orderIdRaw);
    if (!Number.isFinite(orderId)) {
        await answerCallback(cq.id, "Invalid order");
        return;
    }
    if (action === "PREPARING") {
        const changed = await markOrderPreparing(orderId);
        await appendOrderEvent(orderId, "barista_preparing_click", {
            by: cq.from?.id,
            changed,
        });
        await answerCallback(cq.id, changed ? "Marked preparing" : "Already preparing/ready");
        return;
    }
    if (action === "READY") {
        const changed = await markOrderReady(orderId);
        await appendOrderEvent(orderId, "barista_ready_click", {
            by: cq.from?.id,
            changed,
        });
        await answerCallback(cq.id, changed ? "Marked ready" : "Already ready");
        if (changed) {
            await notifyUserReady(orderId);
        }
    }
}

module.exports = {
    isEnabled,
    setWebhook,
    sendOrderToBaristaGroup,
    notifyUserPayment,
    handleTelegramUpdate,
};
