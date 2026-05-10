#!/bin/bash
# Script para iniciar el servidor Tablero IMSA

cd "e:/Desarrollos IA/tablero-imsa"

# Crear carpeta de logs si no existe
mkdir -p logs

# Iniciar servidor en background
nohup node server.js > logs/out.log 2> logs/err.log &

# Guardar PID
echo $! > server.pid

echo "✅ Servidor iniciado (PID: $(cat server.pid))"
echo "📊 URL: http://localhost:5491"
echo "📋 Logs: logs/out.log"
