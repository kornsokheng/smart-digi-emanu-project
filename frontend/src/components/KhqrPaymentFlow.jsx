import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/paymentApi";

const POLL_MS = 2000;
const PAYMENT_CHECK_GRACE_MS = 2 * 60 * 1000;

function formatAmount(currency, amount) {
    if (currency === "USD") {
        return `$${Number(amount).toFixed(2)}`;
    }
    const n = Math.round(Number(amount));
    return `${n.toLocaleString()} ៛`;
}

function currencyCenterSymbol(currency) {
    return currency === "USD" ? "$" : "៛";
}

export function KhqrPaymentFlow() {
    const [userId, setUserId] = useState("demo-user-1");
    const [qrPayload, setQrPayload] = useState(null);
    const [orderId, setOrderId] = useState(null);
    const [md5, setMd5] = useState(null);
    const [expiresAtMs, setExpiresAtMs] = useState(null);
    const [statusMessage, setStatusMessage] = useState("");
    const [error, setError] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [payMeta, setPayMeta] = useState(null);
    const [merchantLabel, setMerchantLabel] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const intervalRef = useRef(null);

    const clearPoll = useCallback(() => {
        if (intervalRef.current != null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const handleExpired = useCallback(() => {
        clearPoll();
        setQrPayload(null);
        setOrderId(null);
        setMd5(null);
        setExpiresAtMs(null);
        setPayMeta(null);
        setMerchantLabel(null);
        setStatusMessage(
            "This payment QR has expired. Generate a new code to continue."
        );
    }, [clearPoll]);

    const checkPaymentOnce = useCallback(async () => {
        if (!userId.trim()) return;
        if (
            expiresAtMs != null &&
            Date.now() >= expiresAtMs + PAYMENT_CHECK_GRACE_MS
        ) {
            handleExpired();
            return;
        }
        try {
            const res = await api("/api/payment/check", {
                method: "POST",
                body: JSON.stringify({ userId: userId.trim(), orderId }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    clearPoll();
                    setConfirmed(true);
                    setStatusMessage(data.message || "Payment confirmed");
                }
                return;
            }
            if (res.status === 404) {
                return;
            }
            const errBody = await res.json().catch(() => ({}));
            setError(errBody.error || `Check failed (${res.status})`);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Network error");
        }
    }, [userId, orderId, expiresAtMs, clearPoll, handleExpired]);

    useEffect(() => {
        return () => clearPoll();
    }, [clearPoll]);

    useEffect(() => {
        if (!qrPayload || confirmed || expiresAtMs == null) return;

        const id = window.setInterval(() => {
            const t = Date.now();
            if (t >= expiresAtMs + PAYMENT_CHECK_GRACE_MS) {
                handleExpired();
                return;
            }
            setNowMs(Date.now());
        }, 1000);
        return () => clearInterval(id);
    }, [qrPayload, confirmed, expiresAtMs, handleExpired]);

    const startPolling = useCallback(() => {
        clearPoll();
        intervalRef.current = window.setInterval(() => {
            void checkPaymentOnce();
        }, POLL_MS);
    }, [clearPoll, checkPaymentOnce]);

    const generateQr = async () => {
        setError("");
        setConfirmed(false);
        setStatusMessage("");
        clearPoll();
        if (!userId.trim()) {
            setError("Enter a user ID");
            return;
        }
        try {
            const res = await api("/api/payment/generate", {
                method: "POST",
                body: JSON.stringify({ userId: userId.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || `Generate failed (${res.status})`);
                return;
            }
            setQrPayload(data.qr);
            setOrderId(data.orderId ?? null);
            setMd5(data.md5 ?? null);
            setMerchantLabel(
                typeof data.merchantName === "string" && data.merchantName
                    ? data.merchantName
                    : "Merchant"
            );
            if (data.currency != null && data.amount != null) {
                setPayMeta({ currency: data.currency, amount: data.amount });
            } else {
                setPayMeta(null);
            }
            const exp = data.expiresAt ? Date.parse(data.expiresAt) : null;
            setExpiresAtMs(Number.isFinite(exp) ? exp : null);
            setNowMs(Date.now());
            setStatusMessage("Scan the code with your Bakong app to pay.");
            startPolling();
            void checkPaymentOnce();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Network error");
        }
    };

    const secondsLeft =
        expiresAtMs != null && qrPayload && !confirmed
            ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000))
            : 0;

    const md5Short =
        md5 && md5.length > 18 ? `${md5.slice(0, 18)}…` : md5 || "";

    return (
        <div className="khqr-flow">
            <h1>Bakong KHQR payment</h1>
            <label className="field">
                <span>User ID</span>
                <input
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    disabled={!!qrPayload && !confirmed}
                    autoComplete="off"
                />
            </label>
            <div className="actions">
                <button type="button" onClick={generateQr} disabled={confirmed}>
                    Generate QR
                </button>
                {(qrPayload || confirmed) && (
                    <button
                        type="button"
                        onClick={() => {
                            clearPoll();
                            setQrPayload(null);
                            setOrderId(null);
                            setMd5(null);
                            setExpiresAtMs(null);
                            setConfirmed(false);
                            setStatusMessage("");
                            setError("");
                            setPayMeta(null);
                            setMerchantLabel(null);
                        }}
                    >
                        Reset
                    </button>
                )}
            </div>
            {error ? <p className="error">{error}</p> : null}
            {confirmed ? (
                <p className="success">{statusMessage}</p>
            ) : statusMessage ? (
                <p className="info">{statusMessage}</p>
            ) : null}
            {qrPayload && !confirmed ? (
                <article className="khqr-card" aria-label="KHQR payment request">
                    <header className="khqr-card-header">KHQR</header>
                    <div className="khqr-card-body">
                        <p className="khqr-card-merchant">
                            {merchantLabel || "Merchant"}
                        </p>
                        {payMeta ? (
                            <p className="khqr-card-amount">
                                {formatAmount(
                                    payMeta.currency,
                                    payMeta.amount
                                )}
                            </p>
                        ) : null}
                        <div className="khqr-countdown" role="timer" aria-live="polite">
                            <span className="khqr-countdown-value">
                                {secondsLeft}s
                            </span>
                            <span className="khqr-countdown-label">
                                until QR expires
                            </span>
                        </div>
                        <div className="khqr-card-rule" aria-hidden />
                        <div className="khqr-qr-wrap">
                            <QRCodeSVG value={qrPayload} size={220} level="M" />
                            <div
                                className="khqr-qr-badge"
                                aria-hidden="true"
                                title={payMeta?.currency || ""}
                            >
                                {payMeta
                                    ? currencyCenterSymbol(payMeta.currency)
                                    : "៛"}
                            </div>
                        </div>
                        {md5 ? (
                            <p className="khqr-card-mds" title={md5}>
                                MDS: {md5Short}
                            </p>
                        ) : null}
                    </div>
                </article>
            ) : null}
        </div>
    );
}
