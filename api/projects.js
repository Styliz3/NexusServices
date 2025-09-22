let memoryStore = {}; // Replace with DB later

export default function handler(req, res) {
  const { username } = req.query;
  const projects = memoryStore[username] || [];
  res.status(200).json(projects);
}
