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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const body = typeof req.body === "object" ? req.body : {};
    const message = (body.message ?? "").toString().trim();
    const sessionId =
      (body.sessionId ?? `sess_${Math.random().toString(36).slice(2)}`).toString();
    const requestId =
      (body.requestId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`).toString();

    if (!message) {
      return res.status(400).json({ error: "missing message" });
    }

    // 1️⃣ KV에 pending 저장
    await kvSet(
      requestId,
      { status: "pending", createdAt: Date.now(), sessionId, message },
      300
    );

    // 2️⃣ 🔥 n8n Webhook 호출 (핵심!)
    fetch("https://n8n.co-workerhou.se/webhook/public-chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId,
        requestId,
      }),
    }).catch((err) => {
      console.error("n8n webhook call failed:", err);
    });

    // 3️⃣ 즉시 응답 (모바일 타임아웃 방지)
    return res.status(200).json({ requestId });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
