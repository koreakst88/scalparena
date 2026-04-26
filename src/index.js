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

let bot = null;

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.log('ℹ️ Bot startup skipped: missing TELEGRAM_BOT_TOKEN or Supabase env vars');
    return;
  }

  bot = new ScalpArenaBot();

  if (process.env.NODE_ENV === 'production') {
    const railwayUrl =
      process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN;

    if (railwayUrl) {
      const webhookUrl = `https://${railwayUrl}/webhook`;

      app.post('/webhook', (req, res) => {
        if (!bot) {
          res.sendStatus(200);
          return;
        }

        bot.bot.processUpdate(req.body);
        res.sendStatus(200);
      });

      await bot.bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook set: ${webhookUrl}`);
    } else {
      console.warn('⚠️  RAILWAY_PUBLIC_DOMAIN not set, falling back to polling');
      await bot.bot.startPolling();
    }
  }

  await bot.start();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

main().catch(console.error);
