const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Lista de lojas padrão suportadas na v2.0
const DEFAULT_PREFERENCES = [
  'epic',
  'steam',
  'gog',
  'amazon',
  'playstation',
  'xbox',
  'switch',
  'itch',
  'android',
  'ios'
];

// Caminho do arquivo de banco de dados SQLite dentro do diretório data
const dbPath = path.resolve(__dirname, 'data', 'database.sqlite');

// Garante que o diretório data exista antes de abrir a conexão
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Database] Erro ao conectar ao SQLite:', err.message);
  } else {
    console.log('[Database] Conectado ao banco de dados SQLite (data/database.sqlite).');
  }
});

// Inicialização das tabelas
db.serialize(() => {
  // 1. Tabela de Usuários
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id TEXT PRIMARY KEY,
      preferences TEXT DEFAULT '${JSON.stringify(DEFAULT_PREFERENCES)}'
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
    const defaultPrefsStr = JSON.stringify(DEFAULT_PREFERENCES);
    const sql = `INSERT OR IGNORE INTO users (chat_id, preferences) VALUES (?, ?)`;
    db.run(sql, [String(chatId), defaultPrefsStr], function (err) {
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
 * Retorna os dados de um usuário pelo chatId.
 * @param {string|number} chatId - ID do chat do Telegram
 * @param {function} [callback] - Callback opcional (err, user)
 */
function getUser(chatId, callback) {
  const promise = new Promise((resolve, reject) => {
    const sql = `SELECT * FROM users WHERE chat_id = ?`;
    db.get(sql, [String(chatId)], (err, row) => {
      if (err) {
        console.error(`[Database] Erro ao buscar usuário ${chatId}:`, err.message);
        return reject(err);
      }
      resolve(row || null);
    });
  });

  if (callback) {
    promise.then((row) => callback(null, row)).catch((err) => callback(err));
  }
  return promise;
}

/**
 * Atualiza as preferências de lojas do usuário.
 * @param {string|number} chatId - ID do chat do Telegram
 * @param {Array|string} preferences - Array de lojas ou string JSON
 * @param {function} [callback] - Callback opcional (err, result)
 */
function updateUserPreferences(chatId, preferences, callback) {
  const prefString = Array.isArray(preferences) ? JSON.stringify(preferences) : String(preferences);

  const promise = new Promise((resolve, reject) => {
    const sql = `UPDATE users SET preferences = ? WHERE chat_id = ?`;
    db.run(sql, [prefString, String(chatId)], function (err) {
      if (err) {
        console.error(`[Database] Erro ao atualizar preferências do usuário ${chatId}:`, err.message);
        return reject(err);
      }

      console.log(`[Database] Preferências atualizadas para o usuário ${chatId}: ${prefString}`);
      resolve({ chatId, preferences: prefString, changes: this.changes });
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
  DEFAULT_PREFERENCES,
  addUser,
  getUser,
  updateUserPreferences,
  getAllUsers,
  isGameNotified,
  markGameNotified
};
