require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { z } = require('zod');
const { sk42ToWGS84, wgs84ToSK42 } = require('./coordinate-converter');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'kandagar-secret-key-change-in-production';
const SESSION_STORE = (process.env.SESSION_STORE || 'sqlite').toLowerCase();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const CLIENT_MODE = (process.env.CLIENT_MODE || 'false').toLowerCase() === 'true';
const GLOBAL_POST_ID = process.env.POST_ID ? Number(process.env.POST_ID) : null;

// ПРИМЕЧАНИЕ: Для продакшена рекомендуется добавить:
// - Rate limiting (например, express-rate-limit)
// - CSRF защиту (например, csurf)
// - Helmet для HTTP заголовков безопасности
// - HTTPS/SSL сертификаты 

// Определение пути к базе данных: приоритет --db=, затем ENV DB_PATH, затем значение по умолчанию
function resolveDbPath() {
  const arg = (process.argv || []).find(a => typeof a === 'string' && a.startsWith('--db='));
  if (arg) {
    const p = arg.slice(5).trim();
    if (p) return p;
  }
  if (process.env.DB_PATH && process.env.DB_PATH.trim()) {
    return process.env.DB_PATH.trim();
  }
  return 'kandagar.db';
}

const DB_PATH = resolveDbPath();

// Инициализация базы данных
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err);
  } else {
    console.log(`Подключено к БД: ${DB_PATH}`);
  }
});

