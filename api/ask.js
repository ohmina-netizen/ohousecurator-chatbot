// api/ask.js

function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}

async function kvSet(key, obj, exSec = 300) {
  const base = process.env.KV_REST_API_URL;
  const value = encodeURIComponent(JSON.stringify(obj));
  const url = `${base}/set/${encodeURIComponent(key)}/${value}?EX=${exSec}`;
  const r = await fetch(url, { method: "POST", headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV SET failed: ${r.status}`);
}

// n8n Webhook을 백그라운드로 호출
async function triggerN8n(payload) {
  const webhook = process.env.N8N_WEBHOOK_URL;
  if (!webhook) throw new Error("Missing N8N_WEBHOOK_URL");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500); // 2.5초 정도만 기다렸다 끊기

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    // n8n 트리거 실패해도 /api/ask 자체는 200 주고,
    // /api/result 폴링 쪽에서 타임아웃 메시지로 처리하게 놔둔다.
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const body = typeof req.body === "object" ? req.body : {};
    const message = (body.message ?? "").toString().trim();
    const sessionId = (body.sessionId ?? `sess_${Math.random().toString(36).slice(2)}`).toString();
    const requestId = (body.requestId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`).toString();

    if (!message) return res.status(400).json({ error: "missing message" });

    // 1) KV에 pending 상태로 저장
    await kvSet(
      requestId,
      { status: "pending", createdAt: Date.now(), sessionId, message },
      300
    );

    // 2) n8n Webhook 비동기 트리거
    triggerN8n({ message, sessionId, requestId });

    // 3) 클라이언트에는 requestId만 응답
    return res.status(200).json({ requestId });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
