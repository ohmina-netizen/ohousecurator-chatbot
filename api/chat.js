// api/chat.js
// Vercel Serverless Function — https + TLS 검증 끄기(rejectUnauthorized: false)

const http = require("http");
const https = require("https");

const ALLOWED_ORIGIN = process.env.CHAT_ALLOWED_ORIGIN || "*";
const TARGET_HOST = process.env.N8N_HOST || "external.co-workerhou.se";
const TARGET_HTTPS_PORT = Number(process.env.N8N_HTTPS_PORT || 443);
const TARGET_HTTP_PORT = Number(process.env.N8N_HTTP_PORT || 80);
const TARGET_PATH = process.env.N8N_PATH || "/n8n/webhook/public-chatbot";
const REQUEST_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS || 20000);
const PAYLOAD_FORMAT = (process.env.N8N_PAYLOAD_FORMAT || "form").toLowerCase();

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400"); // cache preflight for 24h
}

function parseIncomingPayload(rawBody, contentType = "") {
  const normalized = (rawBody || "").toString("utf8").trim();
  if (!normalized) return {};

  const isForm = contentType.includes("application/x-www-form-urlencoded");
  if (isForm) {
    const params = new URLSearchParams(normalized);
    const parsed = {};
    for (const [key, value] of params.entries()) {
      parsed[key] = value;
    }
    return parsed;
  }

  return JSON.parse(normalized);
}

function buildUpstreamPayload(message, sessionId) {
  if (PAYLOAD_FORMAT === "json") {
    return {
      body: JSON.stringify({ message, sessionId }),
      contentType: "application/json",
    };
  }

  const params = new URLSearchParams();
  params.set("message", message);
  if (sessionId) params.set("sessionId", sessionId);

  return {
    body: params.toString(),
    contentType: "application/x-www-form-urlencoded; charset=utf-8",
  };
}

function performProxyRequest(protocol, postData, contentType) {
  const isHttps = protocol === "https";

  const options = {
    hostname: TARGET_HOST,
    port: isHttps ? TARGET_HTTPS_PORT : TARGET_HTTP_PORT,
    path: TARGET_PATH,
    method: "POST",
    headers: {
      "Content-Type": contentType || "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
    family: 4,
  };

  if (isHttps) {
    options.agent = new https.Agent({ rejectUnauthorized: false });
  }

  const requester = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const upstreamReq = requester.request(options, (upstreamRes) => {
      let data = "";

      upstreamRes.on("data", (chunk) => {
        data += chunk;
      });

      upstreamRes.on("end", () => {
        resolve({
          statusCode: upstreamRes.statusCode || 200,
          body: data,
        });
      });
    });

    upstreamReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error("Upstream timeout"));
    });

    upstreamReq.on("error", (err) => {
      reject(err);
    });

    upstreamReq.write(postData);
    upstreamReq.end();
  });
}

async function proxyToN8n(postData, contentType) {
  try {
    return await performProxyRequest("https", postData, contentType);
  } catch (httpsError) {
    console.error("HTTPS proxy failed, retrying via HTTP", httpsError);

    try {
      return await performProxyRequest("http", postData, contentType);
    } catch (httpError) {
      const aggregate = new Error("Both HTTPS and HTTP proxy requests failed");
      aggregate.name = "UpstreamProxyError";
      aggregate.errors = [httpsError, httpError];
      throw aggregate;
    }
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    applyCors(res);
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    applyCors(res);
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    // body 파싱 (JSON + x-www-form-urlencoded 지원)
    let body = req.body;
    let rawBody = null;
    let contentType = req.headers["content-type"] || "";

    if (!body || typeof body === "string") {
      let raw = body;
      if (!raw) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        raw = Buffer.concat(chunks);
      }
      rawBody = (raw || "").toString("utf8");
      body = parseIncomingPayload(rawBody, contentType);
    } else if (typeof body === "object") {
      rawBody = JSON.stringify(body);
      contentType = "application/json";
    }

    const message = (body.message || "").toString().trim();
    const sessionId = (body.sessionId || "").toString().trim();

    if (!message) {
      applyCors(res);
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(
        JSON.stringify({
          error: "Missing message",
          raw: rawBody,
          contentType,
        })
      );
    }

    const { body: upstreamBody, contentType: upstreamContentType } =
      buildUpstreamPayload(message, sessionId);

    const upstreamRes = await proxyToN8n(upstreamBody, upstreamContentType);

    applyCors(res);
    res.statusCode = upstreamRes.statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    try {
      // n8n 이 JSON을 주는 경우
      const parsed = JSON.parse(upstreamRes.body);
      return res.end(JSON.stringify(parsed));
    } catch {
      // JSON 이 아니면 raw 로 감싸서 넘김
      return res.end(JSON.stringify({ raw: upstreamRes.body }));
    }
  } catch (err) {
    console.error("Unexpected server error:", err);
    applyCors(res);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify({
        error: "Unexpected server error",
        message: err.message || String(err),
        details:
          err.errors && Array.isArray(err.errors)
            ? err.errors.map((e) => ({
                name: e.name,
                message: e.message,
                code: e.code,
              }))
            : undefined,
      })
    );
  }
};
