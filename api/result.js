// api/result.js

function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}

async function kvGet(key) {
  const base = process.env.KV_REST_API_URL;
  const url = `${base}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV GET failed: ${r.status}`);
  const data = await r.json();
  return data?.result ?? null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const requestId = (req.query.requestId ?? "").toString().trim();
    if (!requestId) return res.status(400).json({ error: "missing requestId" });

    const raw = await kvGet(requestId);
    if (!raw) return res.status(404).json({ error: "not found" });

    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "bad stored json" });
    }

    if (obj.status === "done") {
      return res.status(200).json({ answer: obj.answer, from: obj.from ?? "ai" });
    }

    const ageMs = Date.now() - (obj.createdAt ?? Date.now());
    if (ageMs > 120000) {
      // 2분 넘게 걸리면 UX용 타임아웃 메시지
      return res.status(200).json({
        answer: "답변이 지연되고 있어요. 잠시 후 다시 시도해 주세요.",
        from: "timeout",
      });
    }

    return res.status(202).json({ status: obj.status ?? "pending" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
