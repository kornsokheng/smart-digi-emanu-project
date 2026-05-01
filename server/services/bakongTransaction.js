const axios = require("axios");

const DEFAULT_PROD = "https://api-bakong.nbc.gov.kh";
const DEFAULT_SIT = "https://sit-api-bakong.nbc.gov.kh";

function checkTransactionUrl(base) {
    return `${String(base).replace(/\/$/, "")}/v1/check_transaction_by_md5`;
}

/**
 * POST /v1/check_transaction_by_md5 with Bearer token (NBC Bakong Open API).
 */
async function checkTransactionByMd5(md5, token, options = {}) {
    const base =
        options.baseUrl ||
        (options.useSit ? DEFAULT_SIT : DEFAULT_PROD);
    const url = checkTransactionUrl(base);
    const axiosResponse = await axios.post(url, { md5 }, {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        timeout: 30000,
        validateStatus: () => true,
    });
    return { httpStatus: axiosResponse.status, body: axiosResponse.data };
}

function isExplicitPending(body) {
    const d = body?.data;
    if (!d || typeof d !== "object") return false;
    const s = String(
        d.status || d.paymentStatus || d.transactionStatus || ""
    ).toUpperCase();
    if (s === "PENDING" || s === "UNPAID") return true;
    if (d.paid === false) return true;
    return false;
}

/**
 * Treat NBC-style success + paid indicators as settled (see Bakong Open API docs).
 */
function isPaidSuccess(body) {
    if (!body || typeof body !== "object") return false;
    const rc = body.responseCode;
    if (rc !== 0 && rc !== "0") return false;
    const d = body.data;
    if (d == null) return false;
    if (isExplicitPending(body)) return false;

    const status = String(
        d.status || d.paymentStatus || d.transactionStatus || ""
    ).toUpperCase();
    if (status === "PAID" || status === "SUCCESS" || status === "COMPLETED") {
        return true;
    }
    if (d.paid === true || d.received === true) return true;

    const msg = String(body.responseMessage || "").toLowerCase();
    if (
        msg.includes("success") &&
        d.amount != null &&
        status !== "PENDING"
    ) {
        return true;
    }
    return false;
}

module.exports = {
    checkTransactionByMd5,
    isPaidSuccess,
    isExplicitPending,
    DEFAULT_PROD,
    DEFAULT_SIT,
};
