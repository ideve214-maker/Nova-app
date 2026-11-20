import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePasswordChange, interpretPasswordChange } from "./password-rules.ts";

test("前端校验：长度、字母+数字、一致、不能和旧密码相同", () => {
  assert.equal(validatePasswordChange("", "abc12345", "abc12345"), "请输入当前密码");
  assert.equal(validatePasswordChange("old12345", "", ""), "请输入新密码");
  assert.match(validatePasswordChange("old12345", "a1b2", "a1b2") || "", /8–128/);
  assert.match(validatePasswordChange("old12345", "a1".repeat(65), "a1".repeat(65)) || "", /8–128/);
  assert.match(validatePasswordChange("old12345", "abcdefgh", "abcdefgh") || "", /字母和数字/);
  assert.match(validatePasswordChange("old12345", "12345678", "12345678") || "", /字母和数字/);
  assert.match(validatePasswordChange("abc12345", "abc12345", "abc12345") || "", /不能和当前密码相同/);
  assert.match(validatePasswordChange("old12345", "abc12345", "abc12346") || "", /不一致/);
  assert.equal(validatePasswordChange("old12345", "abc12345", "abc12345"), null);
  assert.equal(validatePasswordChange("old12345", "a1".repeat(64), "a1".repeat(64)), null);
});

test("接口结果：成功 / 当前密码错 / 太弱 / 404 未支持 / 401 失效", () => {
  assert.deepEqual(interpretPasswordChange(200, { ok: true }), { kind: "ok" });
  assert.equal(interpretPasswordChange(401, { error: { code: "WRONG_PASSWORD", message: "x" } }).kind, "wrong");
  assert.equal(interpretPasswordChange(400, { error: { code: "WRONG_PASSWORD" } }).kind, "wrong");
  const weak = interpretPasswordChange(400, { error: { code: "WEAK_PASSWORD", message: "密码太弱" } });
  assert.equal(weak.kind, "weak"); assert.equal((weak as { message: string }).message, "密码太弱");
  assert.equal(interpretPasswordChange(404, { error: { code: "NOT_FOUND" } }).kind, "unsupported");
  assert.equal(interpretPasswordChange(404, null).kind, "unsupported");
  assert.equal(interpretPasswordChange(401, { error: { code: "UNAUTHORIZED" } }).kind, "expired");
  assert.equal(interpretPasswordChange(0, null, "超时").kind, "error");
  assert.equal(interpretPasswordChange(500, { error: { message: "服务器错误" } }).kind, "error");
});
