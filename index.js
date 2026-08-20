require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { addUser, getUser, updateUserPreferences } = require('./database');
const { checkAndNotifyGames } = require('./worker');

// Configurações de ambiente
const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;

// 1. Inicialização do Bot do Telegram (modo Polling)
let bot = null;

if (!token || token === 'SEU_TELEGRAM_BOT_TOKEN_AQUI') {
  console.warn('\n⚠️ [Telegram Bot] Token não configurado ou valor padrão detectado!');
  console.warn('👉 Cole o seu token no arquivo .env na variável TELEGRAM_BOT_TOKEN.\n');
} else {
  bot = new TelegramBot(token, { polling: true });

  // Tratador global de erro de polling para evitar poluição no console em instabilidades
  bot.on('polling_error', (err) => {
    console.log(`[Telegram Bot] Polling error: ${err.message}`);
  });

  // Comando /start
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
      `Bem-vindo ao Loot 0800! 🎮 O seu radar está online. Seu ID foi registrado com sucesso para receber os próximos drops!\n\n` +
      `⚙️ Digite /config para personalizar quais lojas você quer monitorar.`
    );
  });

  // Comando /config (Gera link do portal de preferências com o chatId)
  bot.onText(/\/config/, (msg) => {
    const chatId = msg.chat.id;
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const configUrl = `${baseUrl}/?chatId=${chatId}`;

    bot.sendMessage(
      chatId,
      `⚙️ Acesse seu portal para configurar seus alertas:\n${configUrl}`
    );
  });

  console.log('[Telegram Bot] Bot conectado e escutando comandos (/start, /config) em modo Polling...');

  // Execução imediata do Worker no boot
  console.log('[Worker] Disparando verificação inicial de jogos gratuitos...');
  checkAndNotifyGames(bot);

  // Agendamento do Worker via Cron (roda a cada hora: 0 * * * *)
  cron.schedule('0 * * * *', () => {
    console.log('[Cron] Executando busca periódica horária de jogos gratuitos...');
    checkAndNotifyGames(bot);
  });
}

// 2. Inicialização do Express
const app = express();
app.use(express.json());

// Servir arquivos estáticos do frontend (pasta public)
app.use(express.static(path.join(__dirname, 'public')));

// Rota GET para carregar preferências atuais do usuário
app.get('/api/preferences', async (req, res) => {
  const { chatId } = req.query;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId é obrigatório' });
  }

  try {
    const user = await getUser(chatId);
    if (!user) {
      return res.json({
        success: true,
        preferences: ['epic', 'steam', 'gog', 'amazon']
      });
    }

    const preferences = user.preferences
      ? (typeof user.preferences === 'string' ? JSON.parse(user.preferences) : user.preferences)
      : ['epic', 'steam', 'gog', 'amazon'];

    res.json({ success: true, preferences });
  } catch (error) {
    console.error('[API] Erro ao buscar preferências:', error.message);
    res.status(500).json({ error: 'Erro interno ao consultar preferências' });
  }
});

// Rota POST para salvar as preferências selecionadas no frontend
app.post('/api/preferences', async (req, res) => {
  const { chatId, preferences } = req.body;

  if (!chatId || !Array.isArray(preferences)) {
    return res.status(400).json({
      error: 'chatId e array de preferences são obrigatórios'
    });
  }

  try {
    // Garante que o usuário existe na base
    await addUser(chatId);
    // Atualiza as preferências
    await updateUserPreferences(chatId, preferences);

    // Envia notificação de confirmação no Telegram
    if (bot) {
      try {
        await bot.sendMessage(
          chatId,
          '✅ Suas preferências foram salvas com sucesso! O radar foi atualizado.'
        );
      } catch (botErr) {
        console.error(`[Telegram Bot] Erro ao enviar mensagem de confirmação para chat_id ${chatId}:`, botErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Preferências atualizadas com sucesso!',
      chatId,
      preferences
    });
  } catch (error) {
    console.error('[API] Erro ao salvar preferências:', error.message);
    res.status(500).json({ error: 'Erro interno ao atualizar preferências' });
  }
});

app.listen(PORT, () => {
  console.log(`[Express] Servidor web rodando em http://localhost:${PORT}`);
});
