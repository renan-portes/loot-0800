require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const {
  addUser,
  getUser,
  updateUserPreferences,
  DEFAULT_PREFERENCES
} = require('./database');
const { checkAndNotifyGames, sendActiveGamesCatalog } = require('./worker');

// Configurações de ambiente
const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const DONATION_URL = 'https://pixgg.com.br/rzao';

// Lista de lojas e plataformas para os botões do Telegram
const STORE_OPTIONS = [
  { id: 'epic', name: 'Epic Games' },
  { id: 'steam', name: 'Steam' },
  { id: 'gog', name: 'GOG' },
  { id: 'amazon', name: 'Prime Gaming' },
  { id: 'playstation', name: 'PlayStation' },
  { id: 'xbox', name: 'Xbox' },
  { id: 'switch', name: 'Switch' },
  { id: 'itch', name: 'Itch.io' },
  { id: 'android', name: 'Android' },
  { id: 'ios', name: 'iOS' }
];

/**
 * Constrói o layout do teclado inline com o status (✅ / ❌) de cada loja, portal web, atalho de catálogo e botão de apoio.
 * @param {Array<string>} userPreferences - Lista de preferências do usuário
 * @param {string} [configUrl] - URL do portal Web com chatId
 * @returns {Array<Array<object>>} - Matriz de botões para o Telegram
 */
function buildPreferencesKeyboard(userPreferences, configUrl) {
  const prefs = Array.isArray(userPreferences) ? userPreferences : DEFAULT_PREFERENCES;
  const rows = [];

  for (let i = 0; i < STORE_OPTIONS.length; i += 2) {
    const row = [];
    const s1 = STORE_OPTIONS[i];
    const isChecked1 = prefs.includes(s1.id);
    row.push({
      text: `${isChecked1 ? '✅' : '❌'} ${s1.name}`,
      callback_data: `toggle:${s1.id}`
    });

    if (i + 1 < STORE_OPTIONS.length) {
      const s2 = STORE_OPTIONS[i + 1];
      const isChecked2 = prefs.includes(s2.id);
      row.push({
        text: `${isChecked2 ? '✅' : '❌'} ${s2.name}`,
        callback_data: `toggle:${s2.id}`
      });
    }
    rows.push(row);
  }

  // Botão de alternar todas as plataformas
  rows.push([
    { text: '✨ Marcar / Desmarcar Todas', callback_data: 'toggle:all' }
  ]);

  // Botão chamativo para abrir o portal Web (se a URL for fornecida)
  if (configUrl) {
    rows.push([
      { text: '🌐 Abrir Portal Web no Navegador', url: configUrl }
    ]);
  }

  // Botão para ver todos os jogos ativos agora
  rows.push([
    { text: '🎁 Ver Todos os Jogos Ativos Agora', callback_data: 'get_recent_games' }
  ]);

  // Botão de apoio ao projeto
  rows.push([
    { text: '☕ Apoiar o Projeto (Pix)', url: DONATION_URL }
  ]);

  return rows;
}

// 1. Inicialização do Bot do Telegram (modo Polling)
let bot = null;

