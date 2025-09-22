// /api/generate.js
const { kv } = require("@vercel/kv");
const fetch = global.fetch;

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "MethodNotAllowed" });
    }

    const { prompt, username, userId, projectId, model } = await readBody(req);
    if (!prompt || !username || !projectId) {
      return res.status(400).json({ error: "BadRequest", message: "Missing prompt/username/projectId" });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "MissingConfig", message: "Missing GROQ_API_KEY. Contact support." });
    }

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content:
`Return ONLY JSON (no markdown) like:
{"entry":"index.html","files":[{"name":"index.html","content":"<!doctype html>..."},{"name":"style.css","content":"..."},{"name":"app.js","content":"..."}]}
All references in HTML must match files you include.`
          },
          { role: "user", content: `Create a small working website for: ${prompt}.` }
        ],
        max_tokens: 4096
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
    let manifest;
    try {
      manifest = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch {
      manifest = {
        entry: "index.html",
        files: [{ name: "index.html", content: data?.choices?.[0]?.message?.content || "<!doctype html><title>Empty</title>" }]
      };
    }

    // Persist (if KV is configured)
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
