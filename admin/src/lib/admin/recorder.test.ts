import test from "node:test";
import assert from "node:assert/strict";
import { downsample, encodeWav } from "./recorder.ts";

test("录音重采样到 16k 并编码成标准 WAV 头", () => {
  const input = new Float32Array(48000).fill(0.5);
  const out = downsample(input, 48000);
  assert.equal(out.length, 16000);
  const wav = encodeWav(out);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(wav.length, 44 + 16000 * 2);
  assert.equal(v.getInt16(44, true), Math.trunc(0.5 * 0x7fff));
});
