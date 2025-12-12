// api/result.js

function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}

async function kvGetRaw(key) {
  const base = process.env.KV_REST_API_URL;
  const url = `${base}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: "GET", headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV GET failed: ${r.status}`);
  return r.json(); // { result: "<string|null>" }
}

async function kvSet(key, obj, exSec = 300) {
  const base = process.env.KV_REST_API_URL;
  const value = encodeURIComponent(JSON.stringify(obj));
  const url = `${base}/set/${encodeURIComponent(key)}/${value}?EX=${exSec}`;
  const r = await fetch(url, { method: "POST", headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV SET failed: ${r.status}`);
}

async function kvSetNx(key, valueStr, exSec = 60) {
  // Upstash REST는 보통 NX 옵션을 지원함: ?NX=1&EX=...
  const base = process.env.KV_REST_API_URL;
  const url = `${base}/set/${encodeURIComponent(key)}/${encodeURIComponent(valueStr)}?NX=1&EX=${exSec}`;
  const r = await fetch(url, { method: "POST", headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV SETNX failed: ${r.status}`);
  const data = await r.json().catch(() => ({}));
  // data.result가 "OK"이면 락 획득, null이면 이미 존재
  return data?.result === "OK";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const requestId = (req.query.requestId ?? "").toString();
    if (!requestId) return res.status(400).json({ error: "missing requestId" });

    const out = await kvGetRaw(requestId);
    if (!out?.result) return res.status(404).json({ status: "not_found" });

    let state;
    try { state = JSON.parse(out.result); } catch { state = { status: "error", error: "bad stored value" }; }

    if (state.status === "ready") return res.status(200).json({ status: "ready", answer: state.answer });
    if (state.status === "error") return res.status(200).json({ status: "error", error: state.error });

    // pending이면 여기서 "한 번만" n8n 호출 시도
    const N8N = process.env.N8N_WEBHOOK_URL;
    if (!N8N) {
      await kvSet(requestId, { status: "error", error: "N8N_WEBHOOK_URL is missing", updatedAt: Date.now() }, 300);
      return res.status(200).json({ status: "error", error: "N8N_WEBHOOK_URL is missing" });
    }

    // 락 획득(중복 실행 방지)
    const lockKey = `${requestId}:lock`;
    const gotLock = await kvSetNx(lockKey, "1", 60);

    if (gotLock) {
      try {
        const r = await fetch(N8N, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: state.message, sessionId: state.sessionId, requestId }),
        });

        const txt = await r.text();
        let data = {};
        try { data = JSON.parse(txt); } catch {}

        const answer =
          data.answer ?? data.output ?? data.text ??
          "답변을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";

        await kvSet(requestId, { status: "ready", answer, updatedAt: Date.now() }, 300);
      } catch (e) {
        await kvSet(requestId, { status: "error", error: String(e?.message || e), updatedAt: Date.now() }, 300);
      }
    }

    // 아직 처리 중이면 202
    return res.status(202).json({ status: "pending" });

  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e?.message || e) });
  }
}
