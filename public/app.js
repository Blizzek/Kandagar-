// Глобальные переменные
let map;
let objects = [];
let objectLayers = {};
let routeLayer = null;
let activeRouteId = null;
let routeInterval = null;
let moveMode = false;
let moveOriginalId = null;
let userRole = '';

const statusBar = () => document.getElementById('status-bar');
const hideRouteBtn = () => document.getElementById('hide-route-btn');

function setStatus(message, type = 'info', persist = false) {
    const bar = statusBar();
    if (!bar) return;
    bar.textContent = message || '';
    bar.classList.remove('hidden', 'warn', 'error');
    if (type === 'warn') bar.classList.add('warn');
    else if (type === 'error') bar.classList.add('error');
    if (!persist) {
        setTimeout(() => {
            bar.classList.add('hidden');
        }, 4000);
    }
}

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const cfgResp = await fetch('/api/config');
        const cfg = await cfgResp.json();
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        
        if (data.authenticated) {
            userRole = data.role;
            showMainInterface(data.username, data.role, cfg);
        } else {
            showAuthForm();
        }
    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
        showAuthForm();
    }

    const hideBtn = hideRouteBtn();
    if (hideBtn) {
        hideBtn.addEventListener('click', () => hideRoute());
    }
    const exportWord = document.getElementById('export-word-btn');
    if (exportWord) exportWord.addEventListener('click', () => window.location.href = '/api/export/word');

    // Обработчик отмены режима перемещения
    const cancelMoveBtn = document.getElementById('cancel-move-btn');
    if (cancelMoveBtn) {
        cancelMoveBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            moveMode = false;
            moveOriginalId = null;
            const banner = document.getElementById('move-banner');
            if (banner) banner.classList.add('hidden');
            setStatus('Режим перемещения отменён', 'info');
        });
    }
});

// Показать форму авторизации
function showAuthForm() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('main-container').classList.add('hidden');
}

