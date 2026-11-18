import { useEffect, useRef, useState } from "react";
import { Keyboard, Mic, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import { aiAsr, aiCancel, aiChat, aiConfirm, aiStatus, type AiPending, type AiStatus } from "@/lib/admin/ai-api";
import { canRecord, speak, startRecording, stopSpeaking, type Recording } from "@/lib/admin/recorder";
import { cn, Screen } from "./ui";

type Msg = { id: number; role: "user" | "assistant"; text: string; pending?: AiPending | null; state?: "done" | "cancelled" | "failed"; note?: string };

const CONFIRM_RE = /^(确认|确定|确认执行|执行|是的?|对|好的?|可以|没问题|中|行|妥了|嗯)[。.!！\s]*$/;
const CANCEL_RE = /^(取消|算了|不要|不用了?|别|不执行|不确认|拉倒)[。.!！\s]*$/;
const EXAMPLES = ["今天有多少待处理举报？", "把 ID 17 的账号封了", "给 ID 23 开 30 天会员", "搜一下用户 小明"];

// 离开页面再回来时保留对话（只在内存里，退出登录或重启就清空）。
let saved: Msg[] = [];
let seq = 1;
let speakOn = false;

export function AssistantScreen() {
  const back = useAdmin((s) => s.back);
  const [msgs, setMsgs] = useState<Msg[]>(saved);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusErr, setStatusErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(canRecord());
  const [rec, setRec] = useState<Recording | null>(null);
  const [tts, setTts] = useState(speakOn);
  const [, tick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saved = msgs; listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);
  useEffect(() => { void aiStatus().then((r) => (r.ok ? setStatus(r.data) : setStatusErr(r.error))); }, []);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => { window.clearInterval(t); stopSpeaking(); }; }, []);

  const open = [...msgs].reverse().find((m) => m.pending && m.pending.status === "pending" && !m.state && m.pending.expiresAt > Date.now());
  const push = (m: Omit<Msg, "id">) => setMsgs((list) => [...list, { ...m, id: seq++ }].slice(-60));
  const markPending = (pid: string, state: Msg["state"], note?: string) =>
    setMsgs((list) => list.map((m) => (m.pending && m.pending.id === pid ? { ...m, state, note } : m)));
  const say = (t: string) => { push({ role: "assistant", text: t }); if (tts) speak(t); };

  async function decide(p: AiPending, yes: boolean) {
    setBusy(true);
    const r = yes ? await aiConfirm(p.id) : await aiCancel(p.id);
    setBusy(false);
    if (r.ok) { markPending(p.id, yes ? "done" : "cancelled"); say(r.data.reply || (yes ? "已执行" : "已取消")); }
    else { markPending(p.id, "failed", r.error); say(r.error); }
  }

  async function send(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    setText("");
    push({ role: "user", text: t });
    // 说“确认 / 算了”时把待确认操作的 id 带上；是否真的执行由服务器判断（必须是本人、同一次登录、未过期）。
    if (open && (CONFIRM_RE.test(t) || CANCEL_RE.test(t))) { await decide(open.pending!, CONFIRM_RE.test(t)); return; }
    setBusy(true);
    const history = msgs.slice(-12).map((m) => ({ role: m.role, content: m.text }));
    const r = await aiChat(t, history);
    setBusy(false);
    if (!r.ok) { say(r.error); return; }
    push({ role: "assistant", text: r.data.reply, pending: r.data.pending });
    if (tts) speak(r.data.reply);
  }

  async function startRec() {
    if (rec || busy) return;
    stopSpeaking();
    try {
      const h = await startRecording(() => void stopRec(h));
      setRec(h);
    } catch {
      say("打不开麦克风。请在系统设置里允许 VEXO 管理端使用麦克风，或改用文字。");
      setVoice(false);
    }
  }
  async function stopRec(h = rec) {
    if (!h) return;
    setRec(null);
    const audio = await h.stop();
    if (!audio) return;
    setBusy(true);
    const r = await aiAsr(audio);
    setBusy(false);
    if (!r.ok) { say(r.error); return; }
    if (!r.data.text.trim()) { say("没听清，请再说一遍。"); return; }
    await send(r.data.text);
  }

  const notReady = status && !status.configured;
  return (
    <Screen
      title="AI 助手"
      onBack={back}
      right={
        <button type="button" aria-label={tts ? "关闭朗读" : "朗读回复"} className="grid size-11 place-items-center text-muted" onClick={() => { speakOn = !tts; setTts(!tts); if (tts) stopSpeaking(); }}>
          {tts ? <Volume2 className="size-5 text-primary" /> : <VolumeX className="size-5" />}
        </button>
      }
      footer={
        <div className="px-3 py-2 pb-safe">
          {voice ? (
            <div className="flex items-center gap-2">
              <button type="button" aria-label="改用键盘" className="grid size-11 shrink-0 place-items-center rounded-full bg-subtle" onClick={() => setVoice(false)}>
                <Keyboard className="size-5" />
              </button>
              <button
                type="button"
                disabled={busy || !!notReady}
                className={cn("h-11 flex-1 select-none rounded-full text-[15px] font-semibold disabled:opacity-50", rec ? "bg-danger text-on-primary" : "bg-primary text-on-primary")}
                style={{ touchAction: "none", WebkitUserSelect: "none" }}
                onPointerDown={(e) => { e.preventDefault(); void startRec(); }}
                onPointerUp={() => void stopRec()}
                onPointerCancel={() => { rec?.cancel(); setRec(null); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {rec ? "松开发送（普通话、山东话都行）" : busy ? "正在处理…" : "按住说话"}
              </button>
            </div>
          ) : (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
              {canRecord() && (
                <button type="button" aria-label="改用语音" className="grid size-11 shrink-0 place-items-center rounded-full bg-subtle" onClick={() => setVoice(true)}>
                  <Mic className="size-5" />
                </button>
              )}
              <input className="h-11 min-w-0 flex-1 rounded-full border border-line bg-subtle px-4 text-[16px] outline-none focus:border-primary" value={text} onChange={(e) => setText(e.target.value)} placeholder={open ? "说“确认”执行，或“算了”取消" : "想让我做什么？"} enterKeyHint="send" />
              <button type="submit" aria-label="发送" disabled={busy || !text.trim() || !!notReady} className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary disabled:opacity-50">
                <Send className="size-5" />
              </button>
            </form>
          )}
        </div>
      }
    >
      <div ref={listRef} className="space-y-2.5 px-4 pb-3 pt-3">
        {statusErr && <p className="rounded-xl nova-warn-soft px-3 py-2 text-[13px] leading-5">{statusErr}</p>}
        {notReady && <p className="rounded-xl nova-warn-soft px-3 py-2 text-[13px] leading-5">服务器还没有配置智谱密钥，AI 助手暂时不能用。</p>}
        {msgs.length === 0 && (
          <div className="rounded-card bg-surface px-4 py-4 shadow-card">
            <div className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-primary" />我能帮你查数据、处理后台事务</div>
            <p className="mt-1.5 text-[13px] leading-5 text-muted">改动数据前我会先跟你确认，你说“确认”或点按钮才会执行。付款和退款请到付款审核页面手动处理。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className="rounded-full bg-subtle px-3 py-1.5 text-[13px]" onClick={() => void send(e)}>{e}</button>
              ))}
            </div>
            {status && <p className="mt-3 text-[11px] text-muted">模型：{status.provider} {status.model} · 语音：{status.asr.map((a) => `${a.provider}${a.ready ? "" : "（未配置）"}`).join(" → ")}</p>}
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[15px] leading-6", m.role === "user" ? "bg-primary text-on-primary" : "bg-surface shadow-card")}>
              {sanitizeText(m.text)}
              {m.pending && (
                <PendingBar p={m.pending} state={m.state} note={m.note} busy={busy} onDecide={(yes) => void decide(m.pending!, yes)} />
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-center text-[12px] text-muted">正在思考…</p>}
      </div>
    </Screen>
  );
}

function PendingBar({ p, state, note, busy, onDecide }: { p: AiPending; state?: Msg["state"]; note?: string; busy: boolean; onDecide: (yes: boolean) => void }) {
  const left = Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000));
  if (state === "done") return <p className="mt-2 text-[12px] font-semibold text-primary">已确认并执行</p>;
  if (state === "cancelled") return <p className="mt-2 text-[12px] text-muted">已取消</p>;
  if (state === "failed") return <p className="mt-2 text-[12px] text-danger">{note || "执行失败"}</p>;
  if (left <= 0) return <p className="mt-2 text-[12px] text-muted">已过期，请重新说一遍</p>;
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <div className="flex gap-2">
        <button type="button" disabled={busy} className="h-9 flex-1 rounded-full bg-subtle text-[14px] font-semibold disabled:opacity-50" onClick={() => onDecide(false)}>取消</button>
        <button type="button" disabled={busy} className="h-9 flex-1 rounded-full bg-primary text-[14px] font-semibold text-on-primary disabled:opacity-50" onClick={() => onDecide(true)}>确认执行</button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} 后失效 · 仅限你本人确认</p>
    </div>
  );
}
