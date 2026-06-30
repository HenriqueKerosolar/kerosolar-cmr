@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   KeroSolar CRM - Instalador
echo ==========================================
echo.

:: Verifica se npm está instalado
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ NPM não está instalado!
    echo Instale Node.js em: https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ NPM encontrado

:: Verifica se node_modules existe
if not exist "node_modules" (
    echo.
    echo 📦 Instalando dependências (npm install)...
    echo.
    call npm install
    if errorlevel 1 (
        echo ❌ Erro ao instalar dependências!
        pause
        exit /b 1
    )
) else (
    echo ✅ Dependências já instaladas
)

:: Cria .env.local se não existir
if not exist ".env.local" (
    echo.
    echo 🔧 Criando arquivo .env.local...
    (
        echo DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kerosolar_crm
        echo WHATSAPP_CLOUD_TOKEN=temp_token
        echo WHATSAPP_VERIFY_TOKEN=temp_token
        echo NEXT_PUBLIC_APP_URL=http://localhost:3000
    ) > .env.local
    echo ✅ Arquivo .env.local criado
)

:: Inicia o servidor
echo.
echo 🚀 Iniciando KeroSolar CRM...
echo.
echo O navegador abrirá automaticamente em http://localhost:3000
echo.
timeout /t 2

start http://localhost:3000
call npm run dev

pause
