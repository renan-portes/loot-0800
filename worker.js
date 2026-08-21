const axios = require('axios');
const {
  getAllUsers,
  getUser,
  isGameNotified,
  markGameNotified,
  DEFAULT_PREFERENCES
} = require('./database');

const GAMERPOWER_API_URL = 'https://www.gamerpower.com/api/giveaways?type=game';
const MAX_GAMES_PER_RUN = 3; // Regra Anti-Spam: no máximo 3 jogos por execução periódica

/**
 * Monta o texto chamativo da legenda da mensagem individual no Telegram.
 * @param {object} game - Dados do jogo vindos da API
 * @returns {string} - Legenda formatada em HTML
 */
function formatGameCaption(game) {
  const originalPrice = game.worth && game.worth !== 'N/A' ? `<s>${game.worth}</s> ➔ <b>GRÁTIS!</b>` : '<b>GRÁTIS!</b>';
  const platforms = game.platforms || 'PC / Multiplataforma';

  return (
    `🎮 <b>NOVO JOGO GRÁTIS DETECTADO!</b> 🎮\n\n` +
    `🕹️ <b>Título:</b> ${game.title}\n` +
    `💻 <b>Plataforma:</b> ${platforms}\n` +
    `💰 <b>Preço Original:</b> ${originalPrice}\n` +
    `🔗 <b>Resgate aqui:</b> <a href="${game.open_giveaway_url}">Clique para Resgatar</a>\n\n` +
    `⚡ <i>Aproveite antes que a promoção expire!</i>\n` +
    `⚙️ <i>Configure seus alertas com /config</i>`
  );
}

/**
 * Verifica se o jogo corresponde às preferências de plataformas/lojas selecionadas pelo usuário.
 * @param {object} game - Dados do jogo da API
 * @param {Array<string>} userPreferences - Lista de plataformas configuradas pelo usuário
 * @returns {boolean}
 */
function isGameMatchingPreferences(game, userPreferences) {
  if (!Array.isArray(userPreferences) || userPreferences.length === 0) {
    return true; // Se não houver preferências definidas, envia por padrão
  }

  // Se o usuário selecionou "todas"
  if (userPreferences.some((p) => ['todas', 'all', '*'].includes(p.toLowerCase()))) {
    return true;
  }

  // Contexto textual do jogo para busca (plataformas, título e link)
  const gameContext = `${game.platforms || ''} ${game.title || ''} ${game.open_giveaway_url || ''}`.toLowerCase();

  return userPreferences.some((pref) => {
    const p = pref.toLowerCase().trim();
    if (!p) return false;

    // Mapeamentos específicos para lojas e plataformas
    if (p === 'itch' || p === 'itch.io' || p === 'itchio') {
      return gameContext.includes('itch');
    }
    if (p === 'amazon' || p === 'prime') {
      return gameContext.includes('amazon') || gameContext.includes('prime');
    }
    if (p === 'playstation' || p === 'ps4' || p === 'ps5' || p === 'psn') {
      return (
        gameContext.includes('playstation') ||
        gameContext.includes('ps4') ||
        gameContext.includes('ps5') ||
        gameContext.includes('psn') ||
        gameContext.includes('sony')
      );
    }
    if (p === 'xbox' || p === 'xbox-one' || p === 'xbox-series-xs') {
      return gameContext.includes('xbox') || gameContext.includes('microsoft');
    }
    if (p === 'switch' || p === 'nintendo') {
      return gameContext.includes('switch') || gameContext.includes('nintendo');
    }
    if (p === 'android') {
      return gameContext.includes('android') || gameContext.includes('google play');
    }
    if (p === 'ios' || p === 'apple' || p === 'app store') {
      return (
        gameContext.includes('ios') ||
        gameContext.includes('apple') ||
        gameContext.includes('app store') ||
        gameContext.includes('iphone') ||
        gameContext.includes('ipad')
      );
    }

    return gameContext.includes(p);
  });
}

/**
 * Busca jogos gratuitos na GamerPower API e notifica os usuários cadastrados com base em suas preferências (Ciclo Automático).
 * @param {object} bot - Instância do bot do Telegram
 */