// Создание таблиц
db.serialize(() => {
  // Таблица создателей системы (Creator)
  db.run(`
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Таблица администраторов (Admin)
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Таблица операторов (Operator)
  db.run(`
    CREATE TABLE IF NOT EXISTS operators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Таблица объектов на карте с версионированием
  db.run(`
    CREATE TABLE IF NOT EXISTS objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_id INTEGER,
      object_number TEXT NOT NULL,
      datetime DATETIME,
      name TEXT,
      frequency TEXT,
      telemetry TEXT,
      x REAL,
      y REAL,
      by_snail TEXT,
      post_id INTEGER,
      is_finished INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (original_id) REFERENCES objects(id)
    )
  `);

  // Пытаемся добавить колонку is_finished, если её ещё нет
  db.run('ALTER TABLE objects ADD COLUMN is_finished INTEGER DEFAULT 0', (err) => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      number INTEGER UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица попыток входа (для блокировки по IP)
  db.run(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_blocked INTEGER DEFAULT 0
    )
  `);

  // Таблица журнала входов
  db.run(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      success INTEGER DEFAULT 0,
      role TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Создание Creator по умолчанию (creator/creator) если его нет
  db.get('SELECT * FROM creators WHERE username = ?', ['creator'], (err, row) => {
    if (err) {
      console.error('Ошибка при проверке creator:', err);
    } else if (!row) {
      const hashedPassword = bcrypt.hashSync('creator', 10);
      db.run('INSERT INTO creators (username, password) VALUES (?, ?)', ['creator', hashedPassword], (err) => {
        if (err) {
          console.error('Ошибка при создании creator:', err);
        } else {
          console.log('Создан тестовый создатель: creator/creator');
        }
      });
    }
  });

  // Создание тестового Admin (admin/admin) если его нет
  db.get('SELECT * FROM admins WHERE username = ?', ['admin'], (err, row) => {
    if (err) {
      console.error('Ошибка при проверке admin:', err);
    } else if (!row) {
      const hashedPassword = bcrypt.hashSync('admin', 10);
      db.run('INSERT INTO admins (username, password) VALUES (?, ?)', ['admin', hashedPassword], (err) => {
        if (err) {
          console.error('Ошибка при создании admin:', err);
        } else {
          console.log('Создан тестовый администратор: admin/admin');
        }
      });
    }
  });

  // Создание тестового Operator (operator/operator) если его нет
  db.get('SELECT * FROM operators WHERE username = ?', ['operator'], (err, row) => {
    if (err) {
      console.error('Ошибка при проверке operator:', err);
    } else if (!row) {
      const hashedPassword = bcrypt.hashSync('operator', 10);
      db.run('INSERT INTO operators (username, password) VALUES (?, ?)', ['operator', hashedPassword], (err) => {
        if (err) {
          console.error('Ошибка при создании operator:', err);
        } else {
          console.log('Создан тестовый оператор: operator/operator');
        }
      });
    }
  });

  // Добавление тестовых объектов если их нет
  db.get('SELECT COUNT(*) as count FROM objects', (err, row) => {
    if (err) {
      console.error('Ошибка при подсчете объектов:', err);
    } else if (row.count === 0) {
      const now = new Date().toISOString();
      db.run('INSERT INTO objects (object_number, datetime, name, frequency, x, y, by_snail, original_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
        ['1', now, 'Объект 1', '150.5', 37500000, 6200000, 'Да', null], function(err) {
          if (!err) {
            db.run('UPDATE objects SET original_id = ? WHERE id = ?', [this.lastID, this.lastID]);
          }
        });
      db.run('INSERT INTO objects (object_number, datetime, name, frequency, x, y, by_snail, original_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
        ['2', now, 'Объект 2', '200.3', 37510000, 6210000, 'Нет', null], function(err) {
          if (!err) {
            db.run('UPDATE objects SET original_id = ? WHERE id = ?', [this.lastID, this.lastID]);
          }
        });
      db.run('INSERT INTO objects (object_number, datetime, name, frequency, x, y, by_snail, original_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
        ['3', now, 'Объект 3', '175.8', 37520000, 6220000, 'Да', null], function(err) {
        if (!err) {
          db.run('UPDATE objects SET original_id = ? WHERE id = ?', [this.lastID, this.lastID]);
          console.log('Добавлены тестовые объекты');
        }
      });
    }
  });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// Базовая защита заголовков
app.use(helmet());
// Лимит запросов (смягчённый для разработки)
const limiter = rateLimit({ windowMs: 60 * 1000, max: process.env.NODE_ENV === 'production' ? 100 : 500 });
app.use(limiter);
// За доверенным прокси выставлять secure cookie
app.set('trust proxy', 1);
app.use(pinoHttp({ logger }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: SESSION_STORE === 'sqlite' ? new SQLiteStore({ db: 'sessions.sqlite', dir: './' }) : undefined,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    secure: process.env.NODE_ENV === 'production', // HTTPS в продакшене
    httpOnly: true, // Защита от XSS
    sameSite: 'strict' // Защита от CSRF
  }
}));

// Константы для блокировки
const BLOCK_TIME_MS = 5 * 60 * 1000; // 5 минут
const MAX_ATTEMPTS = 3;

// Вспомогательные функции для IP блокировки
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.ip;
}

function isIPBlocked(ip, callback) {
  db.get('SELECT * FROM login_attempts WHERE ip = ?', [ip], (err, row) => {
    if (err) {
      console.error('Ошибка проверки IP:', err);
      return callback(false);
    }
    if (!row) {
      return callback(false);
    }
    
    const lastAttempt = new Date(row.last_attempt);
    const now = new Date();
    const timeDiff = now - lastAttempt;
    
    if (row.is_blocked && timeDiff < BLOCK_TIME_MS) {
      return callback(true);
    }
    
    if (row.is_blocked && timeDiff >= BLOCK_TIME_MS) {
      db.run('UPDATE login_attempts SET is_blocked = 0, attempts = 0 WHERE ip = ?', [ip]);
      return callback(false);
    }
    
    callback(false);
  });
}

function registerFailedAttempt(ip) {
  db.get('SELECT * FROM login_attempts WHERE ip = ?', [ip], (err, row) => {
    if (err) {
      console.error('Ошибка регистрации попытки:', err);
      return;
    }
    
    const now = new Date().toISOString();
    
    if (!row) {
      db.run('INSERT INTO login_attempts (ip, attempts, last_attempt, is_blocked) VALUES (?, ?, ?, ?)',
        [ip, 1, now, 0]);
    } else {
      const newAttempts = row.attempts + 1;
      const isBlocked = newAttempts >= MAX_ATTEMPTS ? 1 : 0;
      db.run('UPDATE login_attempts SET attempts = ?, last_attempt = ?, is_blocked = ? WHERE ip = ?',
        [newAttempts, now, isBlocked, ip]);
    }
  });
}

function clearAttempts(ip) {
  db.run('DELETE FROM login_attempts WHERE ip = ?', [ip]);
}

function logLogin(username, ip, success, role) {
  const now = new Date().toISOString();
  db.run('INSERT INTO login_logs (username, ip, success, role, timestamp) VALUES (?, ?, ?, ?, ?)',
    [username, ip, success ? 1 : 0, role, now]);
}

// Проверка авторизации для разных ролей
function requireCreator(req, res, next) {
  if (req.session.role === 'creator') {
    next();
  } else {
    res.status(403).json({ error: 'Требуется авторизация создателя' });
  }
}

function requireAdmin(req, res, next) {
  if (req.session.role === 'admin' || req.session.role === 'creator') {
    next();
  } else {
    res.status(403).json({ error: 'Требуется авторизация администратора' });
  }
}

function requireOperatorOrAdmin(req, res, next) {
  if (req.session.role === 'operator' || req.session.role === 'admin' || req.session.role === 'creator') {
    next();
  } else {
    res.status(401).json({ error: 'Требуется авторизация' });
  }
}

function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Требуется авторизация' });
  }
}

// Схемы валидации
const credsSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const createUserSchema = z.object({ role: z.enum(['admin', 'operator']), username: z.string().min(1), password: z.string().min(1) });
const deleteUserSchema = z.object({ username: z.string().min(1) });
const moveSchema = z.object({
  id: z.number().int().positive().optional(),
  original_id: z.number().int().positive().optional(),
  lon: z.union([z.string(), z.number()]).transform(Number),
  lat: z.union([z.string(), z.number()]).transform(Number),
  datetime: z.string().optional(),
  name: z.string().optional(),
  frequency: z.string().optional(),
  by_snail: z.string().optional()
}).refine(data => data.id || data.original_id, { message: 'Укажите id или original_id' });
const objectCreateSchema = z.object({
  id: z.number().int().positive().optional(),
  object_number: z.string().optional(),
  datetime: z.string().optional(),
  name: z.string().optional(),
  frequency: z.string().optional(),
  lon: z.union([z.string(), z.number()]).transform(Number).optional(),
  lat: z.union([z.string(), z.number()]).transform(Number).optional(),
  by_snail: z.union([z.string(), z.number()]).optional(),
  telemetry: z.string().optional()
});

// API endpoints
// Конфиг для фронтенда
app.get('/api/config', (req, res) => {
  res.json({ clientMode: CLIENT_MODE, postId: GLOBAL_POST_ID });
});
// Логин Creator
app.post('/api/creator-login', (req, res) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }
  const { username, password } = parsed.data;
  const ip = getClientIP(req);
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  isIPBlocked(ip, (blocked) => {
    if (blocked) {
      return res.status(403).json({ error: 'IP заблокирован, попробуйте позже' });
    }

    db.get('SELECT * FROM creators WHERE username = ?', [username], (err, creator) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }

      const isValid = creator && bcrypt.compareSync(password, creator.password);
      logLogin(username, ip, isValid, 'creator');

      if (!isValid) {
        registerFailedAttempt(ip);
        return res.status(401).json({ error: 'Неверный логин или пароль' });
      }

      clearAttempts(ip);
      req.session.userId = creator.id;
      req.session.username = creator.username;
      req.session.role = 'creator';
      res.json({ status: 'ok', role: 'creator', username: creator.username });
    });
  });
});

// Логин Admin/Operator
app.post('/api/user-login', (req, res) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }
  const { username, password } = parsed.data;
  const ip = getClientIP(req);
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  isIPBlocked(ip, (blocked) => {
    if (blocked) {
      return res.status(403).json({ error: 'IP заблокирован, попробуйте позже' });
    }

    // Сначала проверяем в таблице админов
    db.get('SELECT * FROM admins WHERE username = ?', [username], (err, admin) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }

      if (admin) {
        const isValid = bcrypt.compareSync(password, admin.password);
        logLogin(username, ip, isValid, 'admin');

        if (!isValid) {
          registerFailedAttempt(ip);
          return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        clearAttempts(ip);
        req.session.userId = admin.id;
        req.session.username = admin.username;
        req.session.role = 'admin';
        return res.json({ status: 'ok', role: 'admin', username: admin.username });
      }

      // Если не нашли в админах, проверяем операторов
      db.get('SELECT * FROM operators WHERE username = ?', [username], (err, operator) => {
        if (err) {
          console.error('Ошибка БД:', err);
          return res.status(500).json({ error: 'Ошибка сервера' });
        }

        const isValid = operator && bcrypt.compareSync(password, operator.password);
        logLogin(username, ip, isValid, 'operator');

        if (!isValid) {
          registerFailedAttempt(ip);
          return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        clearAttempts(ip);
        req.session.userId = operator.id;
        req.session.username = operator.username;
        req.session.role = 'operator';
        res.json({ status: 'ok', role: 'operator', username: operator.username });
      });
    });
  });
});

// Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе:', err);
      return res.status(500).json({ error: 'Ошибка при выходе из системы' });
    }
    res.json({ success: true });
  });
});

// Проверка авторизации
app.get('/api/check-auth', (req, res) => {
  if (req.session.userId) {
    res.json({ 
      authenticated: true, 
      username: req.session.username,
      role: req.session.role 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Создание пользователей (только Creator)
app.post('/api/users/create', requireCreator, (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Укажите роль, логин и пароль' });
  }
  const { role, username, password } = parsed.data;

  const hashedPassword = bcrypt.hashSync(password, 10);
  
  if (role === 'admin') {
    db.get('SELECT * FROM admins WHERE username = ?', [username], (err, existing) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      if (existing) {
        return res.status(400).json({ error: 'Админ с таким логином уже существует' });
      }
      
      db.run('INSERT INTO admins (username, password) VALUES (?, ?)', 
        [username, hashedPassword], (err) => {
        if (err) {
          console.error('Ошибка БД:', err);
          return res.status(500).json({ error: 'Ошибка при создании администратора' });
        }
        res.json({ status: 'ok' });
      });
    });
  } else if (role === 'operator') {
    db.get('SELECT * FROM operators WHERE username = ?', [username], (err, existing) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      if (existing) {
        return res.status(400).json({ error: 'Оператор с таким логином уже существует' });
      }
      
      db.run('INSERT INTO operators (username, password) VALUES (?, ?)', 
        [username, hashedPassword], (err) => {
        if (err) {
          console.error('Ошибка БД:', err);
          return res.status(500).json({ error: 'Ошибка при создании оператора' });
        }
        res.json({ status: 'ok' });
      });
    });
  } else {
    res.status(400).json({ error: 'Неверный тип пользователя' });
  }
});

// Удаление пользователя (Creator и Admin могут удалять операторов, только Creator - админов)
app.post('/api/users/delete', (req, res) => {
  const parsed = deleteUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Не указан username' });
  }
  const { username } = parsed.data;

  // Creator может удалять всех
  if (req.session.role === 'creator') {
    db.get('SELECT * FROM admins WHERE username = ?', [username], (err, admin) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      
      if (admin) {
        db.run('DELETE FROM admins WHERE username = ?', [username], (err) => {
          if (err) {
            console.error('Ошибка БД:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
          }
          return res.json({ status: 'ok' });
        });
      } else {
        db.run('DELETE FROM operators WHERE username = ?', [username], (err) => {
          if (err) {
            console.error('Ошибка БД:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
          }
          res.json({ status: 'ok' });
        });
      }
    });
  } 
  // Admin может удалять только операторов
  else if (req.session.role === 'admin') {
    db.run('DELETE FROM operators WHERE username = ?', [username], (err) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      res.json({ status: 'ok' });
    });
  } else {
    res.status(403).json({ error: 'Недостаточно прав' });
  }
});

// Список пользователей
app.get('/api/users', requireCreator, (req, res) => {
  const users = [];
  
  db.all('SELECT id, username FROM admins', (err, admins) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    
    admins.forEach(a => users.push({ role: 'admin', username: a.username }));
    
    db.all('SELECT id, username FROM operators', (err, operators) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      
      operators.forEach(o => users.push({ role: 'operator', username: o.username }));
      res.json(users);
    });
  });
});

// Получение объектов (возвращаем только последние версии)
app.get('/api/objects', requireOperatorOrAdmin, (req, res) => {
  db.all('SELECT * FROM objects ORDER BY original_id, datetime', (err, allObjects) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    
    // Группируем по original_id и берем последние версии
    const lastByOriginal = {};
    allObjects.forEach(obj => {
      const origId = obj.original_id || obj.id;
      lastByOriginal[origId] = obj;
    });
    
    const result = Object.values(lastByOriginal).map(obj => {
      // Конвертируем СК-42 в WGS-84 для отображения на карте
      let wgs = null;
      if (obj.x && obj.y) {
        try {
          wgs = sk42ToWGS84(obj.x, obj.y);
        } catch (e) {
          console.error('Ошибка конвертации координат:', e);
        }
      }
      
      return {
        id: obj.id,
        original_id: obj.original_id || obj.id,
        object_number: obj.object_number,
        datetime: obj.datetime,
        name: obj.name,
        frequency: obj.frequency,
        telemetry: obj.telemetry,
        x: obj.x, // СК-42 X (восток)
        y: obj.y, // СК-42 Y (север)
        lon: wgs ? wgs.lon : null, // WGS-84 долгота
        lat: wgs ? wgs.lat : null, // WGS-84 широта
        by_snail: obj.by_snail,
        post_id: obj.post_id,
        is_finished: obj.is_finished
      };
    });
    
    res.json(result);
  });
});

// Фильтр/табличное представление последних версий
app.get('/api/objects/filter', requireOperatorOrAdmin, (req, res) => {
  const { name, frequency, date_from, date_to, post_id, by_snail, sort = 'datetime', dir = 'desc' } = req.query;
  const conditions = [];
  const params = [];

  if (name) { conditions.push('o.name LIKE ?'); params.push(`%${name}%`); }
  if (frequency) { conditions.push('o.frequency LIKE ?'); params.push(`%${frequency}%`); }
  if (post_id) { conditions.push('o.post_id = ?'); params.push(Number(post_id)); }
  if (by_snail) { conditions.push('o.by_snail = ?'); params.push(String(by_snail)); }
  if (date_from) { conditions.push('o.datetime >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('o.datetime <= ?'); params.push(date_to); }

  const sortable = ['datetime', 'frequency', 'name', 'object_number', 'post_id'];
  const safeSort = sortable.includes(sort) ? sort : 'datetime';
  const safeDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT o.* FROM objects o
    JOIN (
      SELECT original_id, MAX(datetime) as max_dt FROM objects GROUP BY original_id
    ) last ON o.original_id = last.original_id AND o.datetime = last.max_dt
    ${where}
    ORDER BY o.${safeSort} ${safeDir}
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    const result = rows.map(obj => {
      let wgs = null;
      if (obj.x && obj.y) {
        try { wgs = sk42ToWGS84(obj.x, obj.y); } catch (e) { console.error('Ошибка конвертации:', e); }
      }
      return {
        id: obj.id,
        original_id: obj.original_id || obj.id,
        object_number: obj.object_number,
        datetime: obj.datetime,
        name: obj.name,
        frequency: obj.frequency,
        telemetry: obj.telemetry,
        x: obj.x,
        y: obj.y,
        lon: wgs ? wgs.lon : null,
        lat: wgs ? wgs.lat : null,
        by_snail: obj.by_snail,
        post_id: obj.post_id,
        is_finished: obj.is_finished
      };
    });
    res.json(result);
  });
});

// Получение маршрута объекта (все версии по original_id)
app.get('/api/object-route/:original_id', requireOperatorOrAdmin, (req, res) => {
  const { original_id } = req.params;
  
  db.all('SELECT * FROM objects WHERE original_id = ? OR id = ? ORDER BY datetime', 
    [original_id, original_id], (err, points) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    
    if (!points || points.length === 0) {
      return res.status(404).json({ error: 'Объект не найден' });
    }
    
    const route = points.map(p => {
      // Конвертируем СК-42 в WGS-84 для каждой точки маршрута
      let wgs = null;
      if (p.x && p.y) {
        try {
          wgs = sk42ToWGS84(p.x, p.y);
        } catch (e) {
          console.error('Ошибка конвертации координат:', e);
        }
      }
      
      return {
        id: p.id,
        datetime: p.datetime,
        x: p.x,
        y: p.y,
        lon: wgs ? wgs.lon : null,
        lat: wgs ? wgs.lat : null,
        frequency: p.frequency,
        name: p.name
      };
    });
    
    res.json({ status: 'ok', route });
  });
});

// Экспорт маршрута в GeoJSON

// Экспорт маршрута в GPX

// Получение следующего номера объекта
app.get('/api/objects/next-number', requireOperatorOrAdmin, (req, res) => {
  db.get('SELECT MAX(CAST(object_number AS INTEGER)) as max_num FROM objects', (err, row) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    
    const nextNumber = (row && row.max_num ? row.max_num : 0) + 1;
    res.json({ next_number: nextNumber });
  });
});

// Создание/редактирование объекта (с версионированием)
app.post('/api/objects/create', requireOperatorOrAdmin, (req, res) => {
  const parsed = objectCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Укажите корректные данные' });
  }
  const { id, object_number, datetime, name, frequency, lon, lat, by_snail, telemetry } = parsed.data;
  
  if ((lon === undefined) || (lat === undefined)) {
    return res.status(400).json({ error: 'Укажите координаты (lon, lat)' });
  }

  // Конвертируем WGS-84 в СК-42 для хранения
  let sk42;
  try {
    sk42 = wgs84ToSK42(parseFloat(lon), parseFloat(lat));
  } catch (e) {
    console.error('Ошибка конвертации координат:', e);
    return res.status(400).json({ error: 'Неверные координаты' });
  }

  // Если передан ID - это редактирование, создаем новую версию
  if (id) {
    db.get('SELECT * FROM objects WHERE id = ?', [id], (err, oldObj) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      
      if (!oldObj) {
        return res.status(404).json({ error: 'Объект не найден' });
      }

      const origId = oldObj.original_id || oldObj.id;
      const now = new Date().toISOString();
      
      const snail = (by_snail !== undefined && by_snail !== null && by_snail !== '') ? String(by_snail) : (oldObj.by_snail || '9');
      db.run(`INSERT INTO objects (original_id, object_number, datetime, name, frequency, telemetry, x, y, by_snail, post_id, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [origId, oldObj.object_number, datetime, name || oldObj.name, frequency || oldObj.frequency, 
         telemetry || oldObj.telemetry || '', sk42.x, sk42.y, snail, GLOBAL_POST_ID, now],
        function(err) {
          if (err) {
            console.error('Ошибка БД:', err);
            return res.status(500).json({ error: 'Ошибка при создании версии' });
          }
          
          res.json({ status: 'ok', new_id: this.lastID });
        });
    });
  } else {
    // Создание нового объекта
    const now = new Date().toISOString();
    
    // Определяем номер объекта
    let objNumber = object_number;
    if (!objNumber) {
      db.get('SELECT MAX(CAST(object_number AS INTEGER)) as max_num FROM objects', (err, row) => {
        if (err) {
          console.error('Ошибка БД:', err);
          return res.status(500).json({ error: 'Ошибка сервера' });
        }
        
        objNumber = String((row && row.max_num ? row.max_num : 0) + 1);
        createNewObject();
      });
      return;
    }
    
    createNewObject();
    
    function createNewObject() {
      const snail = (by_snail !== undefined && by_snail !== null && by_snail !== '') ? String(by_snail) : '9';
      db.run(`INSERT INTO objects (object_number, datetime, name, frequency, telemetry, x, y, by_snail, post_id, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [objNumber, datetime, name || '', frequency || '', telemetry || '', sk42.x, sk42.y, snail, GLOBAL_POST_ID, now],
        function(err) {
          if (err) {
            console.error('Ошибка БД:', err);
            return res.status(500).json({ error: 'Ошибка при создании объекта' });
          }
          
          const newId = this.lastID;
          
          // Устанавливаем original_id = id для нового объекта
          db.run('UPDATE objects SET original_id = ? WHERE id = ?', [newId, newId], (err) => {
            if (err) {
              console.error('Ошибка БД:', err);
            }
            res.json({ status: 'ok', id: newId });
          });
        });
    }
  }
});

// Перемещение объекта (создание новой версии по id/ original_id)
app.post('/api/objects/move', requireOperatorOrAdmin, (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Укажите данные' });
  }
  const { id, original_id, lon, lat, datetime, name, frequency, by_snail } = parsed.data;

  // Конвертация координат
  let sk42;
  try {
    sk42 = wgs84ToSK42(parseFloat(lon), parseFloat(lat));
  } catch (e) {
    console.error('Ошибка конвертации координат:', e);
    return res.status(400).json({ error: 'Неверные координаты' });
  }

  const when = datetime || new Date().toISOString();

  // Ищем базовую версию по id или original_id
  const findSql = original_id
    ? 'SELECT * FROM objects WHERE original_id = ? ORDER BY datetime DESC LIMIT 1'
    : 'SELECT * FROM objects WHERE id = ?';
  const findParam = original_id ? [original_id] : [id];

  db.get(findSql, findParam, (err, base) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    if (!base) {
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const origId = base.original_id || base.id;
    const now = new Date().toISOString();

        const snail = (by_snail !== undefined && by_snail !== null && by_snail !== '') ? String(by_snail) : (base.by_snail || '9');
        db.run(`INSERT INTO objects (original_id, object_number, datetime, name, frequency, telemetry, x, y, by_snail, post_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [origId, base.object_number, when, name || base.name, frequency || base.frequency, base.telemetry || '',
       sk42.x, sk42.y, snail, GLOBAL_POST_ID, now],
      function(insErr) {
        if (insErr) {
          console.error('Ошибка БД:', insErr);
          return res.status(500).json({ error: 'Ошибка при создании версии' });
        }
        res.json({ status: 'ok', new_id: this.lastID, original_id: origId });
      });
  });
});

