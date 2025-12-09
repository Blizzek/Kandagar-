const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация базы данных
const db = new Database('kandagar.db');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Создание тестового пользователя (admin/admin) если его нет
const checkUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!checkUser) {
  const hashedPassword = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashedPassword);
  console.log('Создан тестовый пользователь: admin/admin');
}

// Добавление тестовых меток если их нет
const markerCount = db.prepare('SELECT COUNT(*) as count FROM markers').get();
if (markerCount.count === 0) {
  const insertMarker = db.prepare('INSERT INTO markers (name, description, latitude, longitude) VALUES (?, ?, ?, ?)');
  insertMarker.run('Точка 1', 'Тестовая метка 1', 55.7558, 37.6173); // Москва
  insertMarker.run('Точка 2', 'Тестовая метка 2', 59.9343, 30.3351); // Санкт-Петербург
  insertMarker.run('Точка 3', 'Тестовая метка 3', 56.8389, 60.6057); // Екатеринбург
  console.log('Добавлены тестовые метки');
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'kandagar-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 часа
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

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
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

// Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
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
  const markers = db.prepare('SELECT * FROM markers ORDER BY created_at DESC').all();
  res.json(markers);
});

// Добавление метки
app.post('/api/markers', requireAuth, (req, res) => {
  const { name, description, latitude, longitude } = req.body;
  
  if (!name || !latitude || !longitude) {
    return res.status(400).json({ error: 'Укажите название, широту и долготу' });
  }

  const result = db.prepare('INSERT INTO markers (name, description, latitude, longitude) VALUES (?, ?, ?, ?)')
    .run(name, description || '', latitude, longitude);
  
  const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(result.lastInsertRowid);
  res.json(marker);
});

// Удаление метки
app.delete('/api/markers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM markers WHERE id = ?').run(id);
  res.json({ success: true });
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
