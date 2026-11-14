import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripFineLocation } from "./strip-fine-location.mjs";

describe("stripFineLocation", () => {
  it("removes fine and keeps coarse", () => {
    const xml = `<manifest>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;
    const next = stripFineLocation(xml);
    assert.equal(next.includes("ACCESS_FINE_LOCATION"), false);
    assert.equal(next.includes("ACCESS_COARSE_LOCATION"), true);
    assert.equal(next.includes("INTERNET"), true);
  });

  it("replaces a fine-only grant with coarse", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
</manifest>
`;
    const next = stripFineLocation(xml);
    assert.equal(next.includes("ACCESS_FINE_LOCATION"), false);
    assert.equal(next.includes("ACCESS_COARSE_LOCATION"), true);
  });
});
