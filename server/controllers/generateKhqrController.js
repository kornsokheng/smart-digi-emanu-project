const { BakongKHQR, khqrData, IndividualInfo } = require("bakong-khqr");
const {
    appendOrderEvent,
    consumeOrderDraft,
    expireOpenOrdersForUser,
    insertOrder,
    replaceOrderItems,
    setOrderCustomerMeta,
} = require("../db");

const FIVE_MIN_MS = 5 * 60 * 1000;

function resolveQrCurrency() {
    const raw = String(process.env.BAKONG_QR_CURRENCY || "USD")
        .trim()
        .toUpperCase();
    if (raw === "KHR" || raw === "116") {
        return { code: "KHR", khqrCurrency: khqrData.currency.khr };
    }
    return { code: "USD", khqrCurrency: khqrData.currency.usd };
}

function resolveRequestCurrency(body) {
    const b = body?.currency;
    if (b != null && String(b).trim() !== "") {
        const u = String(b).trim().toUpperCase();
        if (u === "KHR" || u === "116") {
            return { code: "KHR", khqrCurrency: khqrData.currency.khr };
        }
        if (u === "USD" || u === "840") {
            return { code: "USD", khqrCurrency: khqrData.currency.usd };
        }
        return { error: "currency must be KHR or USD" };
    }
    return resolveQrCurrency();
}

function normalizeAmountForCurrency(amount, currencyCode) {
    if (currencyCode === "KHR") {
        const n = Math.round(Number(amount));
        if (n < 1) {
            return {
                error: "For KHR, amount must be a positive whole number (e.g. 5500)",
            };
        }
        return { amount: n };
    }
    const n = parseFloat(String(amount));
    if (!(n > 0)) {
        return { error: "For USD, amount must be a positive number" };
    }
    return { amount: n };
}

function pickAmount(req, currencyCode) {
    const body = req.body;
    const hasAmount =
        body?.amount != null && body.amount !== "" && body.amount !== undefined;

    if (!hasAmount) {
        const rawAmount =
            process.env.BAKONG_QR_AMOUNT ??
            (currencyCode === "KHR" ? "4100" : "1");
        return normalizeAmountForCurrency(rawAmount, currencyCode);
    }

    const norm = normalizeAmountForCurrency(body.amount, currencyCode);
    if (norm.error) return norm;
    const amt = norm.amount;

    if (currencyCode === "KHR") {
        const max = Number(process.env.MAX_ORDER_AMOUNT_KHR || 5000000);
        const min = Number(process.env.MIN_ORDER_AMOUNT_KHR || 500);
        if (amt < min) {
            return { error: `Amount must be at least ${min} ៛` };
        }
        if (amt > max) {
            return { error: `Amount cannot exceed ${max.toLocaleString()} ៛` };
        }
    } else {
        const max = Number(process.env.MAX_ORDER_AMOUNT_USD || 5000);
        const min = Number(process.env.MIN_ORDER_AMOUNT_USD || 0.5);
        if (amt < min) {
            return { error: `Amount must be at least ${min} USD` };
        }
        if (amt > max) {
            return { error: `Amount cannot exceed ${max} USD` };
        }
    }
    return { amount: amt };
}

function generateKhqr(req, res) {
    const userId = req.body?.userId ?? req.body?.user_id;
    if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "userId is required" });
    }

    const bakongAccount =
        process.env.BAKONG_ACCOUNT_USERNAME || process.env.BAKONG_ACCOUNT_ID;
    if (!bakongAccount) {
        return res.status(500).json({
            error: "Server missing BAKONG_ACCOUNT_USERNAME (Bakong account ID for the QR)",
        });
    }

    const merchantToken = process.env.BAKONG_MERCHANT_TOKEN;
    if (!merchantToken) {
        return res.status(500).json({
            error: "Server missing BAKONG_MERCHANT_TOKEN (JWT for Bakong Open API)",
        });
    }

    const merchantName =
        process.env.MERCHANT_DISPLAY_NAME || "Merchant";
    const merchantCity = process.env.MERCHANT_CITY || "Phnom Penh";

    const cur = resolveRequestCurrency(req.body);
    if (cur.error) {
        return res.status(400).json({ error: cur.error });
    }
    const { code: currencyCode, khqrCurrency } = cur;

    const amountResult = pickAmount(req, currencyCode);
    if (amountResult.error) {
        return res.status(400).json({ error: amountResult.error });
    }
    const amount = amountResult.amount;

    const now = Date.now();
    const expiresAt = now + FIVE_MIN_MS;

    expireOpenOrdersForUser(userId);

    const uidSafe = String(userId).replace(/[^\w-]/g, "").slice(0, 10);
    const billNumber = `${uidSafe || "u"}-${String(now).slice(-10)}`.slice(
        0,
        25
    );

    const optionalData = {
        currency: khqrCurrency,
        amount,
        expirationTimestamp: expiresAt,
        billNumber,
    };

    const individualInfo = new IndividualInfo(
        bakongAccount,
        merchantName,
        merchantCity,
        optionalData
    );

    const khqr = new BakongKHQR();
    const response = khqr.generateIndividual(individualInfo);

    if (response.status?.code !== 0) {
        return res.status(400).json({
            error: response.status?.message || "KHQR generation failed",
            code: response.status?.errorCode,
        });
    }

    const qr = response.data?.qr;
    const md5 = response.data?.md5;
    if (!qr || !md5) {
        return res.status(500).json({ error: "Unexpected KHQR response shape" });
    }

    const orderId = insertOrder({
        user_id: userId,
        qr,
        md5,
        status: "pending",
        currency: currencyCode,
        amount,
        expires_at: expiresAt,
        created_at: now,
    });

    const draft = consumeOrderDraft(userId);
    if (draft) {
        replaceOrderItems(orderId, draft.items || []);
        setOrderCustomerMeta(orderId, {
            customerName: draft.customerName || null,
            customerUsername: draft.customerUsername || null,
            telegramChatId: draft.telegramChatId || null,
        });
        appendOrderEvent(orderId, "order_draft_attached", {
            itemCount: Array.isArray(draft.items) ? draft.items.length : 0,
        });
    } else {
        appendOrderEvent(orderId, "order_created", null);
    }

    return res.json({
        qr,
        md5,
        orderId: Number(orderId),
        userId,
        currency: currencyCode,
        amount,
        merchantName,
        expiresAt: new Date(expiresAt).toISOString(),
    });
}

module.exports = { generateKhqr };
