const {
    appendOrderEvent,
    getFailureReport,
    getOrderItems,
    getOrderEvents,
    getTelegramUser,
    getDailySummary,
    listOrders,
    upsertOrderDraft,
    upsertTelegramUser,
} = require("../db");

function normalizeOrderItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => ({
            name: String(item?.name || "Item"),
            qty: Math.max(1, Number(item?.qty || 1)),
            unitPrice: Number(item?.unitPrice ?? item?.price ?? 0),
            options: item?.options ?? (item?.sugar ? { note: item.sugar } : null),
        }))
        .filter((item) => Number.isFinite(item.unitPrice));
}

function createOrderDraft(req, res) {
    const userId = String(req.body?.userId || "").trim();
    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }
    const items = normalizeOrderItems(req.body?.items);
    const totalAmount = Number(req.body?.totalAmount || 0);
    const currency = String(req.body?.currency || "KHR").toUpperCase();
    const customerName = req.body?.customerName ? String(req.body.customerName) : null;
    const customerUsername = req.body?.customerUsername
        ? String(req.body.customerUsername)
        : null;
    const telegramUser = req.body?.telegramUser || null;

    if (telegramUser?.id != null) {
        upsertTelegramUser({
            userId: String(telegramUser.id),
            chatId: String(telegramUser.id),
            username: telegramUser.username || null,
            firstName: telegramUser.first_name || null,
            lastName: telegramUser.last_name || null,
        });
    } else {
        const existing = getTelegramUser(userId);
        if (!existing) {
            upsertTelegramUser({
                userId,
                chatId: userId,
                username: customerUsername,
                firstName: customerName,
                lastName: null,
            });
        }
    }

    upsertOrderDraft(userId, {
        userId,
        items,
        totalAmount,
        currency,
        customerName,
        customerUsername,
        telegramChatId: telegramUser?.id ? String(telegramUser.id) : userId,
        initData: req.body?.initData || null,
    });

    return res.json({ success: true, itemCount: items.length });
}

function getOrdersReport(req, res) {
    const fromMs = req.query.from ? Date.parse(String(req.query.from)) : undefined;
    const toMs = req.query.to ? Date.parse(String(req.query.to)) : undefined;
    const rows = listOrders({
        status: req.query.status ? String(req.query.status) : undefined,
        prepareStatus: req.query.prepareStatus
            ? String(req.query.prepareStatus)
            : undefined,
        userId: req.query.userId ? String(req.query.userId) : undefined,
        fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
        toMs: Number.isFinite(toMs) ? toMs : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 300,
    }).map((o) => ({
        ...o,
        items: getOrderItems(o.id),
        events: getOrderEvents(o.id),
    }));
    res.json({ orders: rows });
}

function getDailySummaryReport(req, res) {
    const now = Date.now();
    const fromMs = req.query.from
        ? Date.parse(String(req.query.from))
        : now - 24 * 60 * 60 * 1000;
    const toMs = req.query.to ? Date.parse(String(req.query.to)) : now;
    const summary = getDailySummary(
        Number.isFinite(fromMs) ? fromMs : now - 24 * 60 * 60 * 1000,
        Number.isFinite(toMs) ? toMs : now
    );
    res.json({ summary });
}

function getFailuresReport(req, res) {
    const now = Date.now();
    const fromMs = req.query.from
        ? Date.parse(String(req.query.from))
        : now - 24 * 60 * 60 * 1000;
    const toMs = req.query.to ? Date.parse(String(req.query.to)) : now;
    const failures = getFailureReport(
        Number.isFinite(fromMs) ? fromMs : now - 24 * 60 * 60 * 1000,
        Number.isFinite(toMs) ? toMs : now
    );
    res.json({ failures });
}

module.exports = {
    createOrderDraft,
    getOrdersReport,
    getDailySummaryReport,
    getFailuresReport,
};

