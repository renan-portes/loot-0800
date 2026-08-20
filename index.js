require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Configurações de ambiente
const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;

// 1. Inicialização do Express
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🎮 Loot 0800 Bot está online!');
});

app.listen(PORT, () => {
  console.log(`[Express] Servidor web rodando na porta ${PORT}`);
});

// 2. Inicialização do Telegram Bot (modo Polling)
if (!token || token === 'SEU_TELEGRAM_BOT_TOKEN_AQUI') {
  console.warn('\n⚠️ [Telegram Bot] Token não configurado ou valor padrão detectado!');
  console.warn('👉 Cole o seu token no arquivo .env na variável TELEGRAM_BOT_TOKEN.\n');
} else {
  const bot = new TelegramBot(token, { polling: true });

  // 3. Comando /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Bem-vindo ao Loot 0800! O seu radar de jogos grátis está online. 🎮');
  });

  console.log('[Telegram Bot] Bot conectado e escutando mensagens em modo Polling...');
}
