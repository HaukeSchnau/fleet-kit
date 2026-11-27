// Sorted keys at every level, so the same fleet always gives the same bytes.
export function stableJSON(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v
  return JSON.stringify(sort(value), null, 2) + "\n"
}
