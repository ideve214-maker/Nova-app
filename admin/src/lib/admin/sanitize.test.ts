import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeText, DOMPURIFY_VERSION } from "./sanitize.ts";

describe("sanitizeText", () => {
  it("strips script and tags from user content", () => {
    const dirty = '<img src=x onerror="alert(1)">hello<script>alert(2)</script><b>world</b>';
    const out = sanitizeText(dirty);
    assert.equal(out.includes("<script"), false);
    assert.equal(out.includes("onerror"), false);
    assert.equal(out.includes("<img"), false);
    assert.equal(out.includes("hello"), true);
    assert.equal(out.includes("world"), true);
  });

  it("returns empty for nullish values and keeps plain text", () => {
    assert.equal(sanitizeText(null), "");
    assert.equal(sanitizeText(undefined), "");
    assert.equal(sanitizeText("普通简介"), "普通简介");
  });

  it("records the bundled DOMPurify version", () => {
    assert.equal(DOMPURIFY_VERSION, "3.4.17");
  });
});
