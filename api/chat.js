// api/chat.js
// Vercel Serverless Function — https + TLS 검증 끄기(rejectUnauthorized: false)

const https = require("https");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    // body 파싱
    let body = req.body;
    if (!body) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      body = JSON.parse(raw);
    }

    const postData = JSON.stringify({
      message: body.message,
      sessionId: body.sessionId,
    });

    // 🔐 TLS 검증을 끈 https.Agent
    const agent = new https.Agent({
      rejectUnauthorized: false,
    });

    const options = {
      hostname: "external.co-workerhou.se",
      port: 443,
      path: "/n8n/webhook/public-chatbot",
      method: "POST",
      agent,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };
    

    const proxyReq = https.request(options, (proxyRes) => {
      let data = "";

      proxyRes.on("data", (chunk) => {
        data += chunk;
      });

      proxyRes.on("end", () => {
        res.statusCode = proxyRes.statusCode || 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        try {
          // n8n 이 JSON을 주는 경우
          const parsed = JSON.parse(data);
          return res.end(JSON.stringify(parsed));
        } catch {
          // JSON 이 아니면 raw 로 감싸서 넘김
          return res.end(JSON.stringify({ raw: data }));
        }
      });
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error (https):", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");

      // AggregateError 안에 들어있는 세부 에러도 같이 내려줌
      const details = {
        message: err.message || String(err),
        name: err.name,
        stack: err.stack,
      };
      if (err.errors && Array.isArray(err.errors)) {
        details.inner = err.errors.map((e) => ({
          name: e.name,
          message: e.message,
          code: e.code,
        }));
      }

      return res.end(
        JSON.stringify({
          error: "Proxy error (https)",
          details,
        })
      );
    });

    proxyReq.write(postData);
    proxyReq.end();
  } catch (err) {
    console.error("Unexpected server error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify({
        error: "Unexpected server error",
        message: err.message || String(err),
      })
    );
  }
};
