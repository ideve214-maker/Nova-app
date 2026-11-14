import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addFineLocationRemoveMarker, stripFineLocation } from "./strip-fine-location.mjs";

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

describe("addFineLocationRemoveMarker", () => {
  const app = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;
  it("adds tools:node=remove for fine location so merged plugins cannot add it", () => {
    const next = addFineLocationRemoveMarker(stripFineLocation(app));
    assert.match(next, /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
    assert.match(next, /ACCESS_FINE_LOCATION" tools:node="remove" \/>/);
  });
  it("is stable on a second run and the marker survives stripFineLocation", () => {
    const once = addFineLocationRemoveMarker(stripFineLocation(app));
    const twice = addFineLocationRemoveMarker(stripFineLocation(once));
    assert.equal(twice, once);
    assert.equal(stripFineLocation(once).includes("ACCESS_COARSE_LOCATION"), false);
  });
});
