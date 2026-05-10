@echo off
REM Iniciar Tablero IMSA

cd /d "e:\Desarrollos IA\tablero-imsa"

REM Matar procesos anteriores en puerto 5491
echo Deteniendo procesos anteriores...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5491') do (
    taskkill /PID %%a /F 2>nul
)

timeout /t 2 /nobreak

REM Crear carpeta de logs si no existe
if not exist logs mkdir logs

REM Iniciar servidor
echo.
echo ===================================
echo Iniciando Tablero IMSA...
echo ===================================
echo Puerto: 5491
echo URL: http://localhost:5491
echo Logs: logs\out.log
echo ===================================
echo.

start "Tablero IMSA" node server.js

REM Esperar a que inicie
timeout /t 3 /nobreak

echo.
echo Servidor iniciado. Abre: http://localhost:5491
echo Presiona CTRL+C para detener.
echo.

pause
