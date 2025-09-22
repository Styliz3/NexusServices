export default async function handler(req, res) {
  try {
    const body = req.method === "POST" ? (await readJson(req)) : {};
    const { prompt, username, projectId, model } = body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "MissingConfig",
        message: "Server misconfigured. Contact support (missing GROQ_API_KEY)."
      });
    }
    if (!prompt || !username || !projectId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Missing fields. Provide prompt, username, and projectId."
      });
    }

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        messages: [
          {
            role: "system",
            content:
              "You are SimuWeb's generator. Return ONE complete HTML document (optionally with inline CSS/JS). Do NOT wrap in markdown or code fences. It must be runnable in an <iframe>."
          },
          {
            role: "user",
            content:
              `Create a functional, bug-free website for: ${prompt}. Include HTML, CSS, and any inline JS needed.`
          }
        ],
        temperature: 0.6,
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
    const code =
      data?.choices?.[0]?.message?.content ||
      "<!doctype html><title>SimuWeb</title><h1>Empty response</h1>";

    // TODO: persist to DB here (username, projectId, version, code)
    const version = 1; // or next version from DB
    return res.status(200).json({ projectId, version, code });
  } catch (err) {
    return res.status(500).json({
      error: "ServerError",
      message:
        "We couldn't generate your site. Please try again. If this continues, contact support.",
      detail: String(err)
    });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const txt = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(txt || "{}"); } catch { return {}; }
}
