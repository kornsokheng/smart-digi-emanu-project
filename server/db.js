const fs = require("fs");
const path = require("path");

const usePostgres = Boolean(process.env.DATABASE_URL);
const dbEngine = usePostgres ? "postgres" : "sqlite";

let sqliteDb = null;
let pgPool = null;
let initPromise = null;

if (usePostgres) {
    const { Pool } = require("pg");
    pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl:
            process.env.DATABASE_SSL === "false"
                ? false
                : { rejectUnauthorized: false },
    });
} else {
    const Database = require("better-sqlite3");
    const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
    const dbPath = process.env.DB_PATH || path.join(dataDir, "orders.db");

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    sqliteDb = new Database(dbPath);
}

function normalizeRow(row) {
    if (!row) return row;
    return {
        ...row,
        id: row.id != null ? Number(row.id) : row.id,
        order_id: row.order_id != null ? Number(row.order_id) : row.order_id,
        qty: row.qty != null ? Number(row.qty) : row.qty,
        amount: row.amount != null ? Number(row.amount) : row.amount,
        unit_price: row.unit_price != null ? Number(row.unit_price) : row.unit_price,
        expires_at: row.expires_at != null ? Number(row.expires_at) : row.expires_at,
        created_at: row.created_at != null ? Number(row.created_at) : row.created_at,
        paid_at: row.paid_at != null ? Number(row.paid_at) : row.paid_at,
        prepared_at: row.prepared_at != null ? Number(row.prepared_at) : row.prepared_at,
        updated_at: row.updated_at != null ? Number(row.updated_at) : row.updated_at,
    };
}

async function initSqlite() {
    sqliteDb.exec(`
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

    ensureSqliteColumn("orders", "paid_at", "INTEGER");
    ensureSqliteColumn(
        "orders",
        "prepare_status",
        "TEXT NOT NULL DEFAULT 'pending_prepare'"
    );
    ensureSqliteColumn("orders", "prepared_at", "INTEGER");
    ensureSqliteColumn("orders", "customer_name", "TEXT");
    ensureSqliteColumn("orders", "customer_username", "TEXT");
    ensureSqliteColumn("orders", "telegram_chat_id", "TEXT");
}

function ensureSqliteColumn(tableName, columnName, sqlDef) {
    const cols = sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!cols.some((c) => c.name === columnName)) {
        sqliteDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDef}`);
    }
}

