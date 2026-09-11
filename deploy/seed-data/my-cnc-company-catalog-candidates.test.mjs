import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const catalogPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "my-cnc-company-catalog-candidates.json",
);

const FORBIDDEN_KEYS = new Set([
  "name",
  "phone",
  "email",
  "profileUrl",
  "profile_url",
  "profileURL",
  "identityKey",
  "identityKeys",
  "externalId",
  "resumeId",
  "proposalId",
  "verificationLevel",
]);

function collectForbiddenKeys(value, path, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, found);
  }
}

test("MY/TH catalog candidates JSON is preview-derived and PII-free", () => {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.source, "preview-only");
  assert.equal(catalog.query?.prod, false);
  assert.equal(catalog.query?.opt_trends, false);
  assert.ok(Array.isArray(catalog.distinctEmployerStrings));
  assert.ok(catalog.distinctEmployerStrings.length > 0);

  const forbidden = [];
  collectForbiddenKeys(catalog, "$", forbidden);
  assert.deepEqual(forbidden, []);

  const vs = catalog.aggregates?.vsSeed27;
  assert.ok(vs);
  assert.ok(vs.missDistinct > 0);
  assert.equal(vs.missDistinct, catalog.distinctEmployerStrings.filter((row) => row.vsSeed27 === "miss").length);

  let previousCount = Number.POSITIVE_INFINITY;
  for (const row of catalog.distinctEmployerStrings) {
    assert.equal(typeof row.normalizedKey, "string");
    assert.ok(row.normalizedKey.length > 0);
    assert.equal(typeof row.employerName, "string");
    assert.ok(row.employerName.length > 0);
    assert.equal(typeof row.count, "number");
    assert.ok(row.count >= 1);
    assert.ok(["MY", "TH", "UNSPLIT"].includes(row.marketBestEffort));
    assert.ok(["hit", "miss"].includes(row.vsSeed27));
    assert.ok(row.count <= previousCount);
    previousCount = row.count;
    assert.equal(
      Object.keys(row).sort().join(","),
      "count,employerName,marketBestEffort,normalizedKey,vsSeed27",
    );
  }
});
