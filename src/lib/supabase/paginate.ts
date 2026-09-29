/**
 * Supabase returns at most 1,000 rows per request (the API's "max rows" setting)
 * and silently drops the rest. Loads every row by asking for one range at a time.
 * `page` must build a fresh query with a stable order (for example by id) and
 * apply `.range(from, to)`.
 */
export const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
