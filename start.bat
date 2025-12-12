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

echo Запуск сервера на http://localhost:3000
echo Нажмите Ctrl+C для остановки
echo.
node server.js

pause
