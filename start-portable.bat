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

echo Запуск сервера на http://localhost:3000
echo Нажмите Ctrl+C для остановки
echo.

"%NODE%" server.js

pause
