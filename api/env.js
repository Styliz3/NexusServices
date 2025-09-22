export default function handler(req, res) {
  res.status(200).json({
    discordClientId: process.env.DISCORD_CLIENT_ID || null
  });
}
