// api/chat.js
// Vercel Serverless Function — fetch 대신 https 사용

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
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }

    const postData = JSON.stringify({
      message: body.message,
      sessionId: body.sessionId,
    });

    const options = {
      hostname: "n8n.co-workerhou.se",
      port: 443,
      path: "/webhook/public-chatbot",
      method: "POST",
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
          return res.end(JSON.stringify(JSON.parse(data)));
        } catch (e) {
          return res.end(JSON.stringify({ raw: data }));
        }
      });
    });

    proxyReq.on("error", (err) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(
        JSON.stringify({
          error: "Proxy error (https)",
          message: err.message || String(err),
        })
      );
    });

    proxyReq.write(postData);
    proxyReq.end();
  } catch (err) {
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
