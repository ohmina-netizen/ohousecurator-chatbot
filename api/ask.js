// api/ask.js
import { waitUntil } from '@vercel/functions';

function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}

async function kvSet(key, obj, exSec = 180) {
  const base = process.env.KV_REST_API_URL;
  const value = encodeURIComponent(JSON.stringify(obj));
  const url = `${base}/set/${encodeURIComponent(key)}/${value}?EX=${exSec}`;
  const r = await fetch(url, { method: "POST", headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV SET failed: ${r.status}`);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const body = typeof req.body === "object" ? req.body : {};
    const message = (body.message ?? "").toString().trim();
    const sessionId = (body.sessionId ?? `sess_${Math.random().toString(36).slice(2)}`).toString();
    const requestId = (body.requestId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`).toString();

    if (!message) return res.status(400).json({ error: "missing message" });

    // 1) pending 저장
    await kvSet(requestId, { status: "pending", createdAt: Date.now(), sessionId }, 180);

    // 2) 즉시 ACK 반환 (모바일 타임아웃 회피)
    res.status(200).json({ requestId });

    // 3) 백그라운드 작업을 "끊기지 않게" waitUntil에 걸기
    waitUntil((async () => {
      const N8N = process.env.N8N_WEBHOOK_URL;
      if (!N8N) {
        await kvSet(requestId, { status: "error", error: "N8N_WEBHOOK_URL is missing", updatedAt: Date.now() }, 180);
        return;
      }

      try {
        const r = await fetch(N8N, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, sessionId, requestId }),
        });

        const txt = await r.text();
        let data = {};
        try { data = JSON.parse(txt); } catch {}

        const answer =
          data.answer ?? data.output ?? data.text ??
          "답변을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";

        await kvSet(requestId, { status: "ready", answer, updatedAt: Date.now() }, 180);
      } catch (e) {
        await kvSet(requestId, { status: "error", error: String(e?.message || e), updatedAt: Date.now() }, 180);
      }
    })());

  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
