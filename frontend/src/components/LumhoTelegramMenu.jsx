import { useCallback, useEffect, useMemo, useState } from "react";
import { lumhoMenuItems } from "../data/lumhoMenu";
import { KhqrOrderPayCard } from "./KhqrOrderPayCard";
import { api } from "../lib/paymentApi";

function getTelegramUser() {
    try {
        return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null;
    } catch {
        return null;
    }
}

function getTelegramUserIdString() {
    const u = getTelegramUser();
    if (u?.id != null) return String(u.id);
    return "481965778";
}

function getTelegramUserName() {
    const u = getTelegramUser();
    if (u?.first_name) return u.first_name;
    return "Customer";
}

export function LumhoTelegramMenu() {
    const [filter, setFilter] = useState("coffee");
    const [cart, setCart] = useState([]);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [activeItem, setActiveItem] = useState(null);
    const [selections, setSelections] = useState({
        sugar: "50%",
        ice: "Normal",
    });
    const [note, setNote] = useState("");
    const [view, setView] = useState("menu");
    const [payKey, setPayKey] = useState(0);
    const [status, setStatus] = useState("");

    useEffect(() => {
        try {
            const tg = window.Telegram?.WebApp;
            tg?.ready();
            tg?.expand();
        } catch {
            /* non-Telegram browser */
        }
    }, []);

    const filtered = useMemo(
        () => lumhoMenuItems.filter((i) => i.cat === filter),
        [filter]
    );

    const cartTotal = useMemo(
        () => cart.reduce((s, i) => s + i.price, 0),
        [cart]
    );

    const userId = useMemo(() => getTelegramUserIdString(), []);

    const openOptions = (item) => {
        setActiveItem(item);
        setSheetOpen(true);
    };

    const closeOptions = () => {
        setSheetOpen(false);
    };

    const setOpt = (type, value) => {
        setSelections((prev) => ({ ...prev, [type]: value }));
    };

    const addToCart = () => {
        if (!activeItem) return;
        const n = note.trim();
        setCart((prev) => [
            ...prev,
            {
                name: activeItem.name,
                price: activeItem.price,
                sugar: `${selections.sugar} Sug | ${selections.ice} Ice${n ? ` | ${n}` : ""}`,
            },
        ]);
        setNote("");
        closeOptions();
    };

    const submitOrderDraft = useCallback(async () => {
        const tgUser = getTelegramUser();
        const payload = {
            userId,
            currency: "KHR",
            totalAmount: cartTotal,
            customerName: getTelegramUserName(),
            customerUsername: tgUser?.username || null,
            telegramUser: tgUser,
            initData: window.Telegram?.WebApp?.initData || null,
            items: cart.map((item) => ({
                name: item.name,
                qty: 1,
                unitPrice: item.price,
                options: { preference: item.sugar },
            })),
        };
        const res = await api("/api/orders/create", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || "Unable to create order");
        }
    }, [cart, cartTotal, userId]);

    const startCheckout = async () => {
        if (cart.length === 0 || cartTotal < 1) return;
        setStatus("");
        try {
            await submitOrderDraft();
        } catch (err) {
            setStatus(err instanceof Error ? err.message : "Order setup failed");
            return;
        }
        setPayKey((k) => k + 1);
        setView("pay");
    };

    const handlePaid = useCallback(() => {
        setStatus("Payment confirmed. Barista has been notified in Telegram.");
        try {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
                "success"
            );
        } catch {
            /* ignore */
        }
    }, []);

    if (view === "pay") {
        return (
            <div className="lumho-root">
                <KhqrOrderPayCard
                    key={payKey}
                    userId={userId}
                    amount={cartTotal}
                    currency="KHR"
                    onPaid={handlePaid}
                    onBack={() => setView("menu")}
                    onPaidContinue={() => {
                        setView("menu");
                        setCart([]);
                    }}
                />
            </div>
        );
    }

    return (
        <div className="lumho-root">
            <header className="lumho-header">
                <h2 className="lumho-header-title">លំហូកាហ្វេ (Lumho)</h2>
            </header>

            <div className="lumho-filter-bar">
                {[
                    { id: "coffee", label: "☕ Coffee" },
                    { id: "non-coffee", label: "🍵 Non-Coffee" },
                    { id: "refreshing", label: "🍹 Refreshing" },
                ].map((b) => (
                    <button
                        key={b.id}
                        type="button"
                        className={`lumho-filter-btn${filter === b.id ? " active" : ""}`}
                        onClick={() => setFilter(b.id)}
                    >
                        {b.label}
                    </button>
                ))}
            </div>

            <div className="lumho-menu-grid">
                {filtered.map((i) => (
                    <button
                        key={i.name}
                        type="button"
                        className="lumho-item-card"
                        onClick={() => openOptions(i)}
                    >
                        <img
                            src="https://img.icons8.com/plasticine/100/coffee-to-go.png"
                            alt=""
                            width={85}
                            height={85}
                        />
                        <div className="lumho-item-name">{i.name}</div>
                        <div className="lumho-item-price">
                            {i.price.toLocaleString()}៛
                        </div>
                    </button>
                ))}
            </div>

            <button
                type="button"
                className={`lumho-sheet-overlay${sheetOpen ? " show" : ""}`}
                aria-label="Close"
                onClick={closeOptions}
            />

            <div className={`lumho-bottom-sheet${sheetOpen ? " show" : ""}`}>
                <h3 className="lumho-sheet-title">
                    {activeItem?.name ?? "Customize"}
                </h3>
                <span className="lumho-sheet-label">SUGAR</span>
                <div className="lumho-selector" role="group">
                    {["0%", "25%", "50%", "100%"].map((v) => (
                        <button
                            key={v}
                            type="button"
                            className={
                                selections.sugar === v ? "active" : undefined
                            }
                            onClick={() => setOpt("sugar", v)}
                        >
                            {v}
                        </button>
                    ))}
                </div>
                <span className="lumho-sheet-label">ICE</span>
                <div className="lumho-selector" role="group">
                    {[
                        { v: "No Ice", l: "None" },
                        { v: "Normal", l: "Normal" },
                        { v: "Separate", l: "Separate" },
                    ].map(({ v, l }) => (
                        <button
                            key={v}
                            type="button"
                            className={
                                selections.ice === v ? "active" : undefined
                            }
                            onClick={() => setOpt("ice", v)}
                        >
                            {l}
                        </button>
                    ))}
                </div>
                <textarea
                    className="lumho-note"
                    rows={2}
                    placeholder="Notes (Oat milk, extra shot...)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
                <button
                    type="button"
                    className="lumho-btn lumho-btn-primary lumho-sheet-cta"
                    onClick={addToCart}
                >
                    Add to Basket
                </button>
            </div>

            {cart.length > 0 ? (
                <button
                    type="button"
                    className="lumho-footer-cart"
                    onClick={startCheckout}
                >
                    <span>
                        {cart.length} Drink{cart.length === 1 ? "" : "s"} — Pay
                        with KHQR
                    </span>
                    <span>{cartTotal.toLocaleString()}៛</span>
                </button>
            ) : null}
            {status ? <p className="info">{status}</p> : null}
        </div>
    );
}