async function checkAndNotifyGames(bot) {
  if (!bot) {
    console.warn('[Worker] Instância do bot não fornecida. Pulando execução do worker.');
    return;
  }

  console.log('[Worker] Verificando novos jogos gratuitos na GamerPower API...');

  try {
    const response = await axios.get(GAMERPOWER_API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Loot0800-Bot/2.0' }
    });

    const games = response.data;
    if (!Array.isArray(games) || games.length === 0) {
      console.log('[Worker] Nenhum jogo retornado pela API no momento.');
      return;
    }

    // 1. Filtrar jogos que ainda não foram notificados
    const unnotifiedGames = [];
    for (const game of games) {
      const alreadyNotified = await isGameNotified(game.id);
      if (!alreadyNotified) {
        unnotifiedGames.push(game);
      }
    }

    if (unnotifiedGames.length === 0) {
      console.log('[Worker] Nenhum novo jogo gratuito para notificar.');
      return;
    }

    // 2. Aplicar a Regra Anti-Spam (limita aos 3 primeiros)
    const gamesToNotify = unnotifiedGames.slice(0, MAX_GAMES_PER_RUN);
    console.log(`[Worker] ${unnotifiedGames.length} novos jogos encontrados. Notificando os ${gamesToNotify.length} primeiros (Anti-Spam)...`);

    // 3. Buscar todos os usuários cadastrados
    const users = await getAllUsers();
    if (!users || users.length === 0) {
      console.log('[Worker] Novos jogos detectados, mas não há usuários cadastrados ainda no banco.');
      return;
    }

    console.log(`[Worker] Avaliando preferências de ${users.length} usuário(s)...`);

    // 4. Enviar mensagem para cada usuário respeitando suas preferências
    for (const game of gamesToNotify) {
      const caption = formatGameCaption(game);

      for (const user of users) {
        // Parse das preferências do usuário (salvas como string JSON no SQLite)
        let userPreferences = DEFAULT_PREFERENCES;
        try {
          if (user.preferences) {
            userPreferences = typeof user.preferences === 'string'
              ? JSON.parse(user.preferences)
              : user.preferences;
          }
        } catch (parseErr) {
          console.warn(`[Worker] Erro ao parsear preferências do chat_id ${user.chat_id}:`, parseErr.message);
        }

        // Verifica se o jogo atende às preferências do usuário
        if (!isGameMatchingPreferences(game, userPreferences)) {
          console.log(`[Worker] Jogo "${game.title}" ignorado para ${user.chat_id} (lojas do usuário: ${JSON.stringify(userPreferences)})`);
          continue;
        }

        try {
          if (game.thumbnail) {
            await bot.sendPhoto(user.chat_id, game.thumbnail, {
              caption,
              parse_mode: 'HTML'
            });
          } else {
            await bot.sendMessage(user.chat_id, caption, {
              parse_mode: 'HTML'
            });
          }
          console.log(`[Worker] Drop enviado com sucesso para chat_id ${user.chat_id}: "${game.title}"`);
        } catch (sendErr) {
          console.error(`[Worker] Erro ao enviar jogo "${game.title}" para chat_id ${user.chat_id}:`, sendErr.message);
        }
      }

      // 5. Salva o ID do jogo no banco para não repetir
      await markGameNotified(game.id);
      console.log(`[Worker] ✅ Jogo "${game.title}" (ID: ${game.id}) registrado no banco de dados.`);
    }

    console.log('[Worker] Ciclo de verificação finalizado com sucesso.');
  } catch (error) {
    console.error('[Worker] Erro ao buscar ou processar jogos na API:', error.message);
  }
}

/**
 * Constrói e envia o catálogo completo de todos os jogos ativos agrupados por loja/plataforma em mensagem única.
 * @param {object} bot - Instância do bot do Telegram
 * @param {string|number} chatId - ID do chat do Telegram
 */