async function initPostgres() {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        qr TEXT NOT NULL,
        md5 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        currency TEXT NOT NULL DEFAULT 'USD',
        amount DOUBLE PRECISION,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        paid_at BIGINT,
        prepare_status TEXT NOT NULL DEFAULT 'pending_prepare',
        prepared_at BIGINT,
        customer_name TEXT,
        customer_username TEXT,
        telegram_chat_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user_pending ON orders (user_id, status);
      CREATE TABLE IF NOT EXISTS telegram_users (
        user_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS order_events (
        id BIGSERIAL PRIMARY KEY,
        order_id BIGINT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events (order_id);
      CREATE TABLE IF NOT EXISTS order_items (
        id BIGSERIAL PRIMARY KEY,
        order_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        qty INTEGER NOT NULL DEFAULT 1,
        unit_price DOUBLE PRECISION NOT NULL,
        options_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
      CREATE TABLE IF NOT EXISTS order_drafts (
        user_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
}

async function initDb() {
    if (!initPromise) {
        initPromise = usePostgres ? initPostgres() : initSqlite();
    }
    return initPromise;
}

async function checkDbHealth() {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query("SELECT 1 AS ok");
        return { ok: result.rows[0]?.ok === 1, engine: dbEngine };
    }
    sqliteDb.prepare("SELECT 1").get();
    return { ok: true, engine: dbEngine };
}

async function expireOpenOrdersForUser(userId) {
    await initDb();
    if (usePostgres) {
        await pgPool.query(
            `UPDATE orders SET status = 'expired'
             WHERE user_id = $1 AND status = 'pending'`,
            [userId]
        );
        return;
    }
    sqliteDb
        .prepare(`UPDATE orders SET status = 'expired' WHERE user_id = ? AND status = 'pending'`)
        .run(userId);
}

async function insertOrder(row) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(
            `INSERT INTO orders (user_id, qr, md5, status, currency, amount, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                row.user_id,
                row.qr,
                row.md5,
                row.status,
                row.currency,
                row.amount,
                row.expires_at,
                row.created_at,
            ]
        );
        return Number(result.rows[0].id);
    }
    const info = sqliteDb
        .prepare(
            `INSERT INTO orders (user_id, qr, md5, status, currency, amount, expires_at, created_at)
             VALUES (@user_id, @qr, @md5, @status, @currency, @amount, @expires_at, @created_at)`
        )
        .run(row);
    return info.lastInsertRowid;
}

async function getLatestPendingOrderForUser(userId, nowMs = Date.now()) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(
            `SELECT * FROM orders
             WHERE user_id = $1 AND status = 'pending' AND expires_at > $2
             ORDER BY id DESC LIMIT 1`,
            [userId, nowMs]
        );
        return normalizeRow(result.rows[0]);
    }
    return normalizeRow(
        sqliteDb
            .prepare(
                `SELECT * FROM orders
                 WHERE user_id = ? AND status = 'pending' AND expires_at > ?
                 ORDER BY id DESC LIMIT 1`
            )
            .get(userId, nowMs)
    );
}

async function markOrderPaid(orderId) {
    await initDb();
    const now = Date.now();
    if (usePostgres) {
        await pgPool.query(
            `UPDATE orders
             SET status = 'paid',
                 paid_at = $1,
                 prepare_status = CASE
                   WHEN prepare_status IS NULL OR prepare_status = '' THEN 'pending_prepare'
                   ELSE prepare_status
                 END
             WHERE id = $2`,
            [now, orderId]
        );
        return;
    }
    sqliteDb
        .prepare(
            `UPDATE orders
             SET status = 'paid',
                 paid_at = ?,
                 prepare_status = CASE
                   WHEN prepare_status IS NULL OR prepare_status = '' THEN 'pending_prepare'
                   ELSE prepare_status
                 END
             WHERE id = ?`
        )
        .run(now, orderId);
}

async function markOrderPreparing(orderId) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(
            `UPDATE orders
             SET prepare_status = 'preparing'
             WHERE id = $1 AND status = 'paid' AND prepare_status = 'pending_prepare'`,
            [orderId]
        );
        return result.rowCount > 0;
    }
    const result = sqliteDb
        .prepare(
            `UPDATE orders
             SET prepare_status = 'preparing'
             WHERE id = ? AND status = 'paid' AND prepare_status = 'pending_prepare'`
        )
        .run(orderId);
    return result.changes > 0;
}

async function markOrderReady(orderId) {
    await initDb();
    const now = Date.now();
    if (usePostgres) {
        const result = await pgPool.query(
            `UPDATE orders
             SET prepare_status = 'ready', prepared_at = $1
             WHERE id = $2 AND status = 'paid' AND prepare_status != 'ready'`,
            [now, orderId]
        );
        return result.rowCount > 0;
    }
    const result = sqliteDb
        .prepare(
            `UPDATE orders
             SET prepare_status = 'ready', prepared_at = ?
             WHERE id = ? AND status = 'paid' AND prepare_status != 'ready'`
        )
        .run(now, orderId);
    return result.changes > 0;
}

async function getOrderById(orderId) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(`SELECT * FROM orders WHERE id = $1`, [
            orderId,
        ]);
        return normalizeRow(result.rows[0]);
    }
    return normalizeRow(sqliteDb.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId));
}

async function appendOrderEvent(orderId, eventType, payload = null) {
    await initDb();
    const payloadJson = payload ? JSON.stringify(payload) : null;
    const now = Date.now();
    if (usePostgres) {
        await pgPool.query(
            `INSERT INTO order_events (order_id, event_type, payload_json, created_at)
             VALUES ($1, $2, $3, $4)`,
            [orderId, eventType, payloadJson, now]
        );
        return;
    }
    sqliteDb
        .prepare(
            `INSERT INTO order_events (order_id, event_type, payload_json, created_at)
             VALUES (?, ?, ?, ?)`
        )
        .run(orderId, eventType, payloadJson, now);
}

async function upsertTelegramUser(user) {
    await initDb();
    const row = {
        user_id: String(user.userId),
        chat_id: String(user.chatId),
        username: user.username ?? null,
        first_name: user.firstName ?? null,
        last_name: user.lastName ?? null,
        updated_at: Date.now(),
    };
    if (usePostgres) {
        await pgPool.query(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT(user_id) DO UPDATE SET
               chat_id = excluded.chat_id,
               username = excluded.username,
               first_name = excluded.first_name,
               last_name = excluded.last_name,
               updated_at = excluded.updated_at`,
            [
                row.user_id,
                row.chat_id,
                row.username,
                row.first_name,
                row.last_name,
                row.updated_at,
            ]
        );
        return;
    }
    sqliteDb
        .prepare(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name, updated_at)
             VALUES (@user_id, @chat_id, @username, @first_name, @last_name, @updated_at)
             ON CONFLICT(user_id) DO UPDATE SET
               chat_id = excluded.chat_id,
               username = excluded.username,
               first_name = excluded.first_name,
               last_name = excluded.last_name,
               updated_at = excluded.updated_at`
        )
        .run(row);
}

async function getTelegramUser(userId) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(
            `SELECT * FROM telegram_users WHERE user_id = $1`,
            [String(userId)]
        );
        return normalizeRow(result.rows[0]);
    }
    return normalizeRow(
        sqliteDb
            .prepare(`SELECT * FROM telegram_users WHERE user_id = ?`)
            .get(String(userId))
    );
}

async function upsertOrderDraft(userId, draftPayload) {
    await initDb();
    const payloadJson = JSON.stringify(draftPayload);
    const now = Date.now();
    if (usePostgres) {
        await pgPool.query(
            `INSERT INTO order_drafts (user_id, payload_json, updated_at)
             VALUES ($1, $2, $3)
             ON CONFLICT(user_id) DO UPDATE SET
               payload_json = excluded.payload_json,
               updated_at = excluded.updated_at`,
            [String(userId), payloadJson, now]
        );
        return;
    }
    sqliteDb
        .prepare(
            `INSERT INTO order_drafts (user_id, payload_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               payload_json = excluded.payload_json,
               updated_at = excluded.updated_at`
        )
        .run(String(userId), payloadJson, now);
}

async function consumeOrderDraft(userId) {
    await initDb();
    let row;
    if (usePostgres) {
        const result = await pgPool.query(
            `DELETE FROM order_drafts WHERE user_id = $1 RETURNING payload_json`,
            [String(userId)]
        );
        row = result.rows[0];
    } else {
        row = sqliteDb
            .prepare(`SELECT payload_json FROM order_drafts WHERE user_id = ?`)
            .get(String(userId));
        if (row) {
            sqliteDb.prepare(`DELETE FROM order_drafts WHERE user_id = ?`).run(String(userId));
        }
    }
    if (!row) return null;
    try {
        return JSON.parse(row.payload_json);
    } catch {
        return null;
    }
}

async function setOrderCustomerMeta(orderId, customerMeta = {}) {
    await initDb();
    const values = [
        customerMeta.customerName ?? null,
        customerMeta.customerUsername ?? null,
        customerMeta.telegramChatId ?? null,
        orderId,
    ];
    if (usePostgres) {
        await pgPool.query(
            `UPDATE orders
             SET customer_name = COALESCE($1, customer_name),
                 customer_username = COALESCE($2, customer_username),
                 telegram_chat_id = COALESCE($3, telegram_chat_id)
             WHERE id = $4`,
            values
        );
        return;
    }
    sqliteDb
        .prepare(
            `UPDATE orders
             SET customer_name = COALESCE(?, customer_name),
                 customer_username = COALESCE(?, customer_username),
                 telegram_chat_id = COALESCE(?, telegram_chat_id)
             WHERE id = ?`
        )
        .run(...values);
}

async function replaceOrderItems(orderId, items = []) {
    await initDb();
    if (usePostgres) {
        const client = await pgPool.connect();
        try {
            await client.query("BEGIN");
            await client.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
            for (const item of items) {
                await client.query(
                    `INSERT INTO order_items (order_id, name, qty, unit_price, options_json)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        orderId,
                        String(item.name || "Item"),
                        Number(item.qty || 1),
                        Number(item.unitPrice || item.price || 0),
                        item.options ? JSON.stringify(item.options) : null,
                    ]
                );
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
        return;
    }
    const tx = sqliteDb.transaction(() => {
        sqliteDb.prepare(`DELETE FROM order_items WHERE order_id = ?`).run(orderId);
        const stmt = sqliteDb.prepare(
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

async function getOrderItems(orderId) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(
            `SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`,
            [orderId]
        );
        return result.rows.map(normalizeRow);
    }
    return sqliteDb
        .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`)
        .all(orderId)
        .map(normalizeRow);
}

async function getOrderEvents(orderId) {
    await initDb();
    if (usePostgres) {
        const result = await pgPool.query(
            `SELECT * FROM order_events WHERE order_id = $1 ORDER BY id DESC LIMIT 50`,
            [orderId]
        );
        return result.rows.map(normalizeRow);
    }
    return sqliteDb
        .prepare(`SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 50`)
        .all(orderId)
        .map(normalizeRow);
}

async function listOrders(filters = {}) {
    await initDb();
    const where = [];
    const params = [];
    function add(condition, value) {
        params.push(value);
        where.push(usePostgres ? condition.replace("?", `$${params.length}`) : condition);
    }
    if (filters.status) add("status = ?", filters.status);
    if (filters.prepareStatus) add("prepare_status = ?", filters.prepareStatus);
    if (filters.userId) add("user_id = ?", filters.userId);
    if (filters.fromMs != null) add("created_at >= ?", filters.fromMs);
    if (filters.toMs != null) add("created_at <= ?", filters.toMs);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
    if (usePostgres) {
        const result = await pgPool.query(
            `SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ${limit}`,
            params
        );
        return result.rows.map(normalizeRow);
    }
    return sqliteDb
        .prepare(`SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ${limit}`)
        .all(...params)
        .map(normalizeRow);
}

async function getDailySummary(fromMs, toMs) {
    await initDb();
    const query = `SELECT
        COUNT(*) AS total_orders,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_orders,
        SUM(CASE WHEN status = 'paid' AND currency = 'KHR' THEN amount ELSE 0 END) AS revenue_khr,
        SUM(CASE WHEN status = 'paid' AND currency = 'USD' THEN amount ELSE 0 END) AS revenue_usd,
        AVG(CASE WHEN prepared_at IS NOT NULL AND paid_at IS NOT NULL THEN prepared_at - paid_at END) AS avg_prep_ms
      FROM orders
      WHERE created_at BETWEEN ${usePostgres ? "$1 AND $2" : "? AND ?"}`;
    const row = usePostgres
        ? (await pgPool.query(query, [fromMs, toMs])).rows[0]
        : sqliteDb.prepare(query).get(fromMs, toMs);
    return {
        total_orders: Number(row?.total_orders || 0),
        paid_orders: Number(row?.paid_orders || 0),
        expired_orders: Number(row?.expired_orders || 0),
        revenue_khr: Number(row?.revenue_khr || 0),
        revenue_usd: Number(row?.revenue_usd || 0),
        avg_prep_ms: row?.avg_prep_ms == null ? null : Number(row.avg_prep_ms),
    };
}

async function getFailureReport(fromMs, toMs) {
    await initDb();
    const query = `SELECT status, COUNT(*) AS count
      FROM orders
      WHERE created_at BETWEEN ${usePostgres ? "$1 AND $2" : "? AND ?"}
        AND status IN ('expired')
      GROUP BY status`;
    if (usePostgres) {
        return (await pgPool.query(query, [fromMs, toMs])).rows.map((row) => ({
            ...row,
            count: Number(row.count),
        }));
    }
    return sqliteDb.prepare(query).all(fromMs, toMs);
}

module.exports = {
    db: usePostgres ? pgPool : sqliteDb,
    dbEngine,
    initDb,
    checkDbHealth,
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
