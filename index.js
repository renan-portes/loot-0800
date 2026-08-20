require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { addUser } = require('./database');
const { checkAndNotifyGames } = require('./worker');

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

    // Registra o usuário no banco de dados (INSERT OR IGNORE)
    addUser(chatId, (err) => {
      if (err) {
        console.error(`[Telegram Bot] Erro ao registrar usuário ${chatId}:`, err.message);
      }
    });

    bot.sendMessage(
      chatId,
      'Bem-vindo ao Loot 0800! 🎮 O seu radar está online. Seu ID foi registrado com sucesso para receber os próximos drops!'
    );
  });

  console.log('[Telegram Bot] Bot conectado e escutando mensagens em modo Polling...');

  // 4. Execução imediata do Worker na inicialização
  console.log('[Worker] Disparando verificação inicial de jogos gratuitos...');
  checkAndNotifyGames(bot);

  // 5. Agendamento do Worker via Cron (roda a cada hora: 0 * * * *)
  cron.schedule('0 * * * *', () => {
    console.log('[Cron] Executando busca periódica horária de jogos gratuitos...');
    checkAndNotifyGames(bot);
  });
}
