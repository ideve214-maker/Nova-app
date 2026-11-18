/**
 * 按住说话录音：用 Web Audio 采集麦克风，停下后重采样成 16 kHz 单声道 16 位 WAV（data URI）。
 * 智谱 GLM-ASR 和阿里云 qwen-audio ASR 都直接收这种 wav。最长 25 秒自动停止。
 * App 内使用需要原生麦克风权限：iOS Info.plist 的 NSMicrophoneUsageDescription，Android 的 RECORD_AUDIO。
 */
export const MAX_RECORD_MS = 25000;
const TARGET_RATE = 16000;

export type Recording = { stop: () => Promise<string | null>; cancel: () => void };

export function canRecord(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function"
    && typeof window !== "undefined" && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function toDataUri(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "data:audio/wav;base64," + btoa(bin);
}

export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  node.onaudioprocess = (e) => { const d = new Float32Array(e.inputBuffer.getChannelData(0)); chunks.push(d); total += d.length; };
  source.connect(node);
  node.connect(ctx.destination);
  const timer = window.setTimeout(() => onAutoStop?.(), MAX_RECORD_MS);
  let done = false;
  const teardown = () => {
    if (done) return; done = true;
    window.clearTimeout(timer);
    try { node.disconnect(); source.disconnect(); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };
  return {
    cancel: teardown,
    stop: async () => {
      const rate = ctx.sampleRate;
      teardown();
      if (total < rate * 0.4) return null; // 少于 0.4 秒当作误触
      const all = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { all.set(c, off); off += c.length; }
      return toDataUri(encodeWav(downsample(all, rate)));
    },
  };
}

export function speak(text: string) {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 300));
    u.lang = "zh-CN";
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch { /* 朗读失败不影响使用 */ }
}
export function stopSpeaking() {
  try { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* ignore */ }
}
