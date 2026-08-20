const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Caminho do arquivo de banco de dados SQLite
const dbPath = path.resolve(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Database] Erro ao conectar ao SQLite:', err.message);
  } else {
    console.log('[Database] Conectado ao banco de dados SQLite (database.sqlite).');
  }
});

// Inicialização das tabelas
db.serialize(() => {
  // 1. Tabela de Usuários
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id TEXT PRIMARY KEY,
      preferences TEXT DEFAULT '["epic", "steam", "gog", "amazon"]'
    )
  `, (err) => {
    if (err) {
      console.error('[Database] Erro ao criar tabela users:', err.message);
    } else {
      console.log('[Database] Tabela "users" pronta para uso.');
    }
  });

  // 2. Tabela de Jogos Notificados (Anti-Spam / Histórico)
  db.run(`
    CREATE TABLE IF NOT EXISTS notified_games (
      id INTEGER PRIMARY KEY
    )
  `, (err) => {
    if (err) {
      console.error('[Database] Erro ao criar tabela notified_games:', err.message);
    } else {
      console.log('[Database] Tabela "notified_games" pronta para uso.');
    }
  });
});

/**
 * Registra um usuário no banco de dados caso ainda não exista.
 * @param {string|number} chatId - ID do chat do Telegram
 * @param {function} [callback] - Callback opcional (err, result)
 */
function addUser(chatId, callback) {
  const promise = new Promise((resolve, reject) => {
    const sql = `INSERT OR IGNORE INTO users (chat_id) VALUES (?)`;
    db.run(sql, [String(chatId)], function (err) {
      if (err) {
        console.error(`[Database] Erro ao registrar usuário ${chatId}:`, err.message);
        return reject(err);
      }

      const isNew = this.changes > 0;
      if (isNew) {
        console.log(`[Database] Novo usuário registrado: ${chatId}`);
      } else {
        console.log(`[Database] Usuário já registrado anteriormente: ${chatId}`);
      }

      resolve({ chatId, isNew });
    });
  });

  if (callback) {
    promise.then((res) => callback(null, res)).catch((err) => callback(err));
  }
  return promise;
}

/**
 * Retorna todos os usuários cadastrados.
 * @param {function} [callback] - Callback opcional (err, rows)
 */
function getAllUsers(callback) {
  const promise = new Promise((resolve, reject) => {
    const sql = `SELECT * FROM users`;
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('[Database] Erro ao buscar usuários:', err.message);
        return reject(err);
      }
      resolve(rows || []);
    });
  });

  if (callback) {
    promise.then((rows) => callback(null, rows)).catch((err) => callback(err));
  }
  return promise;
}

/**
 * Verifica se um jogo já foi notificado anteriormente.
 * @param {number|string} gameId - ID do jogo na GamerPower API
 * @param {function} [callback] - Callback opcional (err, isNotified)
 */
function isGameNotified(gameId, callback) {
  const promise = new Promise((resolve, reject) => {
    const sql = `SELECT id FROM notified_games WHERE id = ?`;
    db.get(sql, [Number(gameId)], (err, row) => {
      if (err) {
        console.error(`[Database] Erro ao verificar jogo ${gameId}:`, err.message);
        return reject(err);
      }
      resolve(Boolean(row));
    });
  });

  if (callback) {
    promise.then((exists) => callback(null, exists)).catch((err) => callback(err));
  }
  return promise;
}

/**
 * Marca um jogo como notificado no banco de dados.
 * @param {number|string} gameId - ID do jogo na GamerPower API
 * @param {function} [callback] - Callback opcional (err)
 */
function markGameNotified(gameId, callback) {
  const promise = new Promise((resolve, reject) => {
    const sql = `INSERT OR IGNORE INTO notified_games (id) VALUES (?)`;
    db.run(sql, [Number(gameId)], function (err) {
      if (err) {
        console.error(`[Database] Erro ao marcar jogo ${gameId} como notificado:`, err.message);
        return reject(err);
      }
      resolve();
    });
  });

  if (callback) {
    promise.then(() => callback(null)).catch((err) => callback(err));
  }
  return promise;
}

module.exports = {
  db,
  addUser,
  getAllUsers,
  isGameNotified,
  markGameNotified
};
