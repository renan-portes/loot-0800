require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const {
  addUser,
  getUser,
  getAllUsers,
  updateUserPreferences,
  DEFAULT_PREFERENCES
} = require('./database');
const { checkAndNotifyGames, sendActiveGamesCatalog, sendAllLootsToUser } = require('./worker');

// Configurações de ambiente
const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const DONATION_URL = 'https://pixgg.com.br/rzao';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '791838687'; // ID do Administrador

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
 * Constrói o layout do teclado inline com Tipos de Conteúdo, Lojas, Portal Web e Apoio.
 * @param {Array<string>} userPreferences - Lista de preferências do usuário
 * @param {string} [configUrl] - URL do portal Web com chatId
 * @returns {Array<Array<object>>} - Matriz de botões para o Telegram
 */
function buildPreferencesKeyboard(userPreferences, configUrl) {
  let prefs = Array.isArray(userPreferences) ? [...userPreferences] : [...DEFAULT_PREFERENCES];

  // Compatibilidade retroativa: se não houver type:*, adiciona type:game
  const hasType = prefs.some((p) => p.startsWith('type:'));
  if (!hasType) {
    prefs.push('type:game');
  }

  const rows = [];

  // Seção 1: Tipos de Conteúdo (Jogos, Loots, Betas)
  const isGameChecked = prefs.includes('type:game');
  const isLootChecked = prefs.includes('type:loot');
  const isBetaChecked = prefs.includes('type:beta');

  rows.push([
    {
      text: `${isGameChecked ? '✅' : '❌'} 🎮 Jogos Completos`,
      callback_data: 'toggle:type:game'
    }
  ]);

  rows.push([
    {
      text: `${isLootChecked ? '✅' : '❌'} 🎁 DLCs & Loots`,
      callback_data: 'toggle:type:loot'
    },
    {
      text: `${isBetaChecked ? '✅' : '❌'} 🔑 Betas & Testes`,
      callback_data: 'toggle:type:beta'
    }
  ]);

  // Seção 2: Lojas e Plataformas
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

  // Ações Rápidas
  rows.push([
    { text: '✨ Alternar Todas as Lojas', callback_data: 'toggle:all_stores' }
  ]);

  if (configUrl) {
    rows.push([
      { text: '🌐 Abrir Portal Web no Navegador', url: configUrl }
    ]);
  }

  rows.push([
    { text: '🎁 Ver Todos os Drops Ativos Agora', callback_data: 'get_recent_games' }
  ]);

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

  // Log de diagnóstico e captura de dados do usuário em todas as mensagens recebidas
  bot.on('message', (msg) => {
    const fromUser = msg.from?.username
      ? `@${msg.from.username}`
      : (msg.from?.first_name || 'Desconhecido');
    console.log(`[Telegram Bot] Mensagem de chat_id ${msg.chat.id} (${fromUser}): "${msg.text || '[mídia/evento]'}"`);

    // Atualiza nome e username no banco em background
    if (msg.chat.type === 'private') {
      addUser(msg.chat.id, msg.from).catch(() => {});
    }
  });

  // Comando /start com botões interativos
  bot.onText(/\/start/i, async (msg) => {
    const chatId = msg.chat.id;
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const configUrl = `${baseUrl}/?chatId=${chatId}`;

    console.log(`[Telegram Bot] Executando /start para chat_id ${chatId} (${msg.from?.first_name || 'Usuário'})...`);

    try {
      await addUser(chatId, msg.from);
    } catch (dbErr) {
      console.error(`[Telegram Bot] Erro ao registrar usuário ${chatId}:`, dbErr.message);
    }

    try {
      await bot.sendMessage(
        chatId,
        `Bem-vindo ao Loot 0800! 🎮 O seu radar de jogos, DLCs e betas grátis está online.\n\n` +
        `⚡ Use os botões abaixo para conferir os drops ativos, personalizar suas plataformas e tipos de alerta ou abrir o portal Web.`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎁 Ver Todos os Drops Ativos Agora', callback_data: 'get_recent_games' }],
              [{ text: '🌐 Abrir Portal Web de Configuração', url: configUrl }],
              [{ text: '☕ Apoiar o Projeto (Pix)', url: DONATION_URL }]
            ]
          }
        }
      );
      console.log(`[Telegram Bot] Boas-vindas enviadas com sucesso para chat_id ${chatId}!`);
    } catch (sendErr) {
      console.error(`[Telegram Bot] Erro ao enviar mensagem /start para chat_id ${chatId}:`, sendErr.message);
    }
  });

  // Comando /config (Painel com Tipos de Conteúdo + Lojas + Botões)
  bot.onText(/\/config/i, async (msg) => {
    const chatId = msg.chat.id;
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const configUrl = `${baseUrl}/?chatId=${chatId}`;

    console.log(`[Telegram Bot] Executando /config para chat_id ${chatId}...`);

    let userPreferences = DEFAULT_PREFERENCES;
    try {
      await addUser(chatId, msg.from);
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

    try {
      await bot.sendMessage(
        chatId,
        `⚙️ <b>Painel de Preferências - Loot 0800</b>\n\n` +
        `Escolha os <b>Tipos de Conteúdo</b> e as <b>Lojas</b> que você quer monitorar:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
      console.log(`[Telegram Bot] Painel /config enviado com sucesso para chat_id ${chatId}!`);
    } catch (sendErr) {
      console.error(`[Telegram Bot] Erro ao enviar mensagem /config para chat_id ${chatId}:`, sendErr.message);
    }
  });

  // Comando /users ou /admin (Exclusivo para o Administrador ver a lista de usuários com links diretos)
  bot.onText(/\/(users|admin)/i, async (msg) => {
    const chatId = String(msg.chat.id);

    // Validação de segurança: apenas o ID do Administrador pode ver a lista
    if (chatId !== String(ADMIN_CHAT_ID)) {
      return bot.sendMessage(chatId, '⛔ Comando restrito apenas ao administrador do bot.');
    }

    try {
      const users = await getAllUsers();
      if (!users || users.length === 0) {
        return bot.sendMessage(chatId, '👥 Nenhum usuário registrado no momento.');
      }

      let responseText = `👥 <b>USUÁRIOS REGISTRADOS NO LOOT 0800 (${users.length})</b>\n\n`;

      users.forEach((u, index) => {
        const name = u.first_name || 'Sem nome';
        const userLink = `<a href="tg://user?id=${u.chat_id}">${name}</a>`;
        const userTag = u.username ? `@${u.username}` : 'sem username';

        let prefCount = 10;
        try {
          const parsed = JSON.parse(u.preferences);
          if (Array.isArray(parsed)) {
            prefCount = parsed.filter((p) => !p.startsWith('type:')).length;
          }
        } catch (_) {}

        responseText += `<b>${index + 1}.</b> 👤 <b>${userLink}</b> (${userTag})\n`;
        responseText += `   🆔 ID: <code>${u.chat_id}</code>\n`;
        responseText += `   🎯 Plataformas: ${prefCount}/10 ativas\n\n`;
      });

      await bot.sendMessage(chatId, responseText, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[Telegram Bot] Erro ao listar usuários no comando /users:', err.message);
      bot.sendMessage(chatId, '❌ Ocorreu um erro ao consultar os usuários no banco de dados.');
    }
  });

  // Interceptador de cliques nos botões Inline Keyboard
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (!data) return;

    // Ação: Buscar catálogo completo de todos os drops ativos
    if (data === 'get_recent_games') {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: 'Compilando catálogo de drops ativos...'
        });

        await sendActiveGamesCatalog(bot, chatId);
      } catch (err) {
        console.error('[Telegram Bot] Erro ao enviar catálogo de jogos:', err.message);
      }
      return;
    }

    // Ação: Buscar lista completa de todas as DLCs & Loots
    if (data === 'get_all_loots') {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: 'Compilando todas as DLCs disponíveis...'
        });

        await sendAllLootsToUser(bot, chatId);
      } catch (err) {
        console.error('[Telegram Bot] Erro ao enviar lista completa de DLCs:', err.message);
      }
      return;
    }

    // Ação: Alternar preferências (Lojas ou Tipos de Conteúdo)
    if (data.startsWith('toggle:')) {
      const targetKey = data.replace('toggle:', '');
      const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
      const configUrl = `${baseUrl}/?chatId=${chatId}`;

      try {
        await addUser(chatId, query.from);
        const user = await getUser(chatId);
        let userPreferences = DEFAULT_PREFERENCES;

        if (user && user.preferences) {
          userPreferences = typeof user.preferences === 'string'
            ? JSON.parse(user.preferences)
            : user.preferences;
        }

        // Garante array
        if (!Array.isArray(userPreferences)) {
          userPreferences = [...DEFAULT_PREFERENCES];
        }

        // Lógica de alternância (Toggle)
        if (targetKey === 'all_stores' || targetKey === 'all') {
          const storeIds = STORE_OPTIONS.map((s) => s.id);
          const currentStores = userPreferences.filter((p) => !p.startsWith('type:'));
          const typePrefs = userPreferences.filter((p) => p.startsWith('type:'));

          if (currentStores.length === storeIds.length) {
            userPreferences = [...typePrefs]; // Desmarca todas as lojas mantendo os tipos
          } else {
            userPreferences = [...typePrefs, ...storeIds]; // Marca todas as lojas
          }
        } else {
          // Toggle individual (seja loja ou type:*)
          if (userPreferences.includes(targetKey)) {
            userPreferences = userPreferences.filter((k) => k !== targetKey);
          } else {
            userPreferences.push(targetKey);
          }
        }

        // Salva no banco de dados SQLite
        await updateUserPreferences(chatId, userPreferences);

        // Atualiza o teclado inline mantendo o botão do Portal Web
        const newKeyboard = buildPreferencesKeyboard(userPreferences, configUrl);

        await bot.answerCallbackQuery(query.id, {
          text: targetKey.startsWith('type:') ? 'Tipo de alerta atualizado!' : 'Plataforma atualizada!'
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

  console.log('[Telegram Bot] Bot conectado e escutando comandos (/start, /config, /users) e botões Inline...');

  // Execução imediata do Worker no boot
  console.log('[Worker] Disparando verificação inicial de oportunidades gratuitas...');
  checkAndNotifyGames(bot);

  // Agendamento do Worker via Cron (roda a cada hora: 0 * * * *)
  cron.schedule('0 * * * *', () => {
    console.log('[Cron] Executando busca periódica horária de oportunidades gratuitas...');
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
