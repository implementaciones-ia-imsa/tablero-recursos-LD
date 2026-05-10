# Configuración de PM2 - Tablero IMSA

## Descripción
Este documento detalla cómo desplegar y mantener el tablero IMSA usando PM2 (Process Manager 2).

---

## Instalación Inicial

### 1. Instalar PM2 globalmente (si no lo tienes)
```bash
npm install -g pm2
```

### 2. Instalar dependencias del proyecto
```bash
cd "e:/Desarrollos IA/tablero-imsa"
npm install
```

### 3. Iniciar la aplicación con PM2
```bash
pm2 start ecosystem.config.js --env production
```

---

## Comandos Útiles

### Ver estado de la aplicación
```bash
pm2 status
pm2 show tablero-imsa
```

### Ver logs en tiempo real
```bash
pm2 logs tablero-imsa
```

### Ver solo errores
```bash
pm2 logs tablero-imsa --err
```

### Reiniciar la aplicación
```bash
pm2 restart tablero-imsa
```

### Detener la aplicación
```bash
pm2 stop tablero-imsa
```

### Eliminar del monitoreo de PM2
```bash
pm2 delete tablero-imsa
```

### Recargar sin downtime
```bash
pm2 reload tablero-imsa
```

---

## Configuración de Arranque Automático

### Windows (Ejecutar como Administrador)
```bash
pm2 startup windows -u %USERNAME% --hp %USERPROFILE%
pm2 save
```

### Linux
```bash
pm2 startup
pm2 save
```

---

## Monitoreo y Gestión

### Crear comando alias de PM2
```bash
pm2 completion install
```

### Monitorar en tiempo real
```bash
pm2 monit
```

### Ver métricas completas
```bash
pm2 web
# Accede a http://localhost:9615
```

---

## Archivos de Logs

Los logs se guardan en: `./logs/`

- **err.log** - Errores de la aplicación
- **out.log** - Salida estándar
- **combined.log** - Logs combinados

Rotar logs:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval 0 0 * * *
```

---

## Configuración Personalizada (ecosystem.config.js)

### Parámetros actuales:
- **Puerto**: 5491
- **Instancias**: 1
- **Memoria máxima**: 300MB
- **Timeout**: 30s min_uptime
- **Reintentos**: 5 máximo

### Para modificar puerto:
Edita `ecosystem.config.js` en la sección `env.PORT` y luego:
```bash
pm2 restart ecosystem.config.js --env production
```

---

## Migración a Nuevo Repositorio

### Pasos para preparar para GitHub:

1. **Crear un archivo `.gitignore`** (si no existe):
```
node_modules/
logs/
.env
.env.local
```

2. **Crear el repositorio en GitHub**:
   - Ve a https://github.com/new
   - Crea un nuevo repositorio (ej: `tablero-imsa-public`)

3. **Inicializar Git localmente**:
```bash
cd "e:/Desarrollos IA/tablero-imsa"
git init
git add .
git commit -m "Initial commit: Tablero IMSA con recursos dinámicos"
```

4. **Conectar a GitHub**:
```bash
git remote add origin https://github.com/TU_USUARIO/tablero-imsa-public.git
git branch -M main
git push -u origin main
```

---

## Troubleshooting

### La aplicación no inicia
```bash
pm2 logs tablero-imsa --err
# Verifica los errores en los logs
```

### Puerto 5491 en uso
```bash
netstat -ano | findstr :5491  # Windows
# o cambiar puerto en ecosystem.config.js
```

### Problema de conexión a DB
```bash
pm2 show tablero-imsa
# Verifica las credenciales en server.js
```

---

## Recursos Adicionales

- [Documentación PM2](https://pm2.keymetrics.io/)
- [Guía de PM2 en producción](https://pm2.keymetrics.io/docs/usage/quick-start/)

---

**Última actualización**: 2026-05-08  
**Versión**: 1.0
