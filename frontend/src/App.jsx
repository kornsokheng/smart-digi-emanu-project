import "./App.css";
import { useState } from "react";
import { KhqrPaymentFlow } from "./components/KhqrPaymentFlow";
import { LumhoTelegramMenu } from "./components/LumhoTelegramMenu";
import { OwnerDashboard } from "./components/OwnerDashboard";

function App() {
    const [tab, setTab] = useState("lumho");

    return (
        <main
            className={`app-shell${tab === "lumho" ? " app-shell--lumho" : ""}${
                tab === "owner" ? " app-shell--owner" : ""
            }`}
        >
            <nav className="app-nav" aria-label="App mode">
                <button
                    type="button"
                    className={tab === "lumho" ? "active" : ""}
                    onClick={() => setTab("lumho")}
                >
                    Lumho menu + KHQR
                </button>
                <button
                    type="button"
                    className={tab === "demo" ? "active" : ""}
                    onClick={() => setTab("demo")}
                >
                    KHQR test
                </button>
                <button
                    type="button"
                    className={tab === "owner" ? "active" : ""}
                    onClick={() => setTab("owner")}
                >
                    Owner dashboard
                </button>
            </nav>
            {tab === "lumho" ? (
                <LumhoTelegramMenu />
            ) : tab === "owner" ? (
                <OwnerDashboard />
            ) : (
                <KhqrPaymentFlow />
            )}
        </main>
    );
}

export default App;