if (!token || token === 'SEU_TELEGRAM_BOT_TOKEN_AQUI') {
  console.warn('\n⚠️ [Telegram Bot] Token não configurado ou valor padrão detectado!');
  console.warn('👉 Cole o seu token no arquivo .env na variável TELEGRAM_BOT_TOKEN.\n');
} else {
  bot = new TelegramBot(token, { polling: true });

  // Tratador global de erro de polling para evitar poluição no console em instabilidades
  bot.on('polling_error', (err) => {
    const msg = err.message || '';
    // Ignora timeouts e desconexões normais de conexão ociosa do Long Polling
    if (
      msg.includes('ETIMEDOUT') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ESOCKETTIMEDOUT') ||
      msg.includes('socket hang up') ||
      err.code === 'EFATAL'
    ) {
      return;
    }
    console.log(`[Telegram Bot] Polling error: ${msg}`);
  });

  // Comando /start com botões interativos
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const configUrl = `${baseUrl}/?chatId=${chatId}`;

    // Registra o usuário no banco de dados (INSERT OR IGNORE)
    addUser(chatId, (err) => {
      if (err) {
        console.error(`[Telegram Bot] Erro ao registrar usuário ${chatId}:`, err.message);
      }
    });

    bot.sendMessage(
      chatId,
      `Bem-vindo ao Loot 0800! 🎮 O seu radar de jogos grátis está online. Seu ID foi registrado com sucesso!\n\n` +
      `⚡ Use os botões abaixo para ver os jogos ativos, configurar suas lojas ou abrir o portal Web.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎁 Ver Todos os Jogos Ativos Agora', callback_data: 'get_recent_games' }],
            [{ text: '🌐 Abrir Portal Web de Configuração', url: configUrl }],
            [{ text: '☕ Apoiar o Projeto (Pix)', url: DONATION_URL }]
          ]
        }
      }
    );
  });

  // Comando /config (Envia painel com botões inline interativos e botão de Portal Web)
  bot.onText(/\/config/, async (msg) => {
    const chatId = msg.chat.id;
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const configUrl = `${baseUrl}/?chatId=${chatId}`;

    let userPreferences = DEFAULT_PREFERENCES;
    try {
      await addUser(chatId);
      const user = await getUser(chatId);
      if (user && user.preferences) {
        userPreferences = typeof user.preferences === 'string'
          ? JSON.parse(user.preferences)
          : user.preferences;
      }
    } catch (err) {
      console.error('[Telegram Bot] Erro ao buscar preferências do usuário para /config:', err.message);
    }

    const keyboard = buildPreferencesKeyboard(userPreferences, configUrl);

    bot.sendMessage(
      chatId,
      `⚙️ <b>Painel de Preferências - Loot 0800</b>\n\n` +
      `Toque nos botões abaixo para ativar/desativar plataformas diretamente no Telegram, ou abra o portal web no navegador:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
  });

  // Interceptador de cliques nos botões Inline Keyboard
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (!data) return;

    // Ação: Buscar catálogo completo de todos os jogos ativos
    if (data === 'get_recent_games') {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: 'Compilando catálogo de jogos ativos...'
        });

        await sendActiveGamesCatalog(bot, chatId);
      } catch (err) {
        console.error('[Telegram Bot] Erro ao enviar catálogo de jogos:', err.message);
      }
      return;
    }

    // Ação: Alternar preferências de plataformas
    if (data.startsWith('toggle:')) {
      const storeKey = data.replace('toggle:', '');
      const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
      const configUrl = `${baseUrl}/?chatId=${chatId}`;

      try {
        await addUser(chatId);
        const user = await getUser(chatId);
        let userPreferences = DEFAULT_PREFERENCES;

        if (user && user.preferences) {
          userPreferences = typeof user.preferences === 'string'
            ? JSON.parse(user.preferences)
            : user.preferences;
        }

        // Lógica de alternância (Toggle)
        if (storeKey === 'all') {
          if (userPreferences.length === DEFAULT_PREFERENCES.length) {
            userPreferences = [];
          } else {
            userPreferences = [...DEFAULT_PREFERENCES];
          }
        } else {
          if (userPreferences.includes(storeKey)) {
            userPreferences = userPreferences.filter((k) => k !== storeKey);
          } else {
            userPreferences.push(storeKey);
          }
        }

        // Salva no banco de dados SQLite
        await updateUserPreferences(chatId, userPreferences);

        // Atualiza o teclado inline mantendo o botão do Portal Web
        const newKeyboard = buildPreferencesKeyboard(userPreferences, configUrl);

        await bot.answerCallbackQuery(query.id, {
          text: storeKey === 'all'
            ? 'Todas as plataformas foram alternadas!'
            : `Plataforma atualizada!`
        });

        await bot.editMessageReplyMarkup(
          { inline_keyboard: newKeyboard },
          { chat_id: chatId, message_id: messageId }
        );
      } catch (err) {
        console.error('[Telegram Bot] Erro ao processar callback_query:', err.message);
        bot.answerCallbackQuery(query.id, { text: 'Erro ao atualizar preferência.' });
      }
    }
  });

  console.log('[Telegram Bot] Bot conectado e escutando comandos (/start, /config) e botões Inline...');

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
        preferences: DEFAULT_PREFERENCES
      });
    }

    const preferences = user.preferences
      ? (typeof user.preferences === 'string' ? JSON.parse(user.preferences) : user.preferences)
      : DEFAULT_PREFERENCES;

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
