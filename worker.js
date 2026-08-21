const axios = require('axios');
const {
  getAllUsers,
  getUser,
  isGameNotified,
  markGameNotified,
  DEFAULT_PREFERENCES
} = require('./database');

const GAMERPOWER_API_URL = 'https://www.gamerpower.com/api/giveaways';
const DONATION_URL = 'https://pixgg.com.br/rzao';
const MAX_GAMES_PER_RUN = 3; // Regra Anti-Spam: no máximo 3 itens por ciclo automático

/**
 * Identifica se a oportunidade é um teste temporário ou Fim de Semana Grátis (Free Weekend).
 * @param {object} game - Dados da oportunidade
 * @returns {boolean}
 */
function isTemporaryOrFreeWeekend(game) {
  const text = `${game.title || ''} ${game.description || ''} ${game.instructions || ''}`.toLowerCase();
  return (
    text.includes('free weekend') ||
    text.includes('fim de semana') ||
    text.includes('weekend free') ||
    text.includes('play for free') ||
    text.includes('free to play for') ||
    text.includes('free trial') ||
    text.includes('temporary')
  );
}

/**
 * Monta o cabeçalho e texto chamativo do card no Telegram de acordo com o tipo de conteúdo.
 * @param {object} game - Dados do item vindos da API
 * @returns {string} - Legenda formatada em HTML
 */
function formatGameCaption(game) {
  const originalPrice = game.worth && game.worth !== 'N/A' ? `<s>${game.worth}</s> ➔ <b>GRÁTIS!</b>` : '<b>GRÁTIS!</b>';
  const platforms = game.platforms || 'PC / Multiplataforma';
  const isTemp = isTemporaryOrFreeWeekend(game);

  let header = `🎮 <b>NOVO JOGO GRÁTIS DETECTADO!</b> 🎮\n\n`;
  let subHeader = '';

  const itemType = (game.type || 'Game').toLowerCase();

  if (isTemp) {
    header = `⏳ <b>FIM DE SEMANA GRÁTIS / TESTE TEMPORÁRIO!</b> ⏳\n\n`;
    if (game.end_date && game.end_date !== 'N/A') {
      subHeader = `⏰ <i>Jogue de graça por tempo limitado (Válido até: ${game.end_date})!</i>\n\n`;
    } else {
      subHeader = `⏰ <i>Jogue de graça por tempo limitado!</i>\n\n`;
    }
  } else if (itemType.includes('dlc') || itemType.includes('loot') || itemType.includes('other')) {
    header = `🎁 <b>NOVO LOOT / DLC GRÁTIS!</b> 🎁\n\n`;
  } else if (itemType.includes('early access') || itemType.includes('beta')) {
    header = `🔑 <b>NOVA CHAVE DE BETA / ACESSO ANTECIPADO!</b> 🔑\n\n`;
  }

  return (
    `${header}${subHeader}` +
    `🕹️ <b>Título:</b> ${game.title}\n` +
    `💻 <b>Plataforma:</b> ${platforms}\n` +
    `💰 <b>Preço Original:</b> ${originalPrice}\n` +
    `🔗 <b>Resgate aqui:</b> <a href="${game.open_giveaway_url}">Clique para Resgatar</a>\n\n` +
    `⚡ <i>Aproveite antes que a promoção expire!</i>\n` +
    `⚙️ <i>Configure seus alertas com /config</i>`
  );
}

/**
 * Verifica se a oportunidade corresponde aos Tipos de Conteúdo e Lojas selecionadas pelo usuário.
 * @param {object} game - Dados da oportunidade da API
 * @param {Array<string>} userPreferences - Lista de preferências configuradas pelo usuário
 * @returns {boolean}
 */
