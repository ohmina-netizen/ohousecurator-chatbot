// api/chat.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, sessionId } = req.body ?? {};

    // 여기서 n8n 웹훅으로 서버-서버 요청
    const n8nResponse = await fetch(
      "https://n8n.co-workerhou.se/webhook/public-chatbot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId }),
      }
    );

    const text = await n8nResponse.text();

    // n8n 응답이 JSON이면 파싱, 아니면 raw로 감싸기
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return res.status(n8nResponse.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({
      error: "Proxy error",
      message: err.message || String(err),
    });
  }
}
