@echo off
chcp 65001 >nul
echo ========================================
echo Установка зависимостей Kandagar
echo ========================================
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Node.js не найден!
    echo Пожалуйста, установите Node.js с https://nodejs.org/
    echo После установки перезапустите этот файл.
    pause
    exit /b 1
)

echo [OK] Node.js обнаружен
node --version
npm --version
echo.

echo Установка зависимостей...
call npm install

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo [УСПЕХ] Зависимости установлены!
    echo Теперь можете запустить start.bat
    echo ========================================
) else (
    echo.
    echo [ОШИБКА] Не удалось установить зависимости
)

pause
