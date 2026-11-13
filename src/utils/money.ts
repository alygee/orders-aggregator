/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем. */
export function toKop(rub: number): number {
  // Сначала гасим погрешность float (0.29 * 100 = 28.999…), потом отбрасываем доли копейки
  return Math.floor(Math.round(rub * 100 * 1e6) / 1e6);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