// Показать основной интерфейс
function showMainInterface(username, role, cfg = {}) {
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
    // Клиентский режим: скрыть кнопки редактирования и обновлять каждые 40 сек только позиции
    if (cfg.clientMode) {
        const addBtn = document.getElementById('add-marker-btn');
        if (addBtn) addBtn.classList.add('hidden');
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.add('hidden');
        setInterval(async () => { await loadObjects(); }, 40000);
    }
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
        hideRoute();
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
    
    // Обработчик клика по карте для добавления меток и перемещения объекта
    map.on('click', async (e) => {
        if (moveMode && moveOriginalId) {
            try {
                const resp = await fetch('/api/objects/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ original_id: moveOriginalId, lon: e.latlng.lng, lat: e.latlng.lat })
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Ошибка перемещения');
                moveMode = false; moveOriginalId = null;
                const banner = document.getElementById('move-banner');
                if (banner) banner.classList.add('hidden');
                await loadObjects();
                setStatus('Позиция обновлена', 'info');
            } catch (err) {
                console.error(err);
                setStatus('Не удалось переместить объект', 'error');
            }
            return;
        }
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

    // Снимаем предыдущий маршрут
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    
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
            const mapMarker = L.marker([obj.lat, obj.lon], { draggable: true })
                .addTo(map)
                .bindPopup(`
                    <h3>${obj.name || 'Объект ' + obj.object_number}</h3>
                    <p>Номер: ${obj.object_number}</p>
                    <p>Частота: ${obj.frequency || '-'}</p>
                    <p>По улитке: ${obj.by_snail || '-'}</p>
                    <p><small>СК-42: X=${obj.x}, Y=${obj.y}</small></p>
                    <p><small>WGS-84: ${obj.lat.toFixed(6)}, ${obj.lon.toFixed(6)}</small></p>
                `);
            
            // По умолчанию перетаскивание выключено, включаем только в режиме перемещения
            if (mapMarker.dragging) mapMarker.dragging.disable();

            // Клик по маркеру — выделяем объект в списке
            mapMarker.on('click', () => {
                // Найти и подсветить элемент списка соответствующего объекта
                const items = document.querySelectorAll('.marker-item');
                items.forEach(el => {
                    const btn = el.querySelector('.route-btn');
                    if (btn && Number(btn.getAttribute('data-original')) === obj.original_id) {
                        el.classList.add('active');
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } else {
                        el.classList.remove('active');
                    }
                });
                // Фокус на маркере
                map.setView([obj.lat, obj.lon], 12);
                mapMarker.openPopup();
                setStatus(`Выбрали объект #${obj.object_number}`, 'info');
            });

            // Перемещение маркера перетаскиванием (активно только в moveMode)
            mapMarker.on('dragend', async (ev) => {
                if (!(moveMode && moveOriginalId === obj.original_id)) {
                    // Откатываем позицию если не в режиме перемещения данного объекта
                    mapMarker.setLatLng([obj.lat, obj.lon]);
                    return;
                }
                const pos = ev.target.getLatLng();
                try {
                    const resp = await fetch('/api/objects/move', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ original_id: obj.original_id, lon: pos.lng, lat: pos.lat })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Ошибка перемещения');
                    moveMode = false; moveOriginalId = null;
                    const banner = document.getElementById('move-banner');
                    if (banner) banner.classList.add('hidden');
                    // Мини-уведомление возле маркера
                    const iconEl = mapMarker._icon;
                    if (iconEl) {
                        const toast = document.createElement('div');
                        toast.className = 'marker-toast';
                        toast.textContent = 'Перемещено';
                        iconEl.appendChild(toast);
                        setTimeout(() => { if (toast && toast.parentNode) toast.parentNode.removeChild(toast); }, 1500);
                    }
                    await loadObjects();
                    setStatus('Позиция обновлена (перетаскивание)', 'info');
                } catch (err) {
                    console.error(err);
                    setStatus('Не удалось переместить объект', 'error');
                    // Возвращаем маркер назад
                    mapMarker.setLatLng([obj.lat, obj.lon]);
                }
            });

            objectLayers[obj.id] = mapMarker;
        }
        
        // Добавление в список
        const objectItem = document.createElement('div');
        objectItem.className = 'marker-item';
        
        // Показываем кнопки в зависимости от роли
        const deleteButton = (userRole === 'creator' || userRole === 'admin') 
            ? `<button class="delete-btn" onclick="deleteObject(${obj.id})">Удалить</button>` 
            : '';
        const finishButton = (userRole === 'creator' || userRole === 'admin' || userRole === 'operator') && !obj.is_finished
            ? `<button class="btn btn-secondary finish-btn" data-original="${obj.original_id}">Завершить</button>`
            : '';
        const canMove = (userRole === 'creator' || userRole === 'admin' || userRole === 'operator');
        const moveBtn = canMove ? `<button class="btn btn-secondary move-btn" data-original="${obj.original_id}">Переместить</button>` : '';
        const routeBtn = `<button class="btn btn-secondary route-btn" data-original="${obj.original_id}">Маршрут</button>`;
        const exportBtns = ``;
        
        objectItem.innerHTML = `
            <h3>${obj.name || 'Объект ' + obj.object_number}</h3>
            <p>Номер: ${obj.object_number}</p>
            <p>Частота: ${obj.frequency || '-'}</p>
            <p class="coords">СК-42: X=${obj.x || '-'}, Y=${obj.y || '-'}</p>
            <div class="btn-row">${routeBtn} ${moveBtn} ${finishButton} ${deleteButton}</div>
                    const fBtn = objectItem.querySelector('.finish-btn');
                    if (fBtn) {
                        fBtn.addEventListener('click', async (ev) => {
                            ev.stopPropagation();
                            const orig = Number(fBtn.getAttribute('data-original'));
                            try {
                                const resp = await fetch('/api/objects/finish', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ original_id: orig })
                                });
                                const data = await resp.json();
                                if (!resp.ok) throw new Error(data.error || 'Ошибка завершения');
                                setStatus('Информирование завершено', 'info');
                                await loadObjects();
                            } catch (e) {
                                console.error(e);
                                setStatus('Не удалось завершить информирование', 'error');
                            }
                        });
                    }
            <div class="btn-row">${exportBtns}</div>
        `;
        
        objectItem.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-btn') && obj.lat && obj.lon) {
                map.setView([obj.lat, obj.lon], 12);
                objectLayers[obj.id].openPopup();
                setStatus(`Выбрали объект #${obj.object_number}`, 'info');
            }
        });

        if (activeRouteId && obj.original_id === activeRouteId) {
            objectItem.classList.add('active');
        }
        
        // Навешиваем обработчики на кнопки маршрута/перемещения
        const rBtn = objectItem.querySelector('.route-btn');
        if (rBtn) {
            rBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const orig = rBtn.getAttribute('data-original');
                showRoute(orig);
            });
        }
        const mBtn = objectItem.querySelector('.move-btn');
        if (mBtn) {
            mBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                moveOriginalId = Number(mBtn.getAttribute('data-original'));
                moveMode = true;
                setStatus('Режим перемещения: кликните на карте новую позицию', 'warn', true);
                const banner = document.getElementById('move-banner');
                if (banner) banner.classList.remove('hidden');
                // Включаем перетаскивание для соответствующего маркера
                Object.entries(objectLayers).forEach(([id, marker]) => {
                    // Найдём объект по id маркера
                    const objData = objects.find(o => o.id === Number(id));
                    if (!objData || !marker.dragging) return;
                    if (objData.original_id === moveOriginalId) {
                        marker.dragging.enable();
                        if (marker._icon) marker._icon.classList.add('draggable-active');
                    } else {
                        marker.dragging.disable();
                        if (marker._icon) marker._icon.classList.remove('draggable-active');
                    }
                });
            });
        }
        // Убраны кнопки экспорта GeoJSON/GPX

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

