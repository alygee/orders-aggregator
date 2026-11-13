import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 }]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 }]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });

  it("gross / discount / net по скидкам, total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 2000, discountPercent: 20, amountPaid: 1600 }));
    await postWebhook(ctx.app, apiOrder({ amount: "500.00", discountPercent: "7", amountPaid: "465" }));
    await postWebhook(ctx.app, apiOrder({ amount: 3441, discountPercent: 25, amountPaid: 2580.75 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 5941, gross: 5941, discount: 1295.25, net: 4645.75 }]);
  });

  it("заказ без amountPaid (старый формат API) — без скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 }]);
  });

  it("amountPaid больше amount — заказ отклоняется", async () => {
    const res = await postWebhook(ctx.app, apiOrder({ amount: 100, amountPaid: 200 }));
    expect(res.statusCode).toBe(400);
  });

  it("дни считаются по смещению на момент заказа (переход на летнее время)", async () => {
    // Europe/Berlin: до 29.03.2026 UTC+1, после — UTC+2
    ctx.api.customers.set("c_b", "Europe/Berlin");
    await postWebhook(ctx.app, apiOrder({ customerId: "c_b", amount: 100, createdAt: "2026-03-27T22:40:00Z" })); // 23:40 27-го
    await postWebhook(ctx.app, apiOrder({ customerId: "c_b", amount: 200, createdAt: "2026-03-30T22:40:00Z" })); // 00:40 31-го
    const res = await dailyTotals(ctx.app, "c_b", "2026-03-27", "2026-03-31");
    expect(res.json().map((d: { date: string; total: number }) => [d.date, d.total])).toEqual([
      ["2026-03-27", 100],
      ["2026-03-28", 0],
      ["2026-03-29", 0],
      ["2026-03-30", 0],
      ["2026-03-31", 200],
    ]);
  });
});
