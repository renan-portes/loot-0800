const axios = require('axios');
const { getAllUsers, isGameNotified, markGameNotified } = require('./database');

const GAMERPOWER_API_URL = 'https://www.gamerpower.com/api/giveaways?platform=pc&type=game';
const MAX_GAMES_PER_RUN = 3; // Regra Anti-Spam: no máximo 3 jogos por execução

/**
 * Monta o texto chamativo da legenda da mensagem no Telegram.
 * @param {object} game - Dados do jogo vindos da API
 * @returns {string} - Legenda formatada em HTML
 */
function formatGameCaption(game) {
  const originalPrice = game.worth && game.worth !== 'N/A' ? `<s>${game.worth}</s> ➔ <b>GRÁTIS!</b>` : '<b>GRÁTIS!</b>';
  const platforms = game.platforms || 'PC';

  return (
    `🎮 <b>NOVO JOGO GRÁTIS DETECTADO!</b> 🎮\n\n` +
    `🕹️ <b>Título:</b> ${game.title}\n` +
    `💻 <b>Plataforma:</b> ${platforms}\n` +
    `💰 <b>Preço Original:</b> ${originalPrice}\n` +
    `🔗 <b>Resgate aqui:</b> <a href="${game.open_giveaway_url}">Clique para Resgatar</a>\n\n` +
    `⚡ <i>Aproveite antes que a promoção expire!</i>\n` +
    `⚙️ <i>Configure suas lojas com /config</i>`
  );
}

/**
 * Verifica se o jogo corresponde às preferências de lojas selecionadas pelo usuário.
 * @param {object} game - Dados do jogo da API
 * @param {Array<string>} userPreferences - Lista de lojas configuradas pelo usuário
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

    // Tratamento para variações de nomes
    if (p === 'itch' || p === 'itch.io' || p === 'itchio') {
      return gameContext.includes('itch');
    }
    if (p === 'amazon' || p === 'prime') {
      return gameContext.includes('amazon') || gameContext.includes('prime');
    }

    return gameContext.includes(p);
  });
}

/**
 * Busca jogos gratuitos na GamerPower API e notifica os usuários cadastrados com base em suas preferências.
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
      headers: { 'User-Agent': 'Loot0800-Bot/1.0' }
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
        let userPreferences = ['epic', 'steam', 'gog', 'amazon'];
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

module.exports = {
  checkAndNotifyGames,
  formatGameCaption,
  isGameMatchingPreferences
};
