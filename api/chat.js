// api/chat.js
// Vercel Serverless Function (CommonJS 스타일)

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    // Vercel 기본 Node 런타임에서는 body가 이미 파싱되어 있을 수도 있고 아닐 수도 있어서 방어적으로 처리
    let body = req.body;
    if (!body) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    }

    const { message, sessionId } = body || {};

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

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    res.statusCode = n8nResponse.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(data));
  } catch (err) {
    console.error("Proxy error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify({
        error: "Proxy error",
        message: err.message || String(err),
      })
    );
  }
};
