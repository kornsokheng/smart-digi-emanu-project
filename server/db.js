const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "orders.db");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    qr TEXT NOT NULL,
    md5 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    currency TEXT NOT NULL DEFAULT 'USD',
    amount REAL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user_pending ON orders (user_id, status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_users (
    user_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events (order_id);
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    options_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
  CREATE TABLE IF NOT EXISTS order_drafts (
    user_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

function ensureColumn(tableName, columnName, sqlDef) {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = cols.some((c) => c.name === columnName);
    if (!exists) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDef}`);
    }
}

ensureColumn("orders", "paid_at", "INTEGER");
ensureColumn(
    "orders",
    "prepare_status",
    "TEXT NOT NULL DEFAULT 'pending_prepare'"
);
ensureColumn("orders", "prepared_at", "INTEGER");
ensureColumn("orders", "customer_name", "TEXT");
ensureColumn("orders", "customer_username", "TEXT");
ensureColumn("orders", "telegram_chat_id", "TEXT");

function expireOpenOrdersForUser(userId) {
    const stmt = db.prepare(
        `UPDATE orders SET status = 'expired'
     WHERE user_id = ? AND status = 'pending'`
    );
    stmt.run(userId);
}

function insertOrder(row) {
    const stmt = db.prepare(
        `INSERT INTO orders (user_id, qr, md5, status, currency, amount, expires_at, created_at)
     VALUES (@user_id, @qr, @md5, @status, @currency, @amount, @expires_at, @created_at)`
    );
    const info = stmt.run(row);
    return info.lastInsertRowid;
}

function getLatestPendingOrderForUser(userId, nowMs = Date.now()) {
    return db
        .prepare(
            `SELECT * FROM orders
       WHERE user_id = ? AND status = 'pending' AND expires_at > ?
       ORDER BY id DESC LIMIT 1`
        )
        .get(userId, nowMs);
}

function markOrderPaid(orderId) {
    db.prepare(
        `UPDATE orders
         SET status = 'paid',
             paid_at = ?,
             prepare_status = CASE
                 WHEN prepare_status IS NULL OR prepare_status = '' THEN 'pending_prepare'
                 ELSE prepare_status
             END
         WHERE id = ?`
    ).run(Date.now(), orderId);
}

function markOrderPreparing(orderId) {
    const result = db
        .prepare(
            `UPDATE orders
             SET prepare_status = 'preparing'
             WHERE id = ? AND status = 'paid' AND prepare_status = 'pending_prepare'`
        )
        .run(orderId);
    return result.changes > 0;
}

function markOrderReady(orderId) {
    const now = Date.now();
    const result = db
        .prepare(
            `UPDATE orders
             SET prepare_status = 'ready', prepared_at = ?
             WHERE id = ? AND status = 'paid' AND prepare_status != 'ready'`
        )
        .run(now, orderId);
    return result.changes > 0;
}

function getOrderById(orderId) {
    return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

function appendOrderEvent(orderId, eventType, payload = null) {
    db.prepare(
        `INSERT INTO order_events (order_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
    ).run(
        orderId,
        eventType,
        payload ? JSON.stringify(payload) : null,
        Date.now()
    );
}

function upsertTelegramUser(user) {
    const now = Date.now();
    db.prepare(
        `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name, updated_at)
         VALUES (@user_id, @chat_id, @username, @first_name, @last_name, @updated_at)
         ON CONFLICT(user_id) DO UPDATE SET
           chat_id = excluded.chat_id,
           username = excluded.username,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           updated_at = excluded.updated_at`
    ).run({
        user_id: String(user.userId),
        chat_id: String(user.chatId),
        username: user.username ?? null,
        first_name: user.firstName ?? null,
        last_name: user.lastName ?? null,
        updated_at: now,
    });
}

function getTelegramUser(userId) {
    return db
        .prepare(`SELECT * FROM telegram_users WHERE user_id = ?`)
        .get(String(userId));
}

function upsertOrderDraft(userId, draftPayload) {
    db.prepare(
        `INSERT INTO order_drafts (user_id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
    ).run(String(userId), JSON.stringify(draftPayload), Date.now());
}

function consumeOrderDraft(userId) {
    const row = db
        .prepare(`SELECT payload_json FROM order_drafts WHERE user_id = ?`)
        .get(String(userId));
    if (!row) return null;
    db.prepare(`DELETE FROM order_drafts WHERE user_id = ?`).run(String(userId));
    try {
        return JSON.parse(row.payload_json);
    } catch {
        return null;
    }
}

function setOrderCustomerMeta(orderId, customerMeta = {}) {
    db.prepare(
        `UPDATE orders
         SET customer_name = COALESCE(?, customer_name),
             customer_username = COALESCE(?, customer_username),
             telegram_chat_id = COALESCE(?, telegram_chat_id)
         WHERE id = ?`
    ).run(
        customerMeta.customerName ?? null,
        customerMeta.customerUsername ?? null,
        customerMeta.telegramChatId ?? null,
        orderId
    );
}

function replaceOrderItems(orderId, items = []) {
    const tx = db.transaction(() => {
        db.prepare(`DELETE FROM order_items WHERE order_id = ?`).run(orderId);
        const stmt = db.prepare(
            `INSERT INTO order_items (order_id, name, qty, unit_price, options_json)
             VALUES (@order_id, @name, @qty, @unit_price, @options_json)`
        );
        for (const item of items) {
            stmt.run({
                order_id: orderId,
                name: String(item.name || "Item"),
                qty: Number(item.qty || 1),
                unit_price: Number(item.unitPrice || item.price || 0),
                options_json: item.options ? JSON.stringify(item.options) : null,
            });
        }
    });
    tx();
}

function getOrderItems(orderId) {
    return db
        .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`)
        .all(orderId);
}

function getOrderEvents(orderId) {
    return db
        .prepare(
            `SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 50`
        )
        .all(orderId);
}

function listOrders(filters = {}) {
    const where = [];
    const params = [];
    if (filters.status) {
        where.push("status = ?");
        params.push(filters.status);
    }
    if (filters.prepareStatus) {
        where.push("prepare_status = ?");
        params.push(filters.prepareStatus);
    }
    if (filters.userId) {
        where.push("user_id = ?");
        params.push(filters.userId);
    }
    if (filters.fromMs != null) {
        where.push("created_at >= ?");
        params.push(filters.fromMs);
    }
    if (filters.toMs != null) {
        where.push("created_at <= ?");
        params.push(filters.toMs);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return db
        .prepare(
            `SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ${Number(filters.limit || 200)}`
        )
        .all(...params);
}

function getDailySummary(fromMs, toMs) {
    return db
        .prepare(
            `SELECT
               COUNT(*) AS total_orders,
               SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
               SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_orders,
               SUM(CASE WHEN status = 'paid' AND currency = 'KHR' THEN amount ELSE 0 END) AS revenue_khr,
               SUM(CASE WHEN status = 'paid' AND currency = 'USD' THEN amount ELSE 0 END) AS revenue_usd,
               AVG(CASE WHEN prepared_at IS NOT NULL AND paid_at IS NOT NULL THEN prepared_at - paid_at END) AS avg_prep_ms
             FROM orders
             WHERE created_at BETWEEN ? AND ?`
        )
        .get(fromMs, toMs);
}

function getFailureReport(fromMs, toMs) {
    return db
        .prepare(
            `SELECT status, COUNT(*) AS count
             FROM orders
             WHERE created_at BETWEEN ? AND ?
               AND status IN ('expired')
             GROUP BY status`
        )
        .all(fromMs, toMs);
}

module.exports = {
    db,
    expireOpenOrdersForUser,
    insertOrder,
    getLatestPendingOrderForUser,
    markOrderPaid,
    markOrderPreparing,
    markOrderReady,
    getOrderById,
    appendOrderEvent,
    upsertTelegramUser,
    getTelegramUser,
    upsertOrderDraft,
    consumeOrderDraft,
    setOrderCustomerMeta,
    replaceOrderItems,
    getOrderItems,
    getOrderEvents,
    listOrders,
    getDailySummary,
    getFailureReport,
};
