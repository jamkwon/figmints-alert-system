/**
 * Postgres refuses the NUL character in text and jsonb, and one stray NUL in a
 * page's text would make the whole check result fail to save. Removes it from
 * every string, including object keys.
 */
export function withoutNul<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (typeof value === "string") return value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [strip(k), strip(v)]));
  }
  return value;
}
