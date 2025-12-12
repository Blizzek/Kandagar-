@echo off
chcp 65001 >nul
echo ========================================
echo Запуск Kandagar (портативная версия)
echo ========================================
echo.

REM Путь к портативному Node.js
set NODE_PATH=%~dp0node-portable
set PATH=%NODE_PATH%;%PATH%
set NODE=%NODE_PATH%\node.exe
set NPM=%NODE_PATH%\npm.cmd

REM Проверка портативного Node.js
if not exist "%NODE%" (
    echo [ОШИБКА] Портативный Node.js не найден!
    echo Запустите setup-portable.bat для установки
    pause
    exit /b 1
)

echo [OK] Портативный Node.js обнаружен
"%NODE%" --version
echo.

REM Проверка и установка зависимостей
if not exist "node_modules\" (
    echo Установка зависимостей...
    call "%NPM%" install
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

echo.
echo Запуск сервера на http://localhost:%PORT%
echo Используется БД: %DB_PATH%
echo Нажмите Ctrl+C для остановки
echo.

set "DB_PATH=%DB_PATH%"
set "PORT=%PORT%"
"%NODE%" server.js --db="%DB_PATH%"

pause
