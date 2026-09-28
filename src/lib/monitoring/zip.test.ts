import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, zipFiles } from "./zip.ts";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("zipFiles writes a stored entry, central directory and end record", () => {
  const data = Buffer.from("<?php echo 'hi';\n");
  const zip = zipFiles([{ name: "plugin/plugin.php", data }], new Date(2026, 8, 28, 12, 30, 10));
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "starts with a local file header");
  assert.equal(zip.readUInt32LE(14), crc32(data));
  assert.equal(zip.readUInt32LE(22), data.length);
  assert.equal(zip.subarray(30, 30 + 17).toString(), "plugin/plugin.php");
  assert.deepEqual(zip.subarray(47, 47 + data.length), data, "stored uncompressed");
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, "ends with the end-of-directory record");
  assert.equal(zip.readUInt16LE(end + 10), 1, "one entry");
  const directory = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt32LE(directory), 0x02014b50, "end record points at the central directory");
  assert.equal(zip.readUInt32LE(directory + 42), 0, "central entry points at the local header");
});
