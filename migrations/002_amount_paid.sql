-- Оплачено клиентом (со скидкой). Для заказов, сохранённых до появления скидок, = amount_kop.
ALTER TABLE orders ADD COLUMN paid_kop BIGINT;
UPDATE orders SET paid_kop = amount_kop;
ALTER TABLE orders ALTER COLUMN paid_kop SET NOT NULL;
