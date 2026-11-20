import { test } from "node:test";
import assert from "node:assert/strict";
import { keyboardInset } from "./keyboard.ts";

const base = { nativeHeight: 0, iosNative: false, androidNative: false, baselineHeight: 852, innerHeight: 852, viewportHeight: 852, viewportOffsetTop: 0 };

test("iOS 原生 resize:none：直接用插件键盘高度", () => {
  assert.equal(keyboardInset({ ...base, iosNative: true, nativeHeight: 336 }), 336);
  assert.equal(keyboardInset({ ...base, iosNative: true, nativeHeight: 0 }), 0);
});

test("Android 原生：WebView 没缩时全额让位", () => {
  assert.equal(keyboardInset({ ...base, androidNative: true, nativeHeight: 300 }), 300);
});

test("Android 原生：系统已经把 WebView 缩小（adjustResize）时不重复让位", () => {
  assert.equal(keyboardInset({ ...base, androidNative: true, nativeHeight: 300, innerHeight: 552 }), 0);
  assert.equal(keyboardInset({ ...base, androidNative: true, nativeHeight: 300, innerHeight: 652 }), 100);
});

test("Android 原生：键盘收起时为 0", () => {
  assert.equal(keyboardInset({ ...base, androidNative: true, nativeHeight: 0, innerHeight: 700 }), 0);
});

test("浏览器：按 visualViewport 计算被盖住的部分", () => {
  assert.equal(keyboardInset({ ...base, viewportHeight: 480 }), 372);
  assert.equal(keyboardInset({ ...base, viewportHeight: 480, viewportOffsetTop: 20 }), 352);
});

test("浏览器：地址栏伸缩（小于 80px）不算键盘", () => {
  assert.equal(keyboardInset({ ...base, viewportHeight: 800 }), 0);
});

test("浏览器：interactive-widget=resizes-content 已缩小布局时为 0", () => {
  assert.equal(keyboardInset({ ...base, innerHeight: 480, viewportHeight: 480 }), 0);
});
