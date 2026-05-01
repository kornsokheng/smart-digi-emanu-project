const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("./app");

test("GET /api/health returns ok", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
});

test("GET /api/reports/daily-summary returns summary object", async () => {
    const app = createApp();
    const res = await request(app).get("/api/reports/daily-summary");
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.summary === "object");
});