// Завершить информирование о БпЛА (пометить последнюю версию как завершённую)
app.post('/api/objects/finish', requireOperatorOrAdmin, (req, res) => {
  const { original_id } = req.body;
  if (!original_id) {
    return res.status(400).json({ error: 'Не указан original_id' });
  }
  db.get('SELECT id FROM objects WHERE original_id = ? ORDER BY datetime DESC LIMIT 1', [original_id], (err, row) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Объект не найден' });
    }
    db.run('UPDATE objects SET is_finished = 1 WHERE id = ?', [row.id], (uerr) => {
      if (uerr) {
        console.error('Ошибка БД:', uerr);
        return res.status(500).json({ error: 'Не удалось завершить информирование' });
      }
      res.json({ status: 'ok' });
    });
  });
});

// Удаление объекта (удаляет конкретную версию по id)
app.post('/api/objects/delete', requireOperatorOrAdmin, (req, res) => {
  const { id } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'Не указан ID объекта' });
  }

  db.get('SELECT * FROM objects WHERE id = ?', [id], (err, obj) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    
    if (!obj) {
      return res.status(404).json({ error: 'Объект не найден' });
    }

    db.run('DELETE FROM objects WHERE id = ?', [id], (err) => {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      res.json({ status: 'ok' });
    });
  });
});