function isGameMatchingPreferences(game, userPreferences) {
  if (!Array.isArray(userPreferences) || userPreferences.length === 0) {
    return true;
  }

  // 1. Filtragem por Tipo de Conteúdo (Jogos, Loots/DLCs, Betas)
  const hasTypeFilter = userPreferences.some((p) => p.startsWith('type:'));
  const wantsGames = hasTypeFilter ? userPreferences.includes('type:game') : true;
  const wantsLoot = userPreferences.includes('type:loot');
  const wantsBeta = userPreferences.includes('type:beta');

  const itemType = (game.type || 'Game').toLowerCase();

  let matchesType = false;
  if (itemType.includes('early access') || itemType.includes('beta')) {
    matchesType = wantsBeta;
  } else if (itemType.includes('dlc') || itemType.includes('loot') || itemType.includes('other')) {
    matchesType = wantsLoot;
  } else {
    matchesType = wantsGames;
  }

  if (!matchesType) {
    return false;
  }

  // 2. Filtragem por Plataforma / Loja
  if (userPreferences.some((p) => ['todas', 'all', '*'].includes(p.toLowerCase()))) {
    return true;
  }

  const gameContext = `${game.platforms || ''} ${game.title || ''} ${game.open_giveaway_url || ''}`.toLowerCase();

  const storePreferences = userPreferences.filter((p) => !p.startsWith('type:'));
  if (storePreferences.length === 0) {
    return true;
  }

  return storePreferences.some((pref) => {
    const p = pref.toLowerCase().trim();
    if (!p) return false;

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
 * Busca todas as oportunidades na GamerPower API e notifica os usuários cadastrados (Ciclo Automático).
 * @param {object} bot - Instância do bot do Telegram
 */
async function checkAndNotifyGames(bot) {
  if (!bot) {
    console.warn('[Worker] Instância do bot não fornecida. Pulando execução do worker.');
    return;
  }

  console.log('[Worker] Verificando novas oportunidades na GamerPower API...');

  try {
    const response = await axios.get(GAMERPOWER_API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Loot0800-Bot/2.5' }
    });

    const games = response.data;
    if (!Array.isArray(games) || games.length === 0) {
      console.log('[Worker] Nenhuma oportunidade retornada pela API no momento.');
      return;
    }

    // 1. Filtrar itens que ainda não foram notificados
    const unnotifiedGames = [];
    for (const game of games) {
      const alreadyNotified = await isGameNotified(game.id);
      if (!alreadyNotified) {
        unnotifiedGames.push(game);
      }
    }

    if (unnotifiedGames.length === 0) {
      console.log('[Worker] Nenhuma nova oportunidade para notificar.');
      return;
    }

    // 2. Aplicar a Regra Anti-Spam (limita aos 3 primeiros por ciclo)
    const gamesToNotify = unnotifiedGames.slice(0, MAX_GAMES_PER_RUN);
    console.log(`[Worker] ${unnotifiedGames.length} novos itens encontrados. Notificando os ${gamesToNotify.length} primeiros (Anti-Spam)...`);

    // 3. Buscar todos os usuários cadastrados
    const users = await getAllUsers();
    if (!users || users.length === 0) {
      console.log('[Worker] Novos drops detectados, mas não há usuários cadastrados ainda no banco.');
      return;
    }

    console.log(`[Worker] Avaliando preferências de ${users.length} usuário(s)...`);

    // 4. Enviar mensagem para cada usuário respeitando suas preferências de tipo e lojas
    for (const game of gamesToNotify) {
      const caption = formatGameCaption(game);

      for (const user of users) {
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

        if (!isGameMatchingPreferences(game, userPreferences)) {
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
          console.error(`[Worker] Erro ao enviar drop "${game.title}" para chat_id ${user.chat_id}:`, sendErr.message);
        }
      }

      // 5. Salva o ID do item no banco para não repetir
      await markGameNotified(game.id);
      console.log(`[Worker] ✅ Drop "${game.title}" (ID: ${game.id}) registrado no banco de dados.`);
    }

    console.log('[Worker] Ciclo de verificação finalizado com sucesso.');
  } catch (error) {
    console.error('[Worker] Erro ao buscar ou processar oportunidades na API:', error.message);
  }
}

/**
 * Constrói e envia o catálogo completo de todos os drops ativos agrupados por categoria e loja em mensagem única.
 * @param {object} bot - Instância do bot do Telegram
 * @param {string|number} chatId - ID do chat do Telegram
 */
async function sendActiveGamesCatalog(bot, chatId) {
  if (!bot || !chatId) return;

  try {
    const response = await axios.get(GAMERPOWER_API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Loot0800-Bot/2.5' }
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

    // Filtra oportunidades pelas preferências do usuário
    const matchingGames = games.filter((game) => isGameMatchingPreferences(game, userPreferences));

    if (matchingGames.length === 0) {
      await bot.sendMessage(
        chatId,
        '🎮 Não encontramos drops ativos para as suas configurações atuais no momento.\n\n💡 Use /config para ativar mais plataformas ou tipos de conteúdo (Loots/Betas) no seu radar!'
      );
      return;
    }

    // Separação em Seções Principais (Jogos Completos, Loots & DLCs, Betas)
    const fullGames = [];
    const lootItems = [];
    const betaItems = [];

    matchingGames.forEach((g) => {
      const itemType = (g.type || 'Game').toLowerCase();
      if (itemType.includes('early access') || itemType.includes('beta')) {
        betaItems.push(g);
      } else if (itemType.includes('dlc') || itemType.includes('loot') || itemType.includes('other')) {
        lootItems.push(g);
      } else {
        fullGames.push(g);
      }
    });

    // Função auxiliar para agrupar por loja
    const groupByStore = (items) => {
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

      items.forEach((g) => {
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

      return categories;
    };

    let message = `🎮 <b>CATÁLOGO DE DROPS 0800 ATIVOS</b> 🎮\n`;
    message += `<i>Encontramos <b>${matchingGames.length}</b> oportunidade(s) disponível(is) para você agora:</i>\n\n`;

    // 1. Seção de Jogos Completos
    if (fullGames.length > 0) {
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🕹️ <b>JOGOS COMPLETOS (${fullGames.length})</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      const groupedGames = groupByStore(fullGames);
      for (const [catName, list] of Object.entries(groupedGames)) {
        if (list.length > 0) {
          message += `<b>${catName} (${list.length})</b>\n`;
          list.forEach((game) => {
            const cleanTitle = game.title.replace(/\s*Giveaway\s*/gi, '').trim();
            const originalPrice = game.worth && game.worth !== 'N/A' ? `<s>${game.worth}</s> ➔ <b>GRÁTIS</b>` : '<b>GRÁTIS</b>';
            const tempTag = isTemporaryOrFreeWeekend(game) ? ' <i>[Teste Temporário]</i>' : '';
            message += `• <a href="${game.open_giveaway_url}">${cleanTitle}</a> — ${originalPrice}${tempTag}\n`;
          });
          message += '\n';
        }
      }
    }

    // 2. Seção de Loots & DLCs
    if (lootItems.length > 0) {
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🎁 <b>DLCS, SKINS & LOOTS (${lootItems.length})</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      const topLoot = lootItems.slice(0, 10);
      topLoot.forEach((loot) => {
        const cleanTitle = loot.title.replace(/\s*Giveaway\s*/gi, '').trim();
        const price = loot.worth && loot.worth !== 'N/A' ? `<s>${loot.worth}</s> ➔ <b>GRÁTIS</b>` : '<b>GRÁTIS</b>';
        message += `• <a href="${loot.open_giveaway_url}">${cleanTitle}</a> (${loot.platforms}) — ${price}\n`;
      });
      if (lootItems.length > 10) {
        message += `<i>... e mais ${lootItems.length - 10} DLCs disponíveis!</i>\n`;
      }
      message += '\n';
    }

    // 3. Seção de Betas & Playtests
    if (betaItems.length > 0) {
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🔑 <b>BETAS & ACESSO ANTECIPADO (${betaItems.length})</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      betaItems.forEach((beta) => {
        const cleanTitle = beta.title.replace(/\s*Giveaway\s*/gi, '').trim();
        message += `• <a href="${beta.open_giveaway_url}">${cleanTitle}</a> (${beta.platforms}) — <b>ACESSO GRÁTIS</b>\n`;
      });
      message += '\n';
    }

    message += `⚡ <i>Toque no nome do item para abrir o resgate!</i>\n`;
    message += `⚙️ <i>Personalize lojas e categorias com /config</i>\n\n`;
    message += `💖 <i>Gostou do Loot 0800? <a href="${DONATION_URL}">Apoie o projeto com um café via Pix!</a></i>`;

    const inlineKeyboard = [];
    if (lootItems.length > 10) {
      inlineKeyboard.push([
        { text: `🎁 Ver Todas as ${lootItems.length} DLCs & Loots`, callback_data: 'get_all_loots' }
      ]);
    }
    inlineKeyboard.push([
      { text: '☕ Apoiar o Loot 0800 via Pix', url: DONATION_URL }
    ]);

    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  } catch (error) {
    console.error(`[Worker] Erro ao gerar catálogo de drops para ${chatId}:`, error.message);
    await bot.sendMessage(
      chatId,
      '❌ Ocorreu uma instabilidade ao consultar os drops. Tente novamente em alguns instantes!'
    );
  }
}

/**
 * Envia a lista completa de todas as DLCs, Skins e Loots ativos para o usuário.
 * @param {object} bot - Instância do bot do Telegram
 * @param {string|number} chatId - ID do chat do Telegram
 */
async function sendAllLootsToUser(bot, chatId) {
  if (!bot || !chatId) return;

  try {
    const response = await axios.get(GAMERPOWER_API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Loot0800-Bot/2.5' }
    });

    const games = response.data;
    if (!Array.isArray(games) || games.length === 0) {
      return bot.sendMessage(chatId, '🎁 Nenhuma DLC ou Loot ativo no momento.');
    }

    const user = await getUser(chatId);
    let userPreferences = DEFAULT_PREFERENCES;
    if (user && user.preferences) {
      userPreferences = typeof user.preferences === 'string'
        ? JSON.parse(user.preferences)
        : user.preferences;
    }

    // Força tipo loot ativo respeitando as lojas do usuário
    const effectivePreferences = Array.isArray(userPreferences)
      ? [...userPreferences, 'type:loot']
      : [...DEFAULT_PREFERENCES, 'type:loot'];

    const lootItems = games.filter((g) => {
      const itemType = (g.type || '').toLowerCase();
      const isLoot = itemType.includes('dlc') || itemType.includes('loot') || itemType.includes('other');
      return isLoot && isGameMatchingPreferences(g, effectivePreferences);
    });

    if (lootItems.length === 0) {
      return bot.sendMessage(
        chatId,
        '🎁 Nenhuma DLC ativa para as suas lojas selecionadas. Use /config para ativar mais lojas!'
      );
    }

    let message = `🎁 <b>LISTA COMPLETA: TODAS AS DLCS & LOOTS ATIVOS (${lootItems.length})</b>\n\n`;

    lootItems.forEach((loot, idx) => {
      const cleanTitle = loot.title.replace(/\s*Giveaway\s*/gi, '').trim();
      const price = loot.worth && loot.worth !== 'N/A' ? `<s>${loot.worth}</s> ➔ <b>GRÁTIS</b>` : '<b>GRÁTIS</b>';
      message += `${idx + 1}. <a href="${loot.open_giveaway_url}">${cleanTitle}</a> (${loot.platforms}) — ${price}\n`;
    });

    message += `\n⚡ <i>Toque no nome do item para resgatar!</i>`;

    // Divisão segura em partes caso ultrapasse o limite de caracteres
    if (message.length > 3800) {
      const lines = message.split('\n');
      let chunk = '';
      for (const line of lines) {
        if ((chunk + '\n' + line).length > 3800) {
          await bot.sendMessage(chatId, chunk, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
          chunk = line;
        } else {
          chunk = chunk ? chunk + '\n' + line : line;
        }
      }
      if (chunk) {
        await bot.sendMessage(chatId, chunk, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
      }
    } else {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    }
  } catch (error) {
    console.error(`[Worker] Erro ao enviar todas as DLCs para ${chatId}:`, error.message);
    bot.sendMessage(chatId, '❌ Erro ao consultar todas as DLCs. Tente novamente em instantes.');
  }
}

module.exports = {
  checkAndNotifyGames,
  sendActiveGamesCatalog,
  sendAllLootsToUser,
  sendRecentGamesToUser: sendActiveGamesCatalog,
  formatGameCaption,
  isGameMatchingPreferences,
  isTemporaryOrFreeWeekend
};
