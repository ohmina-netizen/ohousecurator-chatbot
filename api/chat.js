// api/chat.js

export default async function handler(req, res) {
  // 1) 메서드 체크
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    // 2) 요청 바디 파싱
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body || {};

    const message = (body.message ?? "").toString().trim();
    const sessionId = (body.sessionId ?? "").toString();

    if (!message) {
      res.status(400).json({ error: "missing message" });
      return;
    }

    // 3) n8n Webhook URL (환경변수 → 없으면 기본값)
    const n8nUrl =
      process.env.N8N_WEBHOOK_URL ||
      "https://external.co-workerhou.se/n8n/webhook/public-chatbot";

    // 4) n8n으로 그대로 프록시
    const n8nResp = await fetch(n8nUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message,
        sessionId,
        from: "web-ui", // 필요하면 n8n에서 참고
      }),
    });

    const text = await n8nResp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!n8nResp.ok) {
      // n8n이 4xx/5xx 응답 준 경우 그대로 에러 표시
      res.status(n8nResp.status).json({
        error: "n8n_error",
        status: n8nResp.status,
        body: data,
      });
      return;
    }

    // 5) n8n 응답을 그대로 프론트에 전달
    res.status(200).json(data);
  } catch (e) {
    console.error("[api/chat] error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
}
