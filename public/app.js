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
let appConfig = { postId: null };
let currentFilters = {};

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
        setTimeout(() => bar.classList.add('hidden'), 4000);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const cfgResp = await fetch('/api/config');
        if (cfgResp.ok) {
            appConfig = await cfgResp.json();
        }
    } catch (cfgErr) {
        console.warn('Не удалось получить конфиг', cfgErr);
    }

    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        if (data.authenticated) {
            userRole = data.role;
            showMainInterface(data.username, data.role, appConfig);
        } else {
            showAuthForm();
        }
    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
        showAuthForm();
    }

    const hideBtn = hideRouteBtn();
    if (hideBtn) hideBtn.addEventListener('click', () => hideRoute());

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

    const applyFiltersBtn = document.getElementById('apply-filters');
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', () => {
            const filters = collectFilters();
            currentFilters = filters;
            loadTable(filters);
        });
    }
});

function showAuthForm() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('main-container').classList.add('hidden');
}

function showMainInterface(username, role) {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('main-container').classList.remove('hidden');

    const roleNames = { creator: 'Создатель', operator: 'Оператор' };
    document.getElementById('username-display').textContent = `${roleNames[role] || role}: ${username}`;

    if (role === 'creator') {
        document.getElementById('admin-panel').classList.remove('hidden');
        loadUsers();
    }

    initMap();
    loadObjects();
    loadTable(currentFilters);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildMarkerLabel(obj) {
    const post = obj.post_id ? `Пост ${escapeHtml(obj.post_id)}` : 'Пост -';
    const objectNum = obj.object_number ? `№ ${escapeHtml(obj.object_number)}` : '№ -';
    const name = obj.name ? escapeHtml(obj.name) : 'БПЛА';
    return `${post}<br>${objectNum}<br>${name}`;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    try {
        let response = await fetch('/api/creator-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        let data = await response.json();

        if (response.ok && data.status === 'ok') {
            userRole = data.role;
            showMainInterface(data.username, data.role, appConfig);
            return;
        }

        response = await fetch('/api/user-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        data = await response.json();

        if (response.ok && data.status === 'ok') {
            userRole = data.role;
            showMainInterface(data.username, data.role, appConfig);
        } else {
            errorMessage.textContent = data.error || 'Ошибка авторизации';
        }
    } catch (error) {
        console.error('Ошибка:', error);
        errorMessage.textContent = 'Ошибка соединения с сервером';
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await fetch('/api/logout', { method: 'POST' });
        showAuthForm();
        if (map) {
            map.remove();
            map = null;
        }
        hideRoute();
    } catch (error) {
        console.error('Ошибка выхода:', error);
    }
});

function initMap() {
    map = L.map('map').setView([55.7558, 37.6173], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

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
                moveMode = false;
                moveOriginalId = null;
                const banner = document.getElementById('move-banner');
                if (banner) banner.classList.add('hidden');
                await refreshData();
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

async function loadObjects() {
    try {
        const response = await fetch('/api/objects');
        if (!response.ok) throw new Error('Ошибка загрузки объектов');
        objects = await response.json();
        displayObjects();
    } catch (error) {
        console.error('Ошибка загрузки объектов:', error);
        setStatus('Ошибка загрузки объектов', 'error');
    }
}

async function refreshData() {
    await Promise.all([loadObjects(), loadTable(currentFilters)]);
}

function displayObjects() {
    Object.values(objectLayers).forEach(marker => map.removeLayer(marker));
    objectLayers = {};

    const objectsList = document.getElementById('markers-list');
    objectsList.innerHTML = '';

    if (objects.length === 0) {
        objectsList.innerHTML = '<p style="color: #999; text-align: center;">Нет объектов</p>';
        return;
    }

    const canManage = userRole === 'creator' || userRole === 'operator';
    const canDelete = userRole === 'creator';

    objects.forEach(obj => {
        if (obj.lat && obj.lon) {
            const marker = L.marker([obj.lat, obj.lon], { draggable: false })
                .addTo(map)
                .bindPopup(`
                    <h3>${obj.name || 'Объект ' + obj.object_number}</h3>
                    <p>Номер: ${obj.object_number}</p>
                    <p>Частота: ${obj.frequency || '-'}</p>
                    <p>Телеметрия: ${obj.telemetry || '-'}</p>
                    <p>По улитке: ${obj.by_snail || '-'}</p>
                    <p>Пост: ${obj.post_id || '-'}</p>
                    <p>${obj.is_finished ? 'Завершено' : 'Активно'}</p>
                    <p><small>СК-42: X=${obj.x || '-'}, Y=${obj.y || '-'}</small></p>
                    <p><small>WGS-84: ${obj.lat.toFixed(6)}, ${obj.lon.toFixed(6)}</small></p>
                `);
            marker.bindTooltip(buildMarkerLabel(obj), {
                permanent: true,
                direction: 'top',
                offset: [0, -18],
                className: 'marker-label'
            });
            if (marker.dragging) marker.dragging.disable();

            marker.on('click', () => {
                highlightListItem(obj.original_id);
                map.setView([obj.lat, obj.lon], 12);
                marker.openPopup();
                setStatus(`Выбрали объект #${obj.object_number}`, 'info');
            });

            marker.on('dragend', async (ev) => {
                if (!(moveMode && moveOriginalId === obj.original_id)) {
                    marker.setLatLng([obj.lat, obj.lon]);
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
                    moveMode = false;
                    moveOriginalId = null;
                    const banner = document.getElementById('move-banner');
                    if (banner) banner.classList.add('hidden');
                    const iconEl = marker._icon;
                    if (iconEl) {
                        const toast = document.createElement('div');
                        toast.className = 'marker-toast';
                        toast.textContent = 'Перемещено';
                        iconEl.appendChild(toast);
                        setTimeout(() => toast.remove(), 1500);
                    }
                    await refreshData();
                    setStatus('Позиция обновлена (перетаскивание)', 'info');
                } catch (err) {
                    console.error(err);
                    setStatus('Не удалось переместить объект', 'error');
                    marker.setLatLng([obj.lat, obj.lon]);
                }
            });

            objectLayers[obj.id] = marker;
        }

        const objectItem = document.createElement('div');
        objectItem.className = 'marker-item';

        const finishBadge = obj.is_finished ? '<span class="badge-finished">Завершено</span>' : '';
        const metaPieces = [
            `№ ${obj.object_number}`,
            obj.post_id ? `Пост ${obj.post_id}` : null,
            obj.by_snail ? `Улитка ${obj.by_snail}` : null,
            obj.is_finished ? 'Статус: завершено' : 'Статус: активно'
        ].filter(Boolean).join(' · ');

        const deleteButton = canDelete ? `<button class="delete-btn" data-id="${obj.id}">Удалить</button>` : '';
        const finishButton = canManage && !obj.is_finished ? `<button class="btn btn-secondary finish-btn" data-original="${obj.original_id}">Завершить</button>` : '';
        const moveBtn = canManage ? `<button class="btn btn-secondary move-btn" data-original="${obj.original_id}">Переместить</button>` : '';
        const updateBtn = canManage ? `<button class="btn btn-secondary update-btn" data-id="${obj.id}">Дополнить</button>` : '';
        const routeBtn = `<button class="btn btn-secondary route-btn" data-original="${obj.original_id}">Маршрут</button>`;

        objectItem.innerHTML = `
            <h3>${obj.name || 'Объект ' + obj.object_number} ${finishBadge}</h3>
            <div class="meta-row">${metaPieces}</div>
            <p>Частота: ${obj.frequency || '-'}</p>
            <p>Телеметрия: ${obj.telemetry || '-'}</p>
            <p class="coords">СК-42: X=${obj.x || '-'}, Y=${obj.y || '-'}</p>
            <div class="btn-row">${routeBtn} ${moveBtn} ${finishButton} ${updateBtn} ${deleteButton}</div>
        `;

        objectItem.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-btn')) return;
            if (obj.lat && obj.lon) {
                map.setView([obj.lat, obj.lon], 12);
                const marker = objectLayers[obj.id];
                if (marker) marker.openPopup();
                setStatus(`Выбрали объект #${obj.object_number}`, 'info');
            }
        });

        objectItem.addEventListener('dblclick', () => objectItem.classList.toggle('collapsed'));

        if (activeRouteId && obj.original_id === activeRouteId) {
            objectItem.classList.add('active');
        }

        const routeBtnEl = objectItem.querySelector('.route-btn');
        if (routeBtnEl) {
            routeBtnEl.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const orig = routeBtnEl.getAttribute('data-original');
                showRoute(orig);
            });
        }

        const moveBtnEl = objectItem.querySelector('.move-btn');
        if (moveBtnEl) {
            moveBtnEl.addEventListener('click', (ev) => {
                ev.stopPropagation();
                moveOriginalId = Number(moveBtnEl.getAttribute('data-original'));
                moveMode = true;
                setStatus('Режим перемещения: кликните на карте новую позицию или перетяните маркер', 'warn', true);
                const banner = document.getElementById('move-banner');
                if (banner) banner.classList.remove('hidden');
                Object.entries(objectLayers).forEach(([id, marker]) => {
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

        const finishBtn = objectItem.querySelector('.finish-btn');
        if (finishBtn) {
            finishBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const orig = Number(finishBtn.getAttribute('data-original'));
                try {
                    const resp = await fetch('/api/objects/finish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ original_id: orig })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Ошибка завершения');
                    setStatus('Информирование завершено', 'info');
                    await refreshData();
                } catch (e) {
                    console.error(e);
                    setStatus('Не удалось завершить информирование', 'error');
                }
            });
        }

        const updateBtnEl = objectItem.querySelector('.update-btn');
        if (updateBtnEl) {
            updateBtnEl.addEventListener('click', (ev) => {
                ev.stopPropagation();
                openUpdateModal(obj);
            });
        }

        const deleteBtnEl = objectItem.querySelector('.delete-btn');
        if (deleteBtnEl) {
            deleteBtnEl.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                await deleteObject(obj.id);
            });
        }

        objectsList.appendChild(objectItem);
    });

    const validObjects = objects.filter(o => o.lat && o.lon);
    if (validObjects.length > 0) {
        const bounds = L.latLngBounds(validObjects.map(o => [o.lat, o.lon]));
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

function highlightListItem(originalId) {
    const items = document.querySelectorAll('.marker-item');
    items.forEach(el => {
        const btn = el.querySelector('.route-btn');
        if (btn && Number(btn.getAttribute('data-original')) === Number(originalId)) {
            el.classList.add('active');
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            el.classList.remove('active');
        }
    });
}

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
        if (hideBtn) hideBtn.disabled = false;
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

async function deleteObject(id) {
    if (!confirm('Удалить этот объект?')) return;
    try {
        const response = await fetch('/api/objects/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (!response.ok) throw new Error('Ошибка удаления объекта');
        await refreshData();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка удаления объекта');
    }
}

const modal = document.getElementById('add-marker-modal');
const addMarkerBtn = document.getElementById('add-marker-btn');
const closeBtn = document.querySelector('.close');
const cancelBtn = document.querySelector('.cancel-btn');

if (addMarkerBtn) {
    addMarkerBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        const center = map.getCenter();
        document.getElementById('marker-lat').value = center.lat.toFixed(6);
        document.getElementById('marker-lng').value = center.lng.toFixed(6);
    });
}

if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

window.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
});

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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, frequency, telemetry, lat, lon, datetime, by_snail })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка добавления объекта');
        modal.classList.add('hidden');
        document.getElementById('add-marker-form').reset();
        await refreshData();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка добавления объекта');
    }
});

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error('Ошибка загрузки пользователей');
        const users = await response.json();
        displayUsers(users);
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

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
            <div class="user-main">
                <span><strong>Оператор:</strong> ${user.username}</span>
                <div class="operator-post-controls">
                    <label>Пост:</label>
                    <input type="number" class="operator-post-input" min="1" step="1" value="${user.post_id || ''}">
                    <button class="btn btn-secondary save-post-btn" data-username="${user.username}">Сохранить</button>
                </div>
            </div>
            <button class="delete-btn" data-username="${user.username}">Удалить</button>
        `;

        const delBtn = userItem.querySelector('.delete-btn');
        delBtn.addEventListener('click', async () => await deleteUser(user.username));

        const savePostBtn = userItem.querySelector('.save-post-btn');
        if (savePostBtn) {
            savePostBtn.addEventListener('click', async () => {
                const input = userItem.querySelector('.operator-post-input');
                const post = input ? Number(input.value) : NaN;
                await updateOperatorPost(user.username, post);
            });
        }

        usersList.appendChild(userItem);
    });
}

async function updateOperatorPost(username, post_id) {
    if (!Number.isInteger(post_id) || post_id <= 0) {
        alert('Укажите корректный номер поста (целое число > 0)');
        return;
    }
    try {
        const response = await fetch('/api/users/set-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, post_id })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка сохранения номера поста');
        await loadUsers();
        setStatus(`Номер поста для ${username} обновлён`, 'info');
    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message || 'Ошибка сохранения номера поста');
    }
}

async function deleteUser(username) {
    if (!confirm(`Удалить пользователя ${username}?`)) return;
    try {
        const response = await fetch('/api/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.error || 'Ошибка удаления пользователя');
        } else {
            await loadUsers();
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка удаления пользователя');
    }
}

const userModal = document.getElementById('add-user-modal');
const addUserBtn = document.getElementById('add-user-btn');
const closeUserBtn = document.querySelector('.close-user');
const cancelUserBtn = document.querySelector('.cancel-user-btn');
const userPostInput = document.getElementById('user-post-id');

if (addUserBtn) {
    addUserBtn.addEventListener('click', () => {
        userModal.classList.remove('hidden');
    });
}
if (closeUserBtn) closeUserBtn.addEventListener('click', () => userModal.classList.add('hidden'));
if (cancelUserBtn) cancelUserBtn.addEventListener('click', () => userModal.classList.add('hidden'));

window.addEventListener('click', (e) => {
    if (e.target === userModal) userModal.classList.add('hidden');
});

document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = 'operator';
    const username = document.getElementById('user-username').value;
    const password = document.getElementById('user-password').value;
    const postRaw = userPostInput ? userPostInput.value : '';
    const post_id = Number(postRaw);

    try {
        const response = await fetch('/api/users/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, username, password, post_id })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка создания пользователя');
        userModal.classList.add('hidden');
        document.getElementById('add-user-form').reset();
        await loadUsers();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка создания пользователя');
    }
});

document.getElementById('export-word-btn').addEventListener('click', () => {
    window.location.href = '/api/export/word';
});

const updateModal = document.getElementById('update-marker-modal');
const closeUpdateBtn = document.querySelector('.close-update');
const cancelUpdateBtn = document.querySelector('.cancel-update-btn');

if (closeUpdateBtn) closeUpdateBtn.addEventListener('click', () => hideUpdateModal());
if (cancelUpdateBtn) cancelUpdateBtn.addEventListener('click', () => hideUpdateModal());
window.addEventListener('click', (e) => {
    if (e.target === updateModal) hideUpdateModal();
});

document.getElementById('update-marker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = Number(document.getElementById('update-id').value);
    const name = document.getElementById('update-name').value;
    const frequency = document.getElementById('update-frequency').value;
    const telemetry = document.getElementById('update-telemetry').value;
    const lat = parseFloat(document.getElementById('update-lat').value);
    const lon = parseFloat(document.getElementById('update-lng').value);
    const snailRaw = document.getElementById('update-snail').value;
    const by_snail = snailRaw !== '' ? Number(snailRaw) : undefined;
    const datetime = new Date().toISOString();

    try {
        const response = await fetch('/api/objects/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, frequency, telemetry, lat, lon, datetime, by_snail })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка сохранения объекта');
        hideUpdateModal();
        await refreshData();
        setStatus('Версия объекта сохранена', 'info');
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка сохранения объекта');
    }
});

function openUpdateModal(obj) {
    document.getElementById('update-id').value = obj.id;
    document.getElementById('update-name').value = obj.name || '';
    document.getElementById('update-frequency').value = obj.frequency || '';
    document.getElementById('update-telemetry').value = obj.telemetry || '';
    document.getElementById('update-lat').value = obj.lat || '';
    document.getElementById('update-lng').value = obj.lon || '';
    document.getElementById('update-snail').value = obj.by_snail || '';
    updateModal.classList.remove('hidden');
}

function hideUpdateModal() {
    updateModal.classList.add('hidden');
    document.getElementById('update-marker-form').reset();
}

function collectFilters() {
    return {
        name: document.getElementById('filter-name').value.trim(),
        frequency: document.getElementById('filter-frequency').value.trim(),
        date_from: document.getElementById('filter-from').value.trim(),
        date_to: document.getElementById('filter-to').value.trim(),
        post_id: document.getElementById('filter-post').value.trim(),
        by_snail: document.getElementById('filter-snail').value.trim()
    };
}

async function loadTable(filters = {}) {
    try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                params.append(key, value);
            }
        });
        const qs = params.toString();
        const resp = await fetch(`/api/objects/filter${qs ? '?' + qs : ''}`);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Ошибка фильтра');
        renderTable(data);
    } catch (error) {
        console.error('Ошибка загрузки таблицы:', error);
        const container = document.getElementById('objects-table');
        if (container) container.innerHTML = '<div style="padding:8px; color:#c00;">Не удалось загрузить таблицу</div>';
    }
}

function renderTable(data) {
    const container = document.getElementById('objects-table');
    if (!container) return;
    if (!data || data.length === 0) {
        container.innerHTML = '<div style="padding:8px; color:#777;">Нет данных</div>';
        return;
    }

    const rows = data.map(obj => {
        const status = obj.is_finished ? 'Завершено' : 'Активно';
        return `
            <tr data-original="${obj.original_id}">
                <td>${obj.object_number || ''}</td>
                <td>${obj.name || ''}</td>
                <td>${obj.frequency || ''}</td>
                <td>${obj.telemetry || ''}</td>
                <td>${obj.by_snail || ''}</td>
                <td>${obj.post_id || ''}</td>
                <td>${status}</td>
                <td>${obj.datetime ? new Date(obj.datetime).toLocaleString('ru-RU') : ''}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>№</th>
                    <th>Название</th>
                    <th>Частота</th>
                    <th>Телеметрия</th>
                    <th>Улитка</th>
                    <th>Пост</th>
                    <th>Статус</th>
                    <th>Обновлено</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const orig = tr.getAttribute('data-original');
            showRoute(orig, true, false);
        });
    });
}
