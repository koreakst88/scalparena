// src/index.js

require('dotenv').config();
const express = require('express');
const ScalpArenaBot = require('./bot/bot');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Запустить бота
if (process.env.TELEGRAM_BOT_TOKEN && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  const bot = new ScalpArenaBot();
  bot.start().catch(console.error);
} else {
  console.log('ℹ️ Bot startup skipped: missing TELEGRAM_BOT_TOKEN or Supabase env vars');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
