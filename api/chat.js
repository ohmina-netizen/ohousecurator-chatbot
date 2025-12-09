// api/chat.js
// Vercel Serverless Function — 브라우저 요청을 external.co-workerhou.se의 n8n 웹훅으로 프록시
// + CORS / OPTIONS 처리 포함

const https = require("https");

// 허용할 Origin (필요하면 Vercel 환경변수 CHAT_ALLOWED_ORIGIN에 실제 도메인 넣고 쓰면 돼)
const ALLOWED_ORIGIN = process.env.CHAT_ALLOWED_ORIGIN || "*";

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // preflight 캐시 24시간
  res.setHeader("Access-Control-Max-Age", "86400");
}

module.exports = async (req, res) => {
  // ✅ preflight (OPTIONS) 처리
  if (req.method === "OPTIONS") {
    applyCors(res);
    res.statusCode = 204;
    return res.end();
  }

  // ✅ POST 외 메서드는 405
  if (req.method !== "POST") {
    applyCors(res);
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    applyCors(res);

    // body 파싱 (Vercel에서 req.body가 이미 있을 수도, 없을 수도 있어서 둘 다 케이스 처리)
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

    // 🔐 TLS 검증 느슨하게 (사내 인증서 이슈 방지용)
    const agent = new https.Agent({
      rejectUnauthorized: false,
    });

    // ⚠️ 여기 path는 실제 쓰는 external n8n 웹훅에 맞게 골라 써
    //   - 테스트: "/n8n/webhook-test/public-chatbot"
    //   - 운영:   "/n8n/webhook/public-chatbot"
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
        applyCors(res);
        res.statusCode = proxyRes.statusCode || 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        try {
          const parsed = JSON.parse(data);
          return res.end(JSON.stringify(parsed));
        } catch {
          return res.end(JSON.stringify({ raw: data }));
        }
      });
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error (https):", err);
      applyCors(res);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");

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
    applyCors(res);
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