async function sendActiveGamesCatalog(bot, chatId) {
  if (!bot || !chatId) return;

  try {
    const response = await axios.get(GAMERPOWER_API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Loot0800-Bot/2.0' }
    });

    const games = response.data;
    if (!Array.isArray(games) || games.length === 0) {
      await bot.sendMessage(
        chatId,
        '🎮 Não encontramos nenhum drop ativo no momento. Fique de olho, avisaremos assim que surgir novidade!'
      );
      return;
    }

    // Busca preferências do usuário
    const user = await getUser(chatId);
    let userPreferences = DEFAULT_PREFERENCES;
    if (user && user.preferences) {
      userPreferences = typeof user.preferences === 'string'
        ? JSON.parse(user.preferences)
        : user.preferences;
    }

    // Filtra jogos pelas preferências do usuário
    const matchingGames = games.filter((game) => isGameMatchingPreferences(game, userPreferences));

    if (matchingGames.length === 0) {
      await bot.sendMessage(
        chatId,
        '🎮 Não encontramos jogos ativos para as suas plataformas selecionadas no momento.\n\n💡 Use /config para adicionar mais plataformas ao seu radar!'
      );
      return;
    }

    // Agrupamento estruturado por plataformas
    const categories = {
      '🟣 Epic Games Store': [],
      '🔵 Steam': [],
      '👾 GOG.com': [],
      '📦 Prime Gaming': [],
      '🎮 PlayStation': [],
      '🟢 Xbox': [],
      '🔴 Nintendo Switch': [],
      '📱 Mobile (Android / iOS)': [],
      '🕹️ Itch.io': [],
      '💻 Outras Lojas / DRM-Free': []
    };

    matchingGames.forEach((g) => {
      const text = `${g.platforms || ''} ${g.title || ''} ${g.open_giveaway_url || ''}`.toLowerCase();
      if (text.includes('epic')) {
        categories['🟣 Epic Games Store'].push(g);
      } else if (text.includes('steam')) {
        categories['🔵 Steam'].push(g);
      } else if (text.includes('gog')) {
        categories['👾 GOG.com'].push(g);
      } else if (text.includes('amazon') || text.includes('prime')) {
        categories['📦 Prime Gaming'].push(g);
      } else if (text.includes('playstation') || text.includes('ps4') || text.includes('ps5') || text.includes('psn')) {
        categories['🎮 PlayStation'].push(g);
      } else if (text.includes('xbox')) {
        categories['🟢 Xbox'].push(g);
      } else if (text.includes('switch') || text.includes('nintendo')) {
        categories['🔴 Nintendo Switch'].push(g);
      } else if (text.includes('android') || text.includes('ios') || text.includes('apple') || text.includes('mobile')) {
        categories['📱 Mobile (Android / iOS)'].push(g);
      } else if (text.includes('itch')) {
        categories['🕹️ Itch.io'].push(g);
      } else {
        categories['💻 Outras Lojas / DRM-Free'].push(g);
      }
    });

    let message = `🎮 <b>CATÁLOGO DE JOGOS GRÁTIS ATIVOS</b> 🎮\n`;
    message += `<i>Encontramos <b>${matchingGames.length}</b> jogo(s) 100% gratuito(s) para resgatar agora:</i>\n\n`;

    for (const [catName, list] of Object.entries(categories)) {
      if (list.length > 0) {
        message += `<b>${catName} (${list.length})</b>\n`;
        list.forEach((game) => {
          const cleanTitle = game.title.replace(/\s*Giveaway\s*/gi, '').trim();
          const originalPrice = game.worth && game.worth !== 'N/A' ? `<s>${game.worth}</s> ➔ <b>GRÁTIS</b>` : '<b>GRÁTIS</b>';
          message += `• <a href="${game.open_giveaway_url}">${cleanTitle}</a> — ${originalPrice}\n`;
        });
        message += '\n';
      }
    }

    message += `⚡ <i>Toque no nome do jogo para abrir a página de resgate!</i>\n`;
    message += `⚙️ <i>Personalize suas lojas com /config</i>`;

    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error(`[Worker] Erro ao gerar catálogo de jogos ativos para ${chatId}:`, error.message);
    await bot.sendMessage(
      chatId,
      '❌ Ocorreu uma instabilidade ao consultar os drops. Tente novamente em alguns instantes!'
    );
  }
}

module.exports = {
  checkAndNotifyGames,
  sendActiveGamesCatalog,
  sendRecentGamesToUser: sendActiveGamesCatalog, // Alias para compatibilidade
  formatGameCaption,
  isGameMatchingPreferences
};
