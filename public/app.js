// Глобальные переменные
let map;
let markers = [];
let markerLayers = {};

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        
        if (data.authenticated) {
            showMainInterface(data.username);
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
function showMainInterface(username) {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('main-container').classList.remove('hidden');
    document.getElementById('username-display').textContent = `Пользователь: ${username}`;
    
    initMap();
    loadMarkers();
}

// Обработка формы входа
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMainInterface(data.username);
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

// Загрузка меток с сервера
async function loadMarkers() {
    try {
        const response = await fetch('/api/markers');
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки меток');
        }
        
        markers = await response.json();
        displayMarkers();
    } catch (error) {
        console.error('Ошибка загрузки меток:', error);
        alert('Ошибка загрузки меток');
    }
}

// Отображение меток на карте и в списке
function displayMarkers() {
    // Очистка существующих маркеров на карте
    Object.values(markerLayers).forEach(marker => map.removeLayer(marker));
    markerLayers = {};
    
    // Очистка списка
    const markersList = document.getElementById('markers-list');
    markersList.innerHTML = '';
    
    if (markers.length === 0) {
        markersList.innerHTML = '<p style="color: #999; text-align: center;">Нет меток</p>';
        return;
    }
    
    // Добавление меток
    markers.forEach(marker => {
        // Добавление на карту
        const mapMarker = L.marker([marker.latitude, marker.longitude])
            .addTo(map)
            .bindPopup(`
                <h3>${marker.name}</h3>
                <p>${marker.description || 'Без описания'}</p>
                <p><small>Координаты: ${marker.latitude.toFixed(4)}, ${marker.longitude.toFixed(4)}</small></p>
            `);
        
        markerLayers[marker.id] = mapMarker;
        
        // Добавление в список
        const markerItem = document.createElement('div');
        markerItem.className = 'marker-item';
        markerItem.innerHTML = `
            <h3>${marker.name}</h3>
            <p>${marker.description || 'Без описания'}</p>
            <p class="coords">Координаты: ${marker.latitude.toFixed(4)}, ${marker.longitude.toFixed(4)}</p>
            <button class="delete-btn" onclick="deleteMarker(${marker.id})">Удалить</button>
        `;
        
        markerItem.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-btn')) {
                map.setView([marker.latitude, marker.longitude], 12);
                mapMarker.openPopup();
            }
        });
        
        markersList.appendChild(markerItem);
    });
    
    // Центрирование карты на всех метках
    if (markers.length > 0) {
        const bounds = L.latLngBounds(markers.map(m => [m.latitude, m.longitude]));
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// Удаление метки
async function deleteMarker(id) {
    if (!confirm('Удалить эту метку?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/markers/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            await loadMarkers();
        } else {
            throw new Error('Ошибка удаления метки');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка удаления метки');
    }
}

// Модальное окно добавления метки
const modal = document.getElementById('add-marker-modal');
const addMarkerBtn = document.getElementById('add-marker-btn');
const closeBtn = document.querySelector('.close');
const cancelBtn = document.querySelector('.cancel-btn');

addMarkerBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    // Установка текущего центра карты
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

// Обработка формы добавления метки
document.getElementById('add-marker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('marker-name').value;
    const description = document.getElementById('marker-description').value;
    const latitude = parseFloat(document.getElementById('marker-lat').value);
    const longitude = parseFloat(document.getElementById('marker-lng').value);
    
    try {
        const response = await fetch('/api/markers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, description, latitude, longitude })
        });
        
        if (response.ok) {
            modal.classList.add('hidden');
            document.getElementById('add-marker-form').reset();
            await loadMarkers();
        } else {
            const data = await response.json();
            alert(data.error || 'Ошибка добавления метки');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка добавления метки');
    }
});
