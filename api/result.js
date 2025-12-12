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

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const requestId = (req.query.requestId ?? "").toString();
    if (!requestId) return res.status(400).json({ error: "missing requestId" });

    const out = await kvGetRaw(requestId);
    if (!out?.result) return res.status(404).json({ status: "not_found" });

    let state;
    try { state = JSON.parse(out.result); }
    catch { return res.status(500).json({ status: "error", error: "bad stored JSON" }); }

    if (state.status === "ready") return res.status(200).json({ status: "ready", answer: state.answer });
    if (state.status === "error") return res.status(200).json({ status: "error", error: state.error });

    // pending/processing 이면 여기서 처리
    const N8N = process.env.N8N_WEBHOOK_URL;
    if (!N8N) {
      await kvSet(requestId, { status: "error", error: "N8N_WEBHOOK_URL is missing", updatedAt: Date.now() }, 300);
      return res.status(200).json({ status: "error", error: "N8N_WEBHOOK_URL is missing" });
    }

    // ✅ 락 대체: pending이면 processing으로 먼저 바꿔버린다
    // (동시에 여러 요청이 들어와도, 둘 다 processing으로 덮어쓸 수는 있지만
    //  실제로는 대부분 첫 호출이 먼저 진행하고, 나머지는 202로 돌게 됨)
    if (state.status === "pending") {
      await kvSet(requestId, { ...state, status: "processing", startedAt: Date.now() }, 300);

      try {
            const r = await fetch(N8N, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: state.message, sessionId: state.sessionId, requestId }),
            });
            
            const txt = await r.text();
            
            // ✅ 여기 추가: HTTP 실패면 에러로 처리해서 KV에 남기기
            if (!r.ok) {
              throw new Error(`N8N HTTP ${r.status}: ${txt.slice(0, 300)}`);
            }
            
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

    // 아직 처리중
    return res.status(202).json({ status: "pending" });

  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e?.message || e) });
  }
}
