import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Inter is applied, not only bundled", () => {
  it("sets the root font stack to Inter and loads the face", () => {
    const css = read("../src/styles.css");
    const root = read("../src/routes/__root.tsx");
    const spa = read("../src/spa-main.tsx");
    const tokens = read("../src/theme/tokens.css");
    assert.match(css, /--font-sans:\s*"Inter Variable",\s*"Inter"/);
    assert.match(root, /font-family:'Inter Variable','Inter'/);
    assert.match(root, /@fontsource-variable\/inter\/wght\.css/);
    assert.match(spa, /@fontsource-variable\/inter\/wght\.css/);
    assert.match(tokens, /"Inter Variable","Inter"/);
  });
});
