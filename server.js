const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ПРИМЕЧАНИЕ: Для продакшена рекомендуется добавить:
// - Rate limiting (например, express-rate-limit)
// - CSRF защиту (например, csurf)
// - Helmet для HTTP заголовков безопасности
// - HTTPS/SSL сертификаты

// Инициализация базы данных
const db = new sqlite3.Database('kandagar.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err);
  } else {
    console.log('Подключено к БД');
  }
});

// Создание таблиц
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Создание тестового пользователя (admin/admin) если его нет
  db.get('SELECT * FROM users WHERE username = ?', ['admin'], (err, row) => {
    if (err) {
      console.error('Ошибка при проверке пользователя:', err);
    } else if (!row) {
      const hashedPassword = bcrypt.hashSync('admin', 10);
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hashedPassword], (err) => {
        if (err) {
          console.error('Ошибка при создании пользователя:', err);
        } else {
          console.log('Создан тестовый пользователь: admin/admin');
        }
      });
    }
  });

  // Добавление тестовых меток если их нет
  db.get('SELECT COUNT(*) as count FROM markers', (err, row) => {
    if (err) {
      console.error('Ошибка при подсчете меток:', err);
    } else if (row.count === 0) {
      db.run('INSERT INTO markers (name, description, latitude, longitude) VALUES (?, ?, ?, ?)', 
        ['Точка 1', 'Тестовая метка 1', 55.7558, 37.6173]);
      db.run('INSERT INTO markers (name, description, latitude, longitude) VALUES (?, ?, ?, ?)', 
        ['Точка 2', 'Тестовая метка 2', 59.9343, 30.3351]);
      db.run('INSERT INTO markers (name, description, latitude, longitude) VALUES (?, ?, ?, ?)', 
        ['Точка 3', 'Тестовая метка 3', 56.8389, 60.6057], (err) => {
        if (!err) {
          console.log('Добавлены тестовые метки');
        }
      });
    }
  });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'kandagar-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    secure: process.env.NODE_ENV === 'production', // HTTPS в продакшене
    httpOnly: true, // Защита от XSS
    sameSite: 'strict' // Защита от CSRF
  }
}));

// Проверка авторизации
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Требуется авторизация' });
  }
}

// API endpoints
// Авторизация
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const isValid = bcrypt.compareSync(password, user.password);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
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
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// Получение меток
app.get('/api/markers', requireAuth, (req, res) => {
  db.all('SELECT * FROM markers ORDER BY created_at DESC', (err, markers) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json(markers);
  });
});

// Добавление метки
app.post('/api/markers', requireAuth, (req, res) => {
  const { name, description, latitude, longitude } = req.body;
  
  if (!name || !latitude || !longitude) {
    return res.status(400).json({ error: 'Укажите название, широту и долготу' });
  }

  db.run('INSERT INTO markers (name, description, latitude, longitude) VALUES (?, ?, ?, ?)',
    [name, description || '', latitude, longitude],
    function(err) {
      if (err) {
        console.error('Ошибка БД:', err);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      
      db.get('SELECT * FROM markers WHERE id = ?', [this.lastID], (err, marker) => {
        if (err) {
          console.error('Ошибка БД:', err);
          return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(marker);
      });
    });
});

// Удаление метки
app.delete('/api/markers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM markers WHERE id = ?', [id], (err) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json({ success: true });
  });
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
});
