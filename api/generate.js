export default async function handler(req, res) {
  const { prompt, username } = req.body;

  // Call Groq API
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen/qwen3-32b",
      messages: [{ role: "user", content: `Generate a full HTML/CSS/JS project for: ${prompt}` }],
      temperature: 0.7
    })
  });
  const data = await response.json();
  const code = data.choices[0].message.content;

  // Fake save in-memory (replace with DB for persistence)
  const projectId = "proj"+Date.now();
  const version = 1;

  res.status(200).json({ projectId, version, code });
}
