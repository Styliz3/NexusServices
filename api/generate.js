const { kv } = require("@vercel/kv");
const fetch = global.fetch;

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

function stripCodeFences(s = "") {
  return s.replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim();
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "MethodNotAllowed" });

    const { prompt, username, userId, projectId, model } = await readBody(req);
    if (!prompt || !username || !projectId)
      return res.status(400).json({ error: "BadRequest", message: "Missing prompt/username/projectId" });
    if (!process.env.GROQ_API_KEY)
      return res.status(500).json({ error: "MissingConfig", message: "Missing GROQ_API_KEY. Contact support." });

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        temperature: 0.6,
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content:
`Return ONLY JSON (no markdown):
{"entry":"index.html","files":[{"name":"index.html","content":"<!doctype html>..."},{"name":"style.css","content":"..."},{"name":"app.js","content":"..."}]}
Paths in <link>/<script src> must match file names.`
          },
          { role: "user", content: `Create a small working website for: ${prompt}.` }
        ]
      })
    });

    if (!groq.ok) {
      const detail = await groq.text();
      return res.status(groq.status).json({
        error: "GroqError",
        message: "Generation failed. Please try again. If this persists, contact support.",
        detail
      });
    }

    const data = await groq.json();
    let raw = stripCodeFences(data?.choices?.[0]?.message?.content || "");
    let manifest;
    try { manifest = JSON.parse(raw); }
    catch {
      manifest = {
        entry: "index.html",
        files: [{ name: "index.html", content: raw || "<!doctype html><title>Empty</title>" }]
      };
    }

    // ensure HTML doctype
    manifest.files = (manifest.files || []).map(f => {
      if (f.name.toLowerCase().endsWith(".html") && !/^<!doctype html>/i.test(f.content.trim())) {
        f.content = "<!doctype html>\n" + f.content;
      }
      return f;
    });

    // persist
    const userKey = userId || username;
    let nextVersion = 1;
    if (kv) {
      const versionKey = `project:${userKey}:${projectId}:version`;
      const cur = await kv.get(versionKey);
      nextVersion = (cur || 0) + 1;
      await kv.set(versionKey, nextVersion);
      await kv.set(`project:${userKey}:${projectId}:v${nextVersion}`, manifest);
      await kv.sadd(`projects:${userKey}`, JSON.stringify({ projectId }));
    }

    res.status(200).json({ projectId, version: nextVersion, manifest });
  } catch (err) {
    res.status(500).json({
      error: "ServerError",
      message: "We couldn't generate your site. Please try again. If this continues, contact support.",
      detail: String(err)
    });
  }
};
