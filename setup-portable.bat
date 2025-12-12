@echo off
chcp 65001 >nul
echo ========================================
echo Настройка портативной версии Kandagar
echo ========================================
echo.

REM Путь к портативному Node.js
set NODE_PATH=%~dp0node-portable
set NODE=%NODE_PATH%\node.exe
set NPM=%NODE_PATH%\npm.cmd

REM Проверка портативного Node.js
if not exist "%NODE%" (
    echo Портативный Node.js не найден. Скачивание...
    echo.
    
    powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-win-x64.zip' -OutFile 'node-portable.zip'}"
    
    if exist "node-portable.zip" (
        echo Распаковка Node.js...
        powershell -Command "& {Expand-Archive -Path 'node-portable.zip' -DestinationPath '.' -Force}"
        powershell -Command "& {Move-Item -Path 'node-v20.10.0-win-x64\*' -Destination 'node-portable\' -Force}"
        powershell -Command "& {Remove-Item 'node-v20.10.0-win-x64' -Recurse -Force}"
        del /Q node-portable.zip
        echo.
        echo [OK] Node.js установлен
    ) else (
        echo [ОШИБКА] Не удалось скачать Node.js
        pause
        exit /b 1
    )
)

echo [OK] Node.js обнаружен
"%NODE%" --version
"%NPM%" --version
echo.

REM Добавление портативного Node.js в PATH для npm
set PATH=%NODE_PATH%;%PATH%

echo Установка зависимостей...
call "%NPM%" install

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo [УСПЕХ] Портативная версия готова!
    echo Запустите start-portable.bat
    echo ========================================
) else (
    echo.
    echo [ПРЕДУПРЕЖДЕНИЕ] Возможны проблемы при установке
    echo Попробуйте запустить start-portable.bat
)

pause
