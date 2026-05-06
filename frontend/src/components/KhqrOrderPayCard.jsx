import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/paymentApi";

const POLL_MS = 1000;
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

/**
 * KHQR card + polling for a fixed cart amount (e-menu checkout).
 */
export function KhqrOrderPayCard({
    userId,
    amount,
    currency = "KHR",
    onPaid,
    onBack,
    onPaidContinue,
}) {
    const [qrPayload, setQrPayload] = useState(null);
    const [orderId, setOrderId] = useState(null);
    const [md5, setMd5] = useState(null);
    const [expiresAtMs, setExpiresAtMs] = useState(null);
    const [error, setError] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [checking, setChecking] = useState(false);
    const [payMeta, setPayMeta] = useState(null);
    const [merchantLabel, setMerchantLabel] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const intervalRef = useRef(null);
    const checkRef = useRef(async () => {});

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
        setError("QR expired. Go back and checkout again.");
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
            setChecking(true);
            const res = await api("/api/payment/check", {
                method: "POST",
                body: JSON.stringify({ userId: userId.trim(), orderId }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    clearPoll();
                    setConfirmed(true);
                    onPaid?.();
                }
                return;
            }
            if (res.status === 404) return;
            const errBody = await res.json().catch(() => ({}));
            setError(errBody.error || `Check failed (${res.status})`);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Network error");
        } finally {
            setChecking(false);
        }
    }, [userId, orderId, expiresAtMs, clearPoll, handleExpired, onPaid]);

    useEffect(() => {
        checkRef.current = checkPaymentOnce;
    }, [checkPaymentOnce]);

    useEffect(() => {
        return () => clearPoll();
    }, [clearPoll]);

    useEffect(() => {
        if (!qrPayload || confirmed) return;
        const checkOnReturn = () => {
            if (document.visibilityState === "visible") {
                void checkRef.current();
            }
        };
        document.addEventListener("visibilitychange", checkOnReturn);
        window.addEventListener("focus", checkOnReturn);
        return () => {
            document.removeEventListener("visibilitychange", checkOnReturn);
            window.removeEventListener("focus", checkOnReturn);
        };
    }, [qrPayload, confirmed]);

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
            void checkRef.current();
        }, POLL_MS);
    }, [clearPoll]);

    useEffect(() => {
        let cancelled = false;
        clearPoll();

        async function initialGenerate() {
            setError("");
            setConfirmed(false);
            setQrPayload(null);
            setOrderId(null);
            setMd5(null);
            setExpiresAtMs(null);
            setPayMeta(null);
            setMerchantLabel(null);

            if (!userId?.trim() || amount == null || !Number.isFinite(Number(amount))) {
                setError("Missing order total or user");
                return;
            }

            try {
                const res = await api("/api/payment/generate", {
                    method: "POST",
                    body: JSON.stringify({
                        userId: userId.trim(),
                        amount: Number(amount),
                        currency,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;
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
                }
                const exp = data.expiresAt ? Date.parse(data.expiresAt) : null;
                setExpiresAtMs(Number.isFinite(exp) ? exp : null);
                setNowMs(Date.now());
                startPolling();
                void checkRef.current();
            } catch (e) {
                if (!cancelled) {
                    setError(
                        e instanceof Error ? e.message : "Network error"
                    );
                }
            }
        }

        void initialGenerate();
        return () => {
            cancelled = true;
            clearPoll();
        };
    }, [userId, amount, currency, clearPoll, startPolling]);

    const retryGenerate = useCallback(async () => {
        setError("");
        setQrPayload(null);
        setOrderId(null);
        setMd5(null);
        setExpiresAtMs(null);
        setPayMeta(null);
        setMerchantLabel(null);
        clearPoll();
        try {
            const res = await api("/api/payment/generate", {
                method: "POST",
                body: JSON.stringify({
                    userId: userId.trim(),
                    amount: Number(amount),
                    currency,
                }),
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
            }
            const exp = data.expiresAt ? Date.parse(data.expiresAt) : null;
            setExpiresAtMs(Number.isFinite(exp) ? exp : null);
            setNowMs(Date.now());
            startPolling();
            void checkRef.current();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Network error");
        }
    }, [userId, amount, currency, clearPoll, startPolling]);

    const secondsLeft =
        expiresAtMs != null && qrPayload && !confirmed
            ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000))
            : 0;

    const md5Short =
        md5 && md5.length > 18 ? `${md5.slice(0, 18)}…` : md5 || "";

    if (confirmed) {
        return (
            <div className="lumho-pay-done">
                <div className="lumho-pay-done-icon" aria-hidden>
                    ✓
                </div>
                <h2 className="lumho-pay-done-title">ទទួលបានការទូទាត់!</h2>
                <p className="lumho-pay-done-sub">Payment received. Thank you.</p>
                <button
                    type="button"
                    className="lumho-btn lumho-btn-primary"
                    onClick={onPaidContinue ?? onBack}
                >
                    បន្តការកម្មង់ / Order more
                </button>
            </div>
        );
    }

    return (
        <div className="lumho-pay-screen">
            <div className="lumho-pay-toolbar">
                <button type="button" className="lumho-btn lumho-btn-ghost" onClick={onBack}>
                    ← Back
                </button>
                <span className="lumho-pay-toolbar-title">Scan to pay</span>
            </div>
            {error ? <p className="lumho-error">{error}</p> : null}
            {checking && !error ? (
                <p className="lumho-muted">Checking payment status...</p>
            ) : null}
            {qrPayload ? (
                <article className="khqr-card lumho-khqr-card" aria-label="KHQR payment">
                    <header className="khqr-card-header">KHQR</header>
                    <div className="khqr-card-body">
                        <p className="khqr-card-merchant">
                            {merchantLabel || "Merchant"}
                        </p>
                        {payMeta ? (
                            <p className="khqr-card-amount">
                                {formatAmount(payMeta.currency, payMeta.amount)}
                            </p>
                        ) : null}
                        <div className="khqr-countdown" role="timer" aria-live="polite">
                            <span className="khqr-countdown-value">{secondsLeft}s</span>
                            <span className="khqr-countdown-label">until QR expires</span>
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
            ) : !error ? (
                <p className="lumho-muted">Creating payment QR…</p>
            ) : (
                <button
                    type="button"
                    className="lumho-btn lumho-btn-primary"
                    onClick={() => void retryGenerate()}
                >
                    Retry
                </button>
            )}
        </div>
    );
}
