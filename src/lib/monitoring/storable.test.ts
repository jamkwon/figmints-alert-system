import assert from "node:assert/strict";
import test from "node:test";
import { withoutNul } from "./storable.ts";

test("NUL characters are removed everywhere before saving", () => {
  const nul = "\u0000";
  assert.deepEqual(
    withoutNul({ [`k${nul}`]: `a${nul}b`, list: [`x${nul}`, 1, null, { deep: nul }], ok: true }),
    { k: "ab", list: ["x", 1, null, { deep: "" }], ok: true },
  );
  assert.equal(withoutNul(`title${nul}`), "title");
  assert.equal(withoutNul(null), null);
  assert.equal(withoutNul("a literal \\u0000 stays"), "a literal \\u0000 stays");
});
