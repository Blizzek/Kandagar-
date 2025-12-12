@echo off
chcp 65001 >nul
echo ========================================
echo Запуск сервера Kandagar
echo ========================================
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Node.js не найден!
    echo Запустите setup.bat для настройки
    pause
    exit /b 1
)

REM Проверка node_modules
if not exist "node_modules\" (
    echo [ПРЕДУПРЕЖДЕНИЕ] Зависимости не установлены
    echo Запускаю установку...
    call npm install
    echo.
)

echo.
echo Выбор базы данных
set "DEFAULT_DB=%~dp0kandagar.db"
set /p DB_CHOICE=Укажите путь к файлу БД (Enter = %DEFAULT_DB%): 
if "%DB_CHOICE%"=="" (set "DB_PATH=%DEFAULT_DB%") else (set "DB_PATH=%DB_CHOICE%")

echo.
set "DEFAULT_PORT=3000"
set /p PORT_CHOICE=Укажите порт (Enter = %DEFAULT_PORT%): 
if "%PORT_CHOICE%"=="" (set "PORT=%DEFAULT_PORT%") else (set "PORT=%PORT_CHOICE%")

set "DEFAULT_POST=1"
set /p POST_CHOICE=Укажите № поста (Enter = %DEFAULT_POST%): 
if "%POST_CHOICE%"=="" (set "POST_ID=%DEFAULT_POST%") else (set "POST_ID=%POST_CHOICE%")

set "DEFAULT_CLIENT=false"
set /p CLIENT_CHOICE=Режим клиента (true/false, Enter = %DEFAULT_CLIENT%): 
if "%CLIENT_CHOICE%"=="" (set "CLIENT_MODE=%DEFAULT_CLIENT%") else (set "CLIENT_MODE=%CLIENT_CHOICE%")

echo.
echo Запуск сервера на http://localhost:%PORT%
echo Используется БД: %DB_PATH%
echo Пост: %POST_ID%  Клиентский режим: %CLIENT_MODE%
echo Нажмите Ctrl+C для остановки
echo.
set "DB_PATH=%DB_PATH%"
set "PORT=%PORT%"
set "POST_ID=%POST_ID%"
set "CLIENT_MODE=%CLIENT_MODE%"
node server.js --db="%DB_PATH%"

pause
