// Repository parity check only: the disposable roundtrip is intentionally a
// standalone collector/Postgres smoke and does not invoke this sibling-fixture test.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveChannel } from "../assets/collector/core.js";

const fixtures = JSON.parse(await readFile(new URL("../../channel-taxonomy/references/fixtures.json", import.meta.url), "utf8"));
for (const fixture of fixtures.cases) {
  assert.equal(deriveChannel(fixture.input), fixture.expected, fixture.id);
}
console.log(`PASS collector deriveChannel parity: ${fixtures.cases.length} shared fixtures`);