// Показ маршрута объекта
async function showRoute(originalId, startTracking = true, silent = false) {
    try {
        const resp = await fetch(`/api/object-route/${originalId}`);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Ошибка получения маршрута');
        if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
        const pts = data.route.filter(p => p.lat && p.lon).map(p => [p.lat, p.lon]);
        if (pts.length === 0) { if (!silent) setStatus('Нет координат для маршрута', 'warn'); return; }
        routeLayer = L.polyline(pts, { color: '#ff6600', weight: 3 }).addTo(map);
        map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
        activeRouteId = Number(originalId);
        updateActiveListItem();
        const hideBtn = hideRouteBtn();
        if (hideBtn) { hideBtn.disabled = false; }
        if (!silent) setStatus(`Маршрут #${originalId} отображён`, 'info');
        if (startTracking) startRouteTracking(Number(originalId));
    } catch (e) {
        console.error(e);
        if (!silent) setStatus('Не удалось показать маршрут', 'error');
    }
}

function updateActiveListItem() {
    const items = document.querySelectorAll('.marker-item');
    items.forEach(el => {
        const btn = el.querySelector('.route-btn');
        if (btn && Number(btn.getAttribute('data-original')) === activeRouteId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function startRouteTracking(id) {
    clearInterval(routeInterval);
    routeInterval = setInterval(() => {
        if (activeRouteId === id) {
            showRoute(id, false, true);
        }
    }, 5000);
}

function hideRoute() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    activeRouteId = null;
    clearInterval(routeInterval);
    updateActiveListItem();
    const hideBtn = hideRouteBtn();
    if (hideBtn) hideBtn.disabled = true;
    setStatus('Маршрут скрыт', 'info');
}

// Удалён экспорт маршрутов в GeoJSON/GPX

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
    const telemetry = document.getElementById('marker-telemetry').value;
    const lat = parseFloat(document.getElementById('marker-lat').value);
    const lon = parseFloat(document.getElementById('marker-lng').value);
    const snailRaw = document.getElementById('marker-snail').value;
    const by_snail = snailRaw !== '' ? Number(snailRaw) : undefined;
    const datetime = new Date().toISOString();
    
    try {
        const response = await fetch('/api/objects/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, frequency, telemetry, lat, lon, datetime, by_snail })
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
