const {
    checkTransactionByMd5,
    isPaidSuccess,
} = require("../services/bakongTransaction");
const {
    appendOrderEvent,
    getOrderById,
    getLatestPendingOrderForUser,
    markOrderPaid,
} = require("../db");
const {
    notifyUserPayment,
    sendOrderToBaristaGroup,
} = require("../services/telegramBot");

async function verifyPayment(req, res) {
    const userId = req.body?.userId ?? req.body?.user_id;
    if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "userId is required" });
    }

    const token = process.env.BAKONG_MERCHANT_TOKEN;
    if (!token) {
        return res.status(500).json({ error: "BAKONG_MERCHANT_TOKEN is not configured" });
    }

    const orderId = req.body?.orderId ?? req.body?.order_id;
    const order = orderId
        ? await getOrderById(Number(orderId))
        : await getLatestPendingOrderForUser(userId);
    if (!order) {
        return res.status(404).json({
            error: "No active pending transaction for this user",
            code: "NOT_FOUND_OR_PENDING",
        });
    }
    if (String(order.user_id) !== String(userId)) {
        return res.status(403).json({ error: "Order does not belong to this user" });
    }
    if (order.status === "paid") {
        return res.json({
            success: true,
            message: "Payment confirmed",
            orderId: order.id,
        });
    }
    if (order.status !== "pending") {
        return res.status(404).json({
            error: "No active pending transaction for this user",
            code: "NOT_FOUND_OR_PENDING",
        });
    }

    const baseUrl =
        process.env.BAKONG_USE_SIT === "true"
            ? "https://sit-api-bakong.nbc.gov.kh"
            : process.env.BAKONG_API_BASE_URL ||
              "https://api-bakong.nbc.gov.kh";

    let body;
    try {
        const { httpStatus, body: b } = await checkTransactionByMd5(
            order.md5,
            token,
            { baseUrl }
        );
        body = b;
        if (httpStatus !== 200) {
            return res.status(404).json({
                error: "Unable to confirm payment yet",
                code: "NOT_FOUND_OR_PENDING",
            });
        }
    } catch (err) {
        return res.status(404).json({
            error: "Bakong API unreachable or transaction still pending",
            code: "NOT_FOUND_OR_PENDING",
        });
    }

    if (isPaidSuccess(body)) {
        await markOrderPaid(order.id);
        await appendOrderEvent(order.id, "payment_confirmed", { provider: "bakong" });
        void sendOrderToBaristaGroup(order.id);
        void notifyUserPayment(order.id);
        return res.json({
            success: true,
            message: "Payment confirmed",
            orderId: order.id,
        });
    }

    return res.status(404).json({
        error: "Payment not completed or still pending",
        code: "NOT_FOUND_OR_PENDING",
    });
}

module.exports = { verifyPayment };
