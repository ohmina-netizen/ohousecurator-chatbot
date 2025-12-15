// api/ask.js

async function kvSet(key, obj, exSec = 300) {
  const base = process.env.KV_REST_API_URL;
  const value = encodeURIComponent(JSON.stringify(obj));
  const url = `${base}/set/${encodeURIComponent(key)}/${value}?EX=${exSec}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    },
  });
  if (!r.ok) throw new Error(`KV SET failed: ${r.status}`);
}

// 🔥 n8n 웹훅 트리거 (백그라운드)
async function triggerN8n({ message, sessionId, requestId }) {
  const url = process.env.N8N_WEBHOOK_URL;

  if (!url) {
    console.error("[ASK] N8N_WEBHOOK_URL is not set");
    return;
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId, requestId }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(
        `[ASK] n8n webhook failed: ${resp.status} ${resp.statusText} ${text}`
      );
    } else {
      console.log("[ASK] n8n webhook triggered OK");
    }
  } catch (err) {
    console.error("[ASK] n8n webhook network error:", err);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const body = typeof req.body === "object" ? req.body : {};
    const message = (body.message ?? "").toString().trim();
    const sessionId = (
      body.sessionId ?? `sess_${Math.random().toString(36).slice(2)}`
    ).toString();
    const requestId = (
      body.requestId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
    ).toString();

    if (!message) {
      return res.status(400).json({ error: "missing message" });
    }

    // 1) Upstash에 pending 상태 저장
    await kvSet(requestId, {
      status: "pending",
      createdAt: Date.now(),
      sessionId,
      message,
    });

    // 2) n8n 워크플로우 비동기 실행
    triggerN8n({ message, sessionId, requestId });

    // 3) 프론트에는 requestId만 바로 반환
    return res.status(200).json({ requestId });
  } catch (e) {
    console.error("[ASK] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