// Экспорт всех объектов в Word (.docx)
app.get('/api/export/word', requireOperatorOrAdmin, (req, res) => {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun } = require('docx');
  
  db.all('SELECT * FROM objects ORDER BY original_id, datetime', (err, objects) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: 'Выгрузка объектов БПЛА',
                bold: true,
                size: 32
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Дата выгрузки: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`,
                size: 24
              })
            ]
          }),
          new Paragraph({ text: '' }),
          ...generateObjectsTables(objects)
        ]
      }]
    });

    Packer.toBuffer(doc).then(buffer => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=export_objects_${Date.now()}.docx`);
      res.send(buffer);
    }).catch(error => {
      console.error('Ошибка создания документа:', error);
      res.status(500).json({ error: 'Ошибка создания документа' });
    });
  });
});

// Вспомогательная функция для генерации таблиц объектов
function generateObjectsTables(objects) {
  const { Paragraph, Table, TableRow, TableCell, WidthType, TextRun } = require('docx');
  const elements = [];
  
  if (objects.length === 0) {
    elements.push(new Paragraph({ text: 'Нет объектов для выгрузки' }));
    return elements;
  }

  let currentOriginal = null;
  let rows = [];

  objects.forEach((obj, index) => {
    const origId = obj.original_id || obj.id;
    
    if (origId !== currentOriginal) {
      // Если есть накопленная таблица - добавляем
      if (rows.length > 0) {
        elements.push(createTable(rows));
        elements.push(new Paragraph({ text: '' }));
      }
      
      // Новый объект - заголовок
      elements.push(new Paragraph({
        children: [
          new TextRun({
            text: `Объект #${origId}`,
            bold: true,
            size: 28
          })
        ]
      }));
      
      currentOriginal = origId;
      rows = [];
      
      // Заголовок таблицы
      rows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: 'ID версии' })] }),
          new TableCell({ children: [new Paragraph({ text: 'Дата/Время' })] }),
          new TableCell({ children: [new Paragraph({ text: 'Название' })] }),
          new TableCell({ children: [new Paragraph({ text: 'Частота' })] }),
          new TableCell({ children: [new Paragraph({ text: 'СК-42 (X, Y)' })] }),
          new TableCell({ children: [new Paragraph({ text: 'По улитке' })] })
        ]
      }));
    }
    
    // Добавляем строку данных
    rows.push(new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: String(obj.id) })] }),
        new TableCell({ children: [new Paragraph({ text: obj.datetime || '' })] }),
        new TableCell({ children: [new Paragraph({ text: obj.name || '' })] }),
        new TableCell({ children: [new Paragraph({ text: String(obj.frequency || '') })] }),
        new TableCell({ children: [new Paragraph({ text: `X=${obj.x}, Y=${obj.y}` })] }),
        new TableCell({ children: [new Paragraph({ text: obj.by_snail || '' })] })
      ]
    }));
    
    // Последний объект
    if (index === objects.length - 1 && rows.length > 0) {
      elements.push(createTable(rows));
    }
  });

  return elements;
}

function createTable(rows) {
  const { Table, WidthType } = require('docx');
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows
  });
}

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
});
