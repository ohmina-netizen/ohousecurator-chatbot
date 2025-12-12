// api/ask.js  (No @vercel/functions needed)

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
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

    // 1) pending 저장
    await kvSet(requestId, { status: "pending", createdAt: Date.now(), sessionId }, 180);

    const N8N = process.env.N8N_WEBHOOK_URL;
    if (!N8N) {
      await kvSet(requestId, { status: "error", error: "N8N_WEBHOOK_URL is missing", updatedAt: Date.now() }, 180);
      return res.status(200).json({ requestId }); // 프론트가 /api/result에서 error 받게 됨
    }

    // 2) n8n을 "짧게" 기다려본다 (1.8초)
    // - 빨리 끝나면 ready 저장까지 해두고 ACK
    // - 오래 걸리면 그냥 ACK 먼저 보내고 폴링로직으로 간다
    let settledFast = false;

    try {
      const r = await fetchWithTimeout(
        N8N,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, sessionId, requestId }),
        },
        1800
      );

      const txt = await r.text();
      let data = {};
      try { data = JSON.parse(txt); } catch {}

      const answer =
        data.answer ?? data.output ?? data.text ??
        "답변을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";

      await kvSet(requestId, { status: "ready", answer, updatedAt: Date.now() }, 180);
      settledFast = true;
    } catch (e) {
      // 타임아웃(AbortError)인 경우: 그냥 ACK하고 폴링로직으로
      // 다른 에러면 error 저장
      const msg = String(e?.name || "") === "AbortError"
        ? null
        : String(e?.message || e);

      if (msg) {
        await kvSet(requestId, { status: "error", error: msg, updatedAt: Date.now() }, 180);
      }
    }

    // 3) ACK 반환
    // (settledFast여도 requestId만 반환하면 프론트가 result에서 바로 ready를 받음)
    return res.status(200).json({ requestId });

  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
