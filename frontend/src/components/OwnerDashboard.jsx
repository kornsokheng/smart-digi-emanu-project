import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/paymentApi";

function fmtMoney(currency, amount) {
    if (currency === "USD") return `$${Number(amount || 0).toFixed(2)}`;
    return `${Math.round(Number(amount || 0)).toLocaleString()}៛`;
}

function fmtDate(ms) {
    if (!ms) return "-";
    return new Date(ms).toLocaleString();
}

export function OwnerDashboard() {
    const [summary, setSummary] = useState(null);
    const [orders, setOrders] = useState([]);
    const [failures, setFailures] = useState([]);
    const [status, setStatus] = useState("Loading report...");

    async function fetchReports() {
        try {
            const [sRes, oRes, fRes] = await Promise.all([
                api("/api/reports/daily-summary"),
                api("/api/reports/orders?limit=120"),
                api("/api/reports/failures"),
            ]);
            const sBody = await sRes.json();
            const oBody = await oRes.json();
            const fBody = await fRes.json();
            setSummary(sBody.summary || {});
            setOrders(Array.isArray(oBody.orders) ? oBody.orders : []);
            setFailures(Array.isArray(fBody.failures) ? fBody.failures : []);
            setStatus("");
        } catch (err) {
            setStatus(err instanceof Error ? err.message : "Failed to load report");
        }
    }

    async function load() {
        setStatus("Loading report...");
        await fetchReports();
    }

    useEffect(() => {
        // Initial load from API for dashboard data.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchReports();
    }, []);

    const readyCount = useMemo(
        () => orders.filter((o) => o.prepare_status === "ready").length,
        [orders]
    );

    return (
        <section className="owner-dashboard">
            <div className="owner-head">
                <h2>Store owner dashboard</h2>
                <button type="button" onClick={() => void load()}>
                    Refresh
                </button>
            </div>
            {status ? <p className="error">{status}</p> : null}
            <div className="owner-kpis">
                <article>
                    <h3>Total Orders</h3>
                    <p>{summary?.total_orders ?? 0}</p>
                </article>
                <article>
                    <h3>Paid Orders</h3>
                    <p>{summary?.paid_orders ?? 0}</p>
                </article>
                <article>
                    <h3>Ready Orders</h3>
                    <p>{readyCount}</p>
                </article>
                <article>
                    <h3>Revenue KHR</h3>
                    <p>{fmtMoney("KHR", summary?.revenue_khr)}</p>
                </article>
            </div>
            <div className="owner-panel">
                <h3>Failure summary</h3>
                {failures.length ? (
                    <ul>
                        {failures.map((f) => (
                            <li key={f.status}>
                                {f.status}: {f.count}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="muted">No recent failures.</p>
                )}
            </div>
            <div className="owner-panel">
                <h3>Order timeline</h3>
                <div className="owner-orders">
                    {orders.map((o) => (
                        <article key={o.id} className="owner-order-row">
                            <div>
                                <strong>#{o.id}</strong> {o.customer_name || o.user_id}
                            </div>
                            <div>
                                {fmtMoney(o.currency, o.amount)} - {o.status} /{" "}
                                {o.prepare_status || "pending_prepare"}
                            </div>
                            <div className="muted">{fmtDate(o.created_at)}</div>
                            {o.events?.[0] ? (
                                <div className="muted">
                                    Latest event: {o.events[0].event_type}
                                </div>
                            ) : null}
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}

