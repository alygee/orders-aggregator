import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db.js";

const db = createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orders_test");
const sql = (f: string) => readFile(join(import.meta.dirname, "..", "migrations", f), "utf8");

afterAll(() => db.end());

describe("миграция 002_amount_paid", () => {
  it("существующие заказы получают paid_kop = amount_kop", async () => {
    // Отдельная схема в транзакции с откатом: не трогаем общую тестовую БД
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA m002; SET LOCAL search_path = m002");
      await client.query(await sql("001_init.sql"));
      await client.query(
        `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
         VALUES ('o1', 'c1', 250000, 'paid', now(), now())`,
      );
      await client.query(await sql("002_amount_paid.sql"));
      const { rows } = await client.query(`SELECT amount_kop, paid_kop FROM orders`);
      expect(rows.map((r) => [Number(r.amount_kop), Number(r.paid_kop)])).toEqual([[250000, 250000]]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
