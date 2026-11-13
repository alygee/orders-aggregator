import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("параллельные версии одного заказа: сохраняется самая новая", async () => {
    // Внешний API шлёт вебхуки параллельно и не по порядку
    const ids: string[] = [];
    const sends: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      const o = apiOrder({ status: "pending", updatedAt: "2026-02-10T10:00:00Z" });
      ids.push(o.id);
      await postWebhook(ctx.app, o);
      for (const h of ["13", "11", "12"]) {
        sends.push(postWebhook(ctx.app, { ...o, status: h === "13" ? "paid" : "refunded", updatedAt: `2026-02-10T${h}:00:00Z` }));
      }
    }
    await Promise.all(sends);
    const { rows } = await ctx.db.query(`SELECT status, updated_at FROM orders WHERE id = ANY($1)`, [ids]);
    expect(rows.map((r) => [r.status, r.updated_at.toISOString()])).toEqual(
      ids.map(() => ["paid", "2026-02-10T13:00:00.000Z"]),
    );
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });
});
