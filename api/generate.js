export default async function handler(req, res) {
  try {
    const { prompt, username, projectId, model } = await req.json?.() || req.body;

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        messages: [
          { role: "system", content: "You are SimuWeb's site generator. Return a single complete HTML document with optional inline CSS and JS. Avoid backticks and markdown." },
          { role: "user", content: `Create a working website for: ${prompt}. Include HTML/CSS/JS in one document. Make it functional and bug-free.` }
        ],
        temperature: 0.6
      })
    });

    if (!groq.ok) {
      const txt = await groq.text();
      return res.status(groq.status).json({ error: "GroqError", detail: txt });
    }

    const data = await groq.json();
    const code = data.choices?.[0]?.message?.content || "<!doctype html><title>Empty</title>";

    // TODO: Persist to your DB here (username, projectId, version, code)
    // For now we just echo back
    return res.status(200).json({
      projectId: projectId || `proj${Date.now()}`,
      version: 1,
      code
    });
  } catch (e) {
    return res.status(500).json({
      error: "ServerError",
      message: "We couldn't generate your site. Please try again. If this keeps happening, contact support.",
      detail: String(e)
    });
  }
}
