import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_SIZE, fetchAllRows } from "./paginate.ts";

const table = Array.from({ length: 2 * PAGE_SIZE + 5 }, (_, i) => i);

test("loads every row past the 1,000-row API limit", async () => {
  const asked: [number, number][] = [];
  const { data, error } = await fetchAllRows(async (from, to) => {
    asked.push([from, to]);
    return { data: table.slice(from, to + 1), error: null };
  });
  assert.equal(error, null);
  assert.deepEqual(data, table);
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("stops after an exactly full last page, and reports errors", async () => {
  const full = table.slice(0, PAGE_SIZE);
  let calls = 0;
  const all = await fetchAllRows(async (from, to) => {
    calls++;
    return { data: full.slice(from, to + 1), error: null };
  });
  assert.equal(all.data.length, PAGE_SIZE);
  assert.equal(calls, 2);
  const failed = await fetchAllRows(async () => ({ data: null, error: { message: "boom" } }));
  assert.equal(failed.error?.message, "boom");
});
