// Глобальные переменные
let map;
let objects = [];
let objectLayers = {};
let userRole = '';

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        
        if (data.authenticated) {
            userRole = data.role;
            showMainInterface(data.username, data.role);
        } else {
            showAuthForm();
        }
    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
        showAuthForm();
    }
});

// Показать форму авторизации
function showAuthForm() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('main-container').classList.add('hidden');
}

// Показать основной интерфейс
function showMainInterface(username, role) {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('main-container').classList.remove('hidden');
    
    const roleNames = {
        'creator': 'Создатель',
        'admin': 'Администратор',
        'operator': 'Оператор'
    };
    
    document.getElementById('username-display').textContent = `${roleNames[role] || role}: ${username}`;
    
    // Показываем панель управления пользователями для Creator
    if (role === 'creator') {
        document.getElementById('admin-panel').classList.remove('hidden');
        loadUsers();
    }
    
    initMap();
    loadObjects();
}

// Обработка формы входа
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    
    try {
        // Пробуем войти как Creator
        let response = await fetch('/api/creator-login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        let data = await response.json();
        
        if (response.ok && data.status === 'ok') {
            userRole = data.role;
            showMainInterface(data.username, data.role);
            return;
        }
        
        // Если не Creator, пробуем Admin/Operator
        response = await fetch('/api/user-login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        data = await response.json();
        
        if (response.ok && data.status === 'ok') {
            userRole = data.role;
            showMainInterface(data.username, data.role);
        } else {
            errorMessage.textContent = data.error || 'Ошибка авторизации';
        }
    } catch (error) {
        console.error('Ошибка:', error);
        errorMessage.textContent = 'Ошибка соединения с сервером';
    }
});

// Выход
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await fetch('/api/logout', { method: 'POST' });
        showAuthForm();
        
        // Очистка карты
        if (map) {
            map.remove();
            map = null;
        }
    } catch (error) {
        console.error('Ошибка выхода:', error);
    }
});

// Инициализация карты
function initMap() {
    // Создаем карту с центром в Москве
    map = L.map('map').setView([55.7558, 37.6173], 5);
    
    // Добавляем слой OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Обработчик клика по карте для добавления меток
    map.on('click', (e) => {
        document.getElementById('marker-lat').value = e.latlng.lat.toFixed(6);
        document.getElementById('marker-lng').value = e.latlng.lng.toFixed(6);
    });
}

// Загрузка объектов с сервера
async function loadObjects() {
    try {
        const response = await fetch('/api/objects');
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки объектов');
        }
        
        objects = await response.json();
        displayObjects();
    } catch (error) {
        console.error('Ошибка загрузки объектов:', error);
        alert('Ошибка загрузки объектов');
    }
}

// Отображение объектов на карте и в списке
function displayObjects() {
    // Очистка существующих маркеров на карте
    Object.values(objectLayers).forEach(marker => map.removeLayer(marker));
    objectLayers = {};
    
    // Очистка списка
    const objectsList = document.getElementById('markers-list');
    objectsList.innerHTML = '';
    
    if (objects.length === 0) {
        objectsList.innerHTML = '<p style="color: #999; text-align: center;">Нет объектов</p>';
        return;
    }
    
    // Добавление объектов
    objects.forEach(obj => {
        // Добавление на карту (используем lon/lat из WGS-84)
        if (obj.lat && obj.lon) {
            const mapMarker = L.marker([obj.lat, obj.lon])
                .addTo(map)
                .bindPopup(`
                    <h3>${obj.name || 'Объект ' + obj.object_number}</h3>
                    <p>Номер: ${obj.object_number}</p>
                    <p>Частота: ${obj.frequency || '-'}</p>
                    <p>По улитке: ${obj.by_snail || '-'}</p>
                    <p><small>СК-42: X=${obj.x}, Y=${obj.y}</small></p>
                    <p><small>WGS-84: ${obj.lat.toFixed(6)}, ${obj.lon.toFixed(6)}</small></p>
                `);
            
            objectLayers[obj.id] = mapMarker;
        }
        
        // Добавление в список
        const objectItem = document.createElement('div');
        objectItem.className = 'marker-item';
        
        // Показываем кнопку удаления только для Creator и Admin
        const deleteButton = (userRole === 'creator' || userRole === 'admin') 
            ? `<button class="delete-btn" onclick="deleteObject(${obj.id})">Удалить</button>` 
            : '';
        
        objectItem.innerHTML = `
            <h3>${obj.name || 'Объект ' + obj.object_number}</h3>
            <p>Номер: ${obj.object_number}</p>
            <p>Частота: ${obj.frequency || '-'}</p>
            <p class="coords">СК-42: X=${obj.x || '-'}, Y=${obj.y || '-'}</p>
            ${deleteButton}
        `;
        
        objectItem.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-btn') && obj.lat && obj.lon) {
                map.setView([obj.lat, obj.lon], 12);
                objectLayers[obj.id].openPopup();
            }
        });
        
        objectsList.appendChild(objectItem);
    });
    
    // Центрирование карты на всех объектах
    if (objects.length > 0) {
        const validObjects = objects.filter(o => o.lat && o.lon);
        if (validObjects.length > 0) {
            const bounds = L.latLngBounds(validObjects.map(o => [o.lat, o.lon]));
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
}

// Удаление объекта
async function deleteObject(id) {
    if (!confirm('Удалить этот объект?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/objects/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id })
        });
        
        if (response.ok) {
            await loadObjects();
        } else {
            throw new Error('Ошибка удаления объекта');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка удаления объекта');
    }
}

// Модальное окно добавления объекта
const modal = document.getElementById('add-marker-modal');
const addMarkerBtn = document.getElementById('add-marker-btn');
const closeBtn = document.querySelector('.close');
const cancelBtn = document.querySelector('.cancel-btn');

addMarkerBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    // Установка текущего центра карты (в WGS-84)
    const center = map.getCenter();
    document.getElementById('marker-lat').value = center.lat.toFixed(6);
    document.getElementById('marker-lng').value = center.lng.toFixed(6);
});

closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
});

cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
});

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
    }
});

// Обработка формы добавления объекта
document.getElementById('add-marker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('marker-name').value;
    const frequency = document.getElementById('marker-description').value;
    const lat = parseFloat(document.getElementById('marker-lat').value);
    const lon = parseFloat(document.getElementById('marker-lng').value);
    const datetime = new Date().toISOString();
    
    try {
        const response = await fetch('/api/objects/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, frequency, lat, lon, datetime })
        });
        
        if (response.ok) {
            modal.classList.add('hidden');
            document.getElementById('add-marker-form').reset();
            await loadObjects();
        } else {
            const data = await response.json();
            alert(data.error || 'Ошибка добавления объекта');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка добавления объекта');
    }
});

// ===== Управление пользователями =====

// Загрузка списка пользователей
async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки пользователей');
        }
        
        const users = await response.json();
        displayUsers(users);
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

// Отображение списка пользователей
function displayUsers(users) {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = '';
    
    if (users.length === 0) {
        usersList.innerHTML = '<p style="color: #999;">Нет пользователей</p>';
        return;
    }
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.innerHTML = `
            <span><strong>${user.role === 'admin' ? 'Администратор' : 'Оператор'}:</strong> ${user.username}</span>
            <button class="delete-btn" onclick="deleteUser('${user.username}')">Удалить</button>
        `;
        usersList.appendChild(userItem);
    });
}

// Удаление пользователя
async function deleteUser(username) {
    if (!confirm(`Удалить пользователя ${username}?`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/users/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });
        
        if (response.ok) {
            await loadUsers();
        } else {
            const data = await response.json();
            alert(data.error || 'Ошибка удаления пользователя');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка удаления пользователя');
    }
}

// Модальное окно добавления пользователя
const userModal = document.getElementById('add-user-modal');
const addUserBtn = document.getElementById('add-user-btn');
const closeUserBtn = document.querySelector('.close-user');
const cancelUserBtn = document.querySelector('.cancel-user-btn');

addUserBtn.addEventListener('click', () => {
    userModal.classList.remove('hidden');
});

closeUserBtn.addEventListener('click', () => {
    userModal.classList.add('hidden');
});

cancelUserBtn.addEventListener('click', () => {
    userModal.classList.add('hidden');
});

window.addEventListener('click', (e) => {
    if (e.target === userModal) {
        userModal.classList.add('hidden');
    }
});

// Обработка формы добавления пользователя
document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const role = document.getElementById('user-role').value;
    const username = document.getElementById('user-username').value;
    const password = document.getElementById('user-password').value;
    
    try {
        const response = await fetch('/api/users/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ role, username, password })
        });
        
        if (response.ok) {
            userModal.classList.add('hidden');
            document.getElementById('add-user-form').reset();
            await loadUsers();
        } else {
            const data = await response.json();
            alert(data.error || 'Ошибка создания пользователя');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка создания пользователя');
    }
});

// Экспорт в Word
document.getElementById('export-word-btn').addEventListener('click', async () => {
    try {
        window.location.href = '/api/export/word';
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        alert('Ошибка при экспорте данных');
    }
});
