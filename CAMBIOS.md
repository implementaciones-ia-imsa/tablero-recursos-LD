# Cambios Realizados - Recursos Dinámicos y PM2

## 📋 Resumen de Cambios

### ✅ 1. Endpoint Dinámico de Recursos (server.js)

**Nuevo endpoint**: `GET /api/recursos-disponibles`

Consulta dinámicamente todos los recursos que tienen estadísticas disponibles en la base de datos:

```javascript
SELECT DISTINCT CAST(RTRIM(Recurso) AS INT) AS numero
FROM (
    SELECT Recurso FROM GCWin_V_PBI_RsVeloc
    UNION
    SELECT Recurso FROM GCWin_V_PBI_RsAprov
    UNION
    SELECT Recurso FROM GCWin_V_PBI_RsDesc
) t
ORDER BY numero
```

**Ventajas**:
- Actualiza automáticamente cuando se agregan nuevos recursos a las tablas de estadísticas
- No requiere cambios de código
- Usa caché (5 minutos)
- Retorna solo recursos reales con datos

---

### ✅ 2. Frontend Dinámico (index.html)

**Cambios realizados**:

#### Antes (Hardcodeado):
```javascript
const RECURSOS_CON_DETALLE = [
    102, 103, 109, 111, 120, 124, 129, 131,
    201, 202, 203, 209,
    301,
    401, 402, 404, 405, 406, 418, 419,
    602, 603, 605
];
```

#### Después (Dinámico):
```javascript
let RECURSOS_CON_DETALLE = [];

async function loadRecursosDisponibles() {
    try {
        const data = await fetchFromAPI('/api/recursos-disponibles');
        if (data.success && Array.isArray(data.data)) {
            RECURSOS_CON_DETALLE = data.data;
            console.log(`✅ Cargados ${RECURSOS_CON_DETALLE.length} recursos`);
        }
    } catch (error) {
        console.error('❌ Error cargando recursos disponibles:', error);
    }
}
```

**En la inicialización**:
```javascript
await loadRecursosDisponibles();  // ← Llamada antes de cargar recursos
```

---

### ✅ 3. Configuración de PM2

El archivo `ecosystem.config.js` ya está configurado:

**Parámetros actuales**:
- Puerto: `5491`
- Instancias: `1`
- Memoria máxima: `300MB`
- Logs: `./logs/`
- Restart automático: Habilitado
- Max restarts: `5`

---

## 🚀 Cómo Usar

### Iniciar con PM2

```bash
cd "e:/Desarrollos IA/tablero-imsa"
pm2 start ecosystem.config.js --env production
```

### Ver estado
```bash
pm2 status
pm2 logs tablero-imsa
```

### Reiniciar
```bash
pm2 restart tablero-imsa
```

---

## 📁 Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `server.js` | ✅ Agregado endpoint `/api/recursos-disponibles` |
| `index.html` | ✅ Modificado para cargar recursos dinámicamente |
| `PM2_SETUP.md` | ✅ Documentación completa de PM2 (NUEVO) |

---

## 🔄 Flujo de Carga

```
1. Frontend carga (DOMContentLoaded)
2. Consulta GET /api/recursos-disponibles
3. Backend hace DISTINCT en 3 tablas de estadísticas
4. Retorna array de IDs de recursos
5. Frontend carga este array en RECURSOS_CON_DETALLE
6. Al hacer click, verifica si recurso está en el array
7. Si está disponible → Abre detalle (recurso.html)
8. Si no tiene estadísticas → No clickeable
```

---

## 📊 Ejemplo de Respuesta

```json
{
    "success": true,
    "data": [102, 103, 109, 111, 120, 124, 129, 131, 201, 202, 203, 209, 301, 401, 402, 404, 405, 406, 418, 419, 602, 603, 605],
    "total": 23,
    "timestamp": "2026-05-08T15:30:45.123Z"
}
```

---

## ✨ Beneficios

✅ **Mantenibilidad**: No requiere cambios de código para nuevos recursos  
✅ **Automatización**: Se actualiza automáticamente con los datos de BD  
✅ **Performance**: Usa caché de 5 minutos  
✅ **Escalabilidad**: Funciona con N recursos  
✅ **Consistencia**: Solo recursos con estadísticas son clickeables  

---

## 🔧 Próximos Pasos para GitHub

1. Crear `.gitignore`
2. Hacer commit inicial
3. Crear repo en GitHub
4. Push a `origin/main`

Ver: `PM2_SETUP.md` → Sección "Migración a Nuevo Repositorio"

---

**Versión**: 1.0  
**Fecha**: 2026-05-08
