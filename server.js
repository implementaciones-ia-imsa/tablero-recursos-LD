const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5491;

// ===== CACHÉ EN MEMORIA =====
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutos
const CACHE_MAX_ENTRIES = 500; // Límite para evitar memory leak

function getCached(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    cache.delete(key);
    return null;
}

// Recurso en las vistas GCWin es CHAR(10) con padding de espacios a la izquierda
const padRecurso = n => String(n).padStart(10, ' ');

function setCache(key, data) {
    // Evitar crecimiento indefinido del Map
    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
    cache.set(key, { data, ts: Date.now() });
}

// Flag para evitar ejecuciones superpuestas del precache
let precacheRunning = false;



// ===== CONFIGURACIÓN DE LA BASE DE DATOS =====
const tableroConfig = {
    server: '192.168.100.162',
    database: 'CWSGImsa',
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        requestTimeout: 60000,      // 60 segundos
        connectionTimeout: 30000,   // 30 segundos
    },
    authentication: {
        type: 'ntlm',
        options: {
            domain: 'IMSA',
            //userName: 'A_TCasco',
            //password: 'Tiranytar.2023!'
            userName: 'SVC_dashboard_ia',
            password: '2!R4+F7=4hx??9^B3k'

        }
    },
    pool: {
        max: 15,
        min: 2,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 15000
    }
};

// ===== MIDDLEWARE =====
app.use(helmet({
    contentSecurityPolicy: false, // Deshabilitamos CSP para permitir inline scripts
    // Permitir que la ventana popup de Google Sign-In (accounts.google.com)
    // pueda comunicar el credential de vuelta vía window.opener.postMessage.
    // El default de helmet ('same-origin') rompe window.opener y deja el popup
    // colgado en accounts.google.com/gsi/transform.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));
app.use(compression());
app.use(morgan('short'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// ===== CONEXIÓN A LA BASE DE DATOS =====
let connectionPool = null;

async function connectTableroDB() {
    try {
        if (connectionPool && !connectionPool.connected) {
            console.log('⚠ Pool desconectado, reconectando...');
            try { await connectionPool.close(); } catch (_) { /* ignorar */ }
            connectionPool = null;
        }
        if (!connectionPool) {
            console.log('🔄 Conectando a la base de datos GCWin...');
            connectionPool = await sql.connect(tableroConfig);
            console.log('✅ Conexión establecida con GCWin');
        }
        return connectionPool;
    } catch (error) {
        console.error('❌ Error conectando a GCWin:', error);
        connectionPool = null;
        throw error;
    }
}

// ===== FUNCIÓN PARA DETERMINAR ESTADO DEL RECURSO =====
function determinarEstadoRecurso(recurso) {
    const operarios = recurso.Operarios;
    const estado = recurso.Estado ? recurso.Estado.toString().trim() : '';
    const motivoInterrup = recurso.MotivoInterrup ? recurso.MotivoInterrup.toString().trim() : '';

    // Prioridad 1: Sin operario
    if (!operarios || operarios === 0)  {
        return { estado: 'status-sin-operario', estadoTexto: 'Falta de Personal' };
    }

    const estadoLower = estado.toLowerCase();

    // Prioridad 2: Estados de producción
    if (estadoLower === 'enproceso' || estadoLower === 'en proceso') {
        return { estado: 'status-produciendo', estadoTexto: 'Produciendo' };
    }

    // Prioridad 2.5: Máquina iniciada pero no en proceso
    if (estadoLower === 'iniciada') {
        return { estado: 'status-iniciada', estadoTexto: 'Máquina Lista' };
    }

    // Prioridad 3: Estado en pausa, analizar motivo
    if (estadoLower === 'enpausa' || estadoLower === 'en pausa') {
        const motivo = motivoInterrup.toLowerCase();

        if (motivo.includes('mant. eléctrico') || motivo.includes('mant. mecánico') || motivo.includes('limpieza de hornos')) {
            return { estado: 'status-mantenimiento', estadoTexto: 'Mantenimiento' };
        }
        if (motivo.includes('falta de materia prima') || motivo.includes('falta de trabajo') || motivo.includes('falta materiales') || motivo.includes('retiro de material')) {
            return { estado: 'status-falta-materiales', estadoTexto: 'Falta Materiales' };
        }
        if (motivo.includes('falta de personal')) {
            return { estado: 'status-falta-personal', estadoTexto: 'Falta de Personal' };
        }
        if (motivo.includes('cambio de medida') || motivo.includes('cambio de carrete') || motivo.includes('cambio de color') || motivo.includes('falta autocontrol')) {
            return { estado: 'status-set-up', estadoTexto: 'Set Up' };
        }

        return { estado: 'status-detenido', estadoTexto: 'Detenido' };
    }

    // Estado por defecto
    return { estado: 'status-detenido', estadoTexto: 'Detenido' };
}

// ===== HELPERS DE FECHA (zona horaria) =====

// Formatea un Date de Node.js como string LOCAL para enviar a SQL Server.
// mssql convierte sql.DateTime a UTC internamente, lo que rompe las comparaciones
// cuando SQL Server almacena tiempos locales. Usando VARCHAR evitamos esa conversión.
function toSqlStr(date) {
    const d = new Date(date);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Recupera el valor crudo que SQL Server almacenó.
// mssql devuelve datetime como Date en UTC (sin aplicar offset local),
// por lo que getUTC*() da el valor real que estaba en la base de datos.
function fromSqlDate(date) {
    if (!date) return null;
    const d = new Date(date);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ===== FUNCIÓN PARA GUARDAR LOGS =====
function saveLog(tipo, datos) {
    const timestamp = new Date().toISOString();
    console.log(`📋 [${timestamp}] ${tipo}:`, datos);
    // Aquí podrías implementar guardar en archivo o base de datos si es necesario
}

// ===== ENDPOINTS PARA TABLERO DE RECURSOS =====

// Endpoint para test de conexión
app.get('/api/test-connection', async (req, res) => {
    try {
        const connection = await connectTableroDB();
        const request = new sql.Request(connection);
        const result = await request.query('SELECT @@VERSION as version, GETDATE() as fecha');
        res.json({
            success: true,
            message: 'Conexión exitosa a GCWin',
            data: result.recordset[0],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error en test de conexión:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint de diagnóstico: mide tiempo de cada query por separado
app.get('/api/diagnostico/:recurso', async (req, res) => {
    const recursoNum = parseInt(req.params.recurso, 10);
    if (isNaN(recursoNum)) return res.status(400).json({ success: false, error: 'Recurso inválido' });

    const connection = await connectTableroDB();
    const pad = n => String(n).padStart(2, '0');
    const ahora = new Date();
    const ayer = new Date(ahora); ayer.setDate(ahora.getDate() - 1);
    const inicioHist = new Date(ayer); inicioHist.setHours(6, 0, 0, 0);
    const finHist = new Date(ahora); finHist.setHours(6, 0, 0, 0);
    const ayerStr = `${ayer.getFullYear()}${pad(ayer.getMonth()+1)}${pad(ayer.getDate())}`;
    const hoyStr = `${ahora.getFullYear()}${pad(ahora.getMonth()+1)}${pad(ahora.getDate())}`;
    const mes = ahora.getMonth() + 1;
    const anio = ahora.getFullYear();
    const recursoStr = padRecurso(recursoNum);
    const queries = [
        { nombre: 'Velocidad Histórico', query: `SET NOCOUNT ON; SELECT TOP 100 Op, Inicio, Fin, VelTeo, VelRea, Unidad FROM GCWin_V_PBI_RsVeloc WITH (NOLOCK) WHERE Recurso='${recursoStr}' AND Inicio<'${toSqlStr(finHist)}' AND (Fin>'${toSqlStr(inicioHist)}' OR Fin IS NULL) ORDER BY Inicio` },
        { nombre: 'Aprovechamiento Histórico', query: `SET NOCOUNT ON; SELECT TOP 10 TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso='${recursoStr}' AND Fecha='${ayerStr}'` },
        { nombre: 'Velocidad Instantáneo', query: `SET NOCOUNT ON; SELECT TOP 100 Op, Inicio, Fin, VelTeo, VelRea, Unidad FROM GCWin_V_PBI_RsVeloc WITH (NOLOCK) WHERE Recurso='${recursoStr}' AND Inicio<'${toSqlStr(ahora)}' AND (Fin>'${toSqlStr(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 6))}' OR Fin IS NULL) ORDER BY Inicio` },
        { nombre: 'Aprovechamiento Instantáneo', query: `SET NOCOUNT ON; SELECT TOP 10 TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso='${recursoStr}' AND Fecha='${hoyStr}'` },
        { nombre: 'Descarte', query: `SET NOCOUNT ON; SELECT SUM(Teorico) AS TotalTeorico, SUM(Informado) AS TotalInformado, MIN(Unidad) AS Unidad FROM GCWin_V_PBI_RsDesc WITH (NOLOCK) WHERE Recurso='${recursoStr}' AND Fecha>='${anio}${pad(mes)}01'` }
    ];

    const resultados = [];
    for (const q of queries) {
        const t0 = Date.now();
        try {
            const r = new sql.Request(connection);
            r.timeout = 60000;
            const result = await r.query(q.query);
            resultados.push({ nombre: q.nombre, ms: Date.now() - t0, filas: result.recordset.length, ok: true });
        } catch (err) {
            resultados.push({ nombre: q.nombre, ms: Date.now() - t0, error: err.message, ok: false });
        }
        console.log(`   [DIAG] ${q.nombre}: ${resultados[resultados.length-1].ms}ms`);
    }

    // Semanal: deshabilitado por consumo excesivo de recursos
    // const t0Sem = Date.now();
    // try {
    //     const rows = await fetchAprovMensual(connection, recursoNum, anio, mes, lastDay);
    //     resultados.push({ nombre: 'Semanal (paralelo x día)', ms: Date.now() - t0Sem, filas: rows.length, ok: true });
    // } catch (err) {
    //     resultados.push({ nombre: 'Semanal (paralelo x día)', ms: Date.now() - t0Sem, error: err.message, ok: false });
    // }
    // console.log(`   [DIAG] Semanal: ${resultados[resultados.length-1].ms}ms`);

    const totalMs = resultados.reduce((s, r) => s + r.ms, 0);
    console.log(`📊 Diagnóstico recurso ${recursoNum}: total ${totalMs}ms`);
    res.json({ success: true, recurso: recursoNum, totalMs, resultados });
});

// Endpoint para obtener recursos con estadísticas disponibles (dinámico)
app.get('/api/recursos-disponibles', async (req, res) => {
    try {
        const cached = getCached('recursos_disponibles');
        if (cached) return res.json(cached);

        const connection = await connectTableroDB();
        const request = new sql.Request(connection);
        request.timeout = 60000;

        const result = await request.query(`
            SELECT DISTINCT CAST(RTRIM(Recurso) AS INT) AS numero
            FROM GCWin_V_PBI_RsVeloc
            WHERE CAST(RTRIM(Recurso) AS INT) < 1000
            ORDER BY numero
        `);

        const recursosDisponibles = result.recordset.map(row => row.numero);

        const response = {
            success: true,
            data: recursosDisponibles,
            total: recursosDisponibles.length,
            timestamp: new Date().toISOString()
        };

        setCache('recursos_disponibles', response);
        res.json(response);

    } catch (error) {
        console.error('❌ Error obteniendo recursos disponibles:', error);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo recursos disponibles',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener recursos
app.get('/api/recursos', async (req, res) => {
    try {
        const cached = getCached('recursos_all');
        if (cached) return res.json(cached);

        const connection = await connectTableroDB();
        const request = new sql.Request(connection);
        request.timeout = 60000;

        const result = await request.query(`
            SELECT
                Recurso,
                Multiplicidad,
                Estado,
                MotivoInterrup,
                Operarios,
                OpEnCurso,
                OpPendientes,
                Producto,
                KgAcumDelDia,
                MinsInterrupDelDia,
                MinsEstadoActual
            FROM GCWin_V_EstadoRecursosCables
            ORDER BY Recurso, TRY_CAST(Multiplicidad AS INT)
        `);

        // Procesar los datos
        const recursos = result.recordset.map(row => {
            // Crear objeto recurso para la función de estado
            const recursoData = {
                Operarios: row.Operarios,
                Estado: row.Estado,
                MotivoInterrup: row.MotivoInterrup
            };
            
            const estadoInfo = determinarEstadoRecurso(recursoData);
            
            return {
                numero: row.Recurso,
                // Posición dentro de una máquina múltiple (vacío si el recurso es simple)
                multiplicidad: (row.Multiplicidad || '').toString().trim(),
                estado: estadoInfo.estado,
                estadoTexto: estadoInfo.estadoTexto,
                motivoInterrupcion: row.MotivoInterrup || '',
                operarios: row.Operarios || 0,
                opEnCurso: row.OpEnCurso || 'Sin OP',
                opPendientes: row.OpPendientes || 0,
                producto: row.Producto || 'Sin producto',
                kgAcumulados: parseFloat(row.KgAcumDelDia) || 0,
                minutosInterrupcion: parseInt(row.MinsInterrupDelDia) || 0,
                minutosEstadoActual: parseInt(row.MinsEstadoActual) || 0
            };
        });

        // Guardar log
        saveLog('recursos_consulta', {
            filas: recursos.length,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });

        const response = {
            success: true,
            data: recursos,
            total: recursos.length,
            timestamp: new Date().toISOString()
        };
        setCache('recursos_all', response);
        res.json(response);

    } catch (error) {
        console.error('❌ Error obteniendo recursos:', error);
        
        saveLog('recursos_error', {
            error: error.message,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            success: false,
            error: 'Error obteniendo recursos',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener objetivos
app.get('/api/objetivos', (req, res) => {
    try {
        // Objetivos configurables por sección
        const objetivos = {
            1: 1200,  // Sección 1
            2: 1200,  // Sección 2
            3: 800    // Sección 3
        };

        res.json({
            success: true,
            data: objetivos,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error obteniendo objetivos:', error);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo objetivos',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para actualizar objetivos
app.post('/api/objetivos', (req, res) => {
    try {
        const { seccion, objetivo } = req.body;

        if (!seccion || !objetivo) {
            return res.status(400).json({
                success: false,
                error: 'Sección y objetivo son requeridos'
            });
        }


        // Aquí podrías guardar en base de datos o archivo
        // Por ahora solo respondemos exitosamente
        
        saveLog('objetivo_actualizado', {
            seccion,
            objetivo,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Objetivo de sección ${seccion} actualizado a ${objetivo}`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error actualizando objetivo:', error);
        res.status(500).json({
            success: false,
            error: 'Error actualizando objetivo',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ===== HELPERS para procesar resultados de velocidad y aprovechamiento =====
function mapVelocidad(recordset) {
    return recordset.map(row => ({
        inicio:  fromSqlDate(row.Inicio),
        fin:     fromSqlDate(row.Fin),
        velTeo:  parseFloat(row.VelTeo) || 0,
        velRea:  parseFloat(row.VelRea) || 0,
        op:      row.Op,
        unidad:  (row.Unidad || '').trim()
    }));
}

function mapRadial(recordset, hasVelocidad) {
    if (recordset.length > 0) {
        const r = recordset[0];
        return {
            tiempoDeUso:      parseFloat(r.TiempoDeUso) || 0,
            tiempoDisponible: parseFloat(r.TiempoDisponible) || 0,
            aprovechamiento:  parseFloat(r.Aprovechamiento) || 0,
            unidad:           (r.Unidad || 'min').trim()
        };
    }
    return hasVelocidad ? { tiempoDeUso: 0, tiempoDisponible: 0, aprovechamiento: 0, unidad: 'min' } : null;
}

// ===== SECCIÓN SEMANAL/MENSUAL =====
function diaDelMes(fechaRaw) {
    if (fechaRaw instanceof Date) {
        const d = fechaRaw.getUTCDate();
        return Number.isFinite(d) ? d : null;
    }
    const s = String(fechaRaw ?? '').trim();
    if (/^\d{8}$/.test(s)) return parseInt(s.slice(6, 8), 10) || null;
    const d = new Date(fechaRaw);
    const day = d.getUTCDate();
    return Number.isFinite(day) ? day : null;
}

async function fetchAprovMensual(connection, recursoNum, anio, mes, lastDay) {
    const pad = n => String(n).padStart(2, '0');
    const hoy = new Date();
    const ultimoDia = (anio === hoy.getFullYear() && mes === hoy.getMonth() + 1)
        ? Math.min(hoy.getDate(), lastDay)
        : lastDay;
    if (ultimoDia === 0) return [];
    const fechaInicio = `${anio}${pad(mes)}01`;
    const fechaFin = `${anio}${pad(mes)}${pad(ultimoDia)}`;
    const req = new sql.Request(connection);
    req.timeout = 60000;
    req.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
    req.input('fechaInicio', sql.VarChar, fechaInicio);
    req.input('fechaFin', sql.VarChar, fechaFin);
    const result = await req.query(
        `SET NOCOUNT ON; SELECT Fecha, TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha>=@fechaInicio AND Fecha<=@fechaFin`
    );
    return result.recordset;
}
// ===== FIN SECCIÓN SEMANAL =====

// ===== ENDPOINT UNIFICADO: todas las queries en paralelo, con caché =====
app.get('/api/recurso/:recurso/all', async (req, res) => {
    try {
        const recursoNum = parseInt(req.params.recurso, 10);
        if (isNaN(recursoNum)) return res.status(400).json({ success: false, error: 'Recurso debe ser un número' });

        // Revisar caché
        const cacheKey = `recurso_all_${recursoNum}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const connection = await connectTableroDB();
        const pad = n => String(n).padStart(2, '0');
        const ahora = new Date();

        // Fechas para histórico (ayer 06:00 → hoy 06:00)
        const ayer = new Date(ahora);
        ayer.setDate(ahora.getDate() - 1);
        const inicioHist = new Date(ayer); inicioHist.setHours(6, 0, 0, 0);
        const finHist = new Date(ahora); finHist.setHours(6, 0, 0, 0);
        const ayerStr = `${ayer.getFullYear()}${pad(ayer.getMonth()+1)}${pad(ayer.getDate())}`;

        // Fechas para instantáneo (hoy 06:00 → ahora)
        const inicioInst = new Date(ahora); inicioInst.setHours(6, 0, 0, 0);
        const hoyStr = `${ahora.getFullYear()}${pad(ahora.getMonth()+1)}${pad(ahora.getDate())}`;

        // Fechas para descarte (mes actual)
        const mes = ahora.getMonth() + 1;
        const anio = ahora.getFullYear();
        const inicioMesStr = `${anio}${pad(mes)}01`;

        // ── Lanzar las 6 queries en paralelo ──
        const qTimeout = 60000;

        const rVelHist = new sql.Request(connection);
        rVelHist.timeout = qTimeout;
        rVelHist.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rVelHist.input('inicio', sql.VarChar, toSqlStr(inicioHist));
        rVelHist.input('fin', sql.VarChar, toSqlStr(finHist));

        const rAprovHist = new sql.Request(connection);
        rAprovHist.timeout = qTimeout;
        rAprovHist.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rAprovHist.input('fecha', sql.VarChar, ayerStr);

        const rVelInst = new sql.Request(connection);
        rVelInst.timeout = qTimeout;
        rVelInst.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rVelInst.input('inicio', sql.VarChar, toSqlStr(inicioInst));
        rVelInst.input('fin', sql.VarChar, toSqlStr(ahora));

        const rAprovInst = new sql.Request(connection);
        rAprovInst.timeout = qTimeout;
        rAprovInst.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rAprovInst.input('fecha', sql.VarChar, hoyStr);

        const rDescarte = new sql.Request(connection);
        rDescarte.timeout = qTimeout;
        rDescarte.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rDescarte.input('inicio', sql.VarChar, inicioMesStr);

        const [velHistR, aprovHistR, velInstR, aprovInstR, descarteR] = await Promise.all([
            rVelHist.query(`SET NOCOUNT ON; SELECT Op, Inicio, Fin, VelTeo, VelRea, Unidad FROM GCWin_V_PBI_RsVeloc WITH (NOLOCK) WHERE Recurso=@recurso AND Inicio<@fin AND (Fin>@inicio OR Fin IS NULL) ORDER BY Inicio`),
            rAprovHist.query(`SET NOCOUNT ON; SELECT TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha=@fecha`),
            rVelInst.query(`SET NOCOUNT ON; SELECT Op, Inicio, Fin, VelTeo, VelRea, Unidad FROM GCWin_V_PBI_RsVeloc WITH (NOLOCK) WHERE Recurso=@recurso AND Inicio<@fin AND (Fin>@inicio OR Fin IS NULL) ORDER BY Inicio`),
            rAprovInst.query(`SET NOCOUNT ON; SELECT TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha=@fecha`),
            rDescarte.query(`SET NOCOUNT ON; SELECT SUM(Teorico) AS TotalTeorico, SUM(Informado) AS TotalInformado, MIN(Unidad) AS Unidad FROM GCWin_V_PBI_RsDesc WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha>=@inicio`)
        ]);

        // Procesar histórico
        const histVel = mapVelocidad(velHistR.recordset);
        const histRadial = mapRadial(aprovHistR.recordset, histVel.length > 0);

        // Procesar instantáneo
        const instVel = mapVelocidad(velInstR.recordset);
        const instRadial = mapRadial(aprovInstR.recordset, instVel.length > 0);

        // Procesar descarte
        const dRow = descarteR.recordset[0];
        const descarte = {
            unidad: (dRow && dRow.Unidad || '').trim(),
            totalTeorico: parseFloat(dRow && dRow.TotalTeorico) || 0,
            totalInformado: parseFloat(dRow && dRow.TotalInformado) || 0
        };

        const response = {
            success: true,
            data: {
                recurso: recursoNum,
                historico: {
                    velocidad: histVel,
                    radial: histRadial,
                    periodoLaboral: {
                        inicio: toSqlStr(inicioHist).replace(' ', 'T'),
                        fin: toSqlStr(finHist).replace(' ', 'T')
                    }
                },
                instantaneo: {
                    velocidad: instVel,
                    radial: instRadial,
                    periodoLaboral: {
                        inicio: toSqlStr(inicioInst).replace(' ', 'T'),
                        fin: toSqlStr(ahora).replace(' ', 'T')
                    }
                },
                // semanal: deshabilitado por consumo excesivo de recursos
                descarte: { recurso: recursoNum, mes, anio, descarte }
            },
            timestamp: new Date().toISOString()
        };

        setCache(cacheKey, response);
        res.json(response);

    } catch (error) {
        console.error(`❌ Error recurso ${req.params.recurso}/all:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo datos del recurso', details: error.message });
    }
});

// ===== ENDPOINTS INDIVIDUALES (retrocompatibilidad, optimizados) =====

app.get('/api/recurso/:recurso', async (req, res) => {
    try {
        const recursoNum = parseInt(req.params.recurso, 10);
        if (isNaN(recursoNum)) return res.status(400).json({ success: false, error: 'Recurso debe ser un número' });

        const cacheKey = `recurso_hist_${recursoNum}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const connection = await connectTableroDB();
        const ahora = new Date();
        const ayer = new Date(ahora); ayer.setDate(ahora.getDate() - 1);
        const inicioLaboral = new Date(ayer); inicioLaboral.setHours(6, 0, 0, 0);
        const finLaboral = new Date(ahora); finLaboral.setHours(6, 0, 0, 0);
        const pad = n => String(n).padStart(2, '0');
        const ayerStr = `${ayer.getFullYear()}${pad(ayer.getMonth()+1)}${pad(ayer.getDate())}`;

        const rVel = new sql.Request(connection); rVel.timeout = 60000;
        rVel.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rVel.input('inicio', sql.VarChar, toSqlStr(inicioLaboral));
        rVel.input('fin', sql.VarChar, toSqlStr(finLaboral));

        const rAprov = new sql.Request(connection); rAprov.timeout = 60000;
        rAprov.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rAprov.input('fecha', sql.VarChar, ayerStr);

        // Ambas queries en paralelo
        const [velR, aprovR] = await Promise.all([
            rVel.query(`SET NOCOUNT ON; SELECT Op, Inicio, Fin, VelTeo, VelRea, Unidad FROM GCWin_V_PBI_RsVeloc WITH (NOLOCK) WHERE Recurso=@recurso AND Inicio<@fin AND (Fin>@inicio OR Fin IS NULL) ORDER BY Inicio`),
            rAprov.query(`SET NOCOUNT ON; SELECT TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha=@fecha`)
        ]);

        const velocidadData = mapVelocidad(velR.recordset);
        const response = {
            success: true,
            data: {
                recurso: recursoNum,
                velocidad: velocidadData,
                radial: mapRadial(aprovR.recordset, velocidadData.length > 0),
                periodoLaboral: { inicio: toSqlStr(inicioLaboral).replace(' ', 'T'), fin: toSqlStr(finLaboral).replace(' ', 'T') }
            },
            timestamp: new Date().toISOString()
        };
        setCache(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error(`❌ Error recurso ${req.params.recurso}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo datos del recurso', details: error.message });
    }
});

app.get('/api/recurso/:recurso/instantaneo', async (req, res) => {
    try {
        const recursoNum = parseInt(req.params.recurso, 10);
        if (isNaN(recursoNum)) return res.status(400).json({ success: false, error: 'Recurso debe ser un número' });

        const cacheKey = `recurso_inst_${recursoNum}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const connection = await connectTableroDB();
        const ahora = new Date();
        const inicioLaboral = new Date(ahora); inicioLaboral.setHours(6, 0, 0, 0);
        const pad = n => String(n).padStart(2, '0');
        const hoyStr = `${ahora.getFullYear()}${pad(ahora.getMonth()+1)}${pad(ahora.getDate())}`;

        const rVel = new sql.Request(connection); rVel.timeout = 60000;
        rVel.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rVel.input('inicio', sql.VarChar, toSqlStr(inicioLaboral));
        rVel.input('fin', sql.VarChar, toSqlStr(ahora));

        const rAprov = new sql.Request(connection); rAprov.timeout = 60000;
        rAprov.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rAprov.input('fecha', sql.VarChar, hoyStr);

        const [velR, aprovR] = await Promise.all([
            rVel.query(`SET NOCOUNT ON; SELECT Op, Inicio, Fin, VelTeo, VelRea, Unidad FROM GCWin_V_PBI_RsVeloc WITH (NOLOCK) WHERE Recurso=@recurso AND Inicio<@fin AND (Fin>@inicio OR Fin IS NULL) ORDER BY Inicio`),
            rAprov.query(`SET NOCOUNT ON; SELECT TiempoDeUso, TiempoDisponible, Unidad, Aprovechamiento FROM GCWin_V_PBI_RsAprov WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha=@fecha`)
        ]);

        const velocidadData = mapVelocidad(velR.recordset);
        const response = {
            success: true,
            data: {
                recurso: recursoNum,
                velocidad: velocidadData,
                radial: mapRadial(aprovR.recordset, velocidadData.length > 0),
                periodoLaboral: { inicio: toSqlStr(inicioLaboral).replace(' ', 'T'), fin: toSqlStr(ahora).replace(' ', 'T') }
            },
            timestamp: new Date().toISOString()
        };
        setCache(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error(`❌ Error instantáneo recurso ${req.params.recurso}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo datos', details: error.message });
    }
});

// ===== ENDPOINT SEMANAL =====
app.get('/api/recurso/:recurso/semanal', async (req, res) => {
    try {
        const recursoNum = parseInt(req.params.recurso, 10);
        if (isNaN(recursoNum)) return res.status(400).json({ success: false, error: 'Recurso inválido' });
        const cacheKey = `recurso_sem_${recursoNum}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);
        const connection = await connectTableroDB();
        const ahora = new Date();
        const mes = ahora.getMonth() + 1;
        const anio = ahora.getFullYear();
        const pad = n => String(n).padStart(2, '0');
        const lastDay = new Date(anio, ahora.getMonth() + 1, 0).getDate();
        const t0Sem = Date.now();
        const semanalRows = await fetchAprovMensual(connection, recursoNum, anio, mes, lastDay);
        console.log(`[SEMANAL] Recurso ${recursoNum}: ${semanalRows.length} filas en ${Date.now() - t0Sem}ms`);
        const rangos = [
            { semana: 1, dIni: 1, dFin: 7 }, { semana: 2, dIni: 8, dFin: 14 },
            { semana: 3, dIni: 15, dFin: 21 }, { semana: 4, dIni: 22, dFin: lastDay }
        ];
        const semanas = rangos.map(r => {
            const dias = semanalRows
                .filter(row => { const d = diaDelMes(row.Fecha); return d != null && d >= r.dIni && d <= r.dFin; })
                .map(row => ({
                    fecha: fromSqlDate(row.Fecha).split('T')[0],
                    tiempoDeUso: parseFloat(row.TiempoDeUso) || 0,
                    tiempoDisponible: parseFloat(row.TiempoDisponible) || 0,
                    aprovechamiento: parseFloat(row.Aprovechamiento) || 0,
                    unidad: (row.Unidad || 'min').trim()
                }))
                .sort((a, b) => a.fecha.localeCompare(b.fecha));
            const promedio = dias.length > 0
                ? parseFloat((dias.reduce((s, d) => s + d.aprovechamiento, 0) / dias.length).toFixed(2)) : 0;
            return { semana: r.semana, dIni: r.dIni, dFin: r.dFin, promedio, cantDias: dias.length, dias };
        });
        const response = { success: true, data: { recurso: recursoNum, mes, anio, semanas } };
        setCache(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error(`❌ Error semanal recurso ${req.params.recurso}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo datos semanales', details: error.message });
    }
});
// ===== FIN ENDPOINT SEMANAL =====

app.get('/api/recurso/:recurso/descarte', async (req, res) => {
    try {
        const recursoNum = parseInt(req.params.recurso, 10);
        if (isNaN(recursoNum)) return res.status(400).json({ success: false, error: 'Recurso inválido' });

        const cacheKey = `recurso_desc_${recursoNum}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const connection = await connectTableroDB();
        const ahora = new Date();
        const mes = ahora.getMonth() + 1;
        const anio = ahora.getFullYear();
        const pad = n => String(n).padStart(2, '0');

        const rDesc = new sql.Request(connection); rDesc.timeout = 60000;
        rDesc.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        rDesc.input('inicio', sql.VarChar, `${anio}${pad(mes)}01`);

        const result = await rDesc.query(`SET NOCOUNT ON; SELECT SUM(Teorico) AS TotalTeorico, SUM(Informado) AS TotalInformado, MIN(Unidad) AS Unidad FROM GCWin_V_PBI_RsDesc WITH (NOLOCK) WHERE Recurso=@recurso AND Fecha>=@inicio`);

        const row = result.recordset[0];
        const response = {
            success: true,
            data: {
                recurso: recursoNum, mes, anio,
                descarte: {
                    unidad: (row && row.Unidad || '').trim(),
                    totalTeorico: parseFloat(row && row.TotalTeorico) || 0,
                    totalInformado: parseFloat(row && row.TotalInformado) || 0
                }
            }
        };
        setCache(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error(`❌ Error descarte recurso ${req.params.recurso}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo datos de descarte', details: error.message });
    }
});

// ===== AUTENTICACIÓN LOCAL =====
// Solo se acepta cuando el request proviene de un host de red interna,
// para que en producción (Vercel/Internet) el endpoint quede inhabilitado
// aunque el password sea conocido.
const LOCAL_USER = 'admin';
const LOCAL_PASS = 'password123';

function isLocalHost(req) {
    const forwardedHost = (req.headers['x-forwarded-host'] || '').toLowerCase().split(',')[0].trim();
    const host = (forwardedHost || req.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.startsWith('svr-ia-2')) return true;
    // IPs privadas RFC1918
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
    return false;
}

app.get('/api/auth/local-allowed', (req, res) => {
    res.json({ allowed: isLocalHost(req), host: req.hostname });
});

app.post('/api/auth/local', (req, res) => {
    if (!isLocalHost(req)) {
        return res.status(403).json({ success: false, error: 'Inicio de sesión local no disponible en este host' });
    }
    const { username, password } = req.body || {};
    if (username !== LOCAL_USER || password !== LOCAL_PASS) {
        saveLog('auth_local_fail', { username, ip: req.ip, host: req.hostname });
        return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    saveLog('auth_local_ok', { username, ip: req.ip, host: req.hostname });
    res.json({
        success: true,
        token,
        user: { email: 'admin@local', name: 'Administrador local' },
        timestamp: new Date().toISOString()
    });
});

// ===== CONSUMO ENERGÉTICO (desde el 1° del mes actual hasta hoy) =====
app.get('/api/recurso/:recurso/consumo-energetico', async (req, res) => {
    try {
        const recursoNum = parseInt(req.params.recurso, 10);
        if (isNaN(recursoNum)) {
            return res.status(400).json({ success: false, error: 'Recurso debe ser un número' });
        }

        const cacheKey = `consumo_ene_${recursoNum}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const connection = await connectTableroDB();
        const request = new sql.Request(connection);
        request.timeout = 30000;

        // Rango: desde el 1° del mes actual hasta el día de hoy (zona horaria local)
        const pad = n => String(n).padStart(2, '0');
        const hoy = new Date();
        const fechaInicio = `${hoy.getFullYear()}${pad(hoy.getMonth() + 1)}01`;
        const fechaFin    = `${hoy.getFullYear()}${pad(hoy.getMonth() + 1)}${pad(hoy.getDate())}`;

        request.input('recurso', sql.VarChar(10), padRecurso(recursoNum));
        request.input('fechaInicio', sql.VarChar, fechaInicio);
        request.input('fechaFin', sql.VarChar, fechaFin);

        const result = await request.query(`
            SET NOCOUNT ON;
            SELECT Fecha, Valor, Unidad
            FROM GCWin_V_PBI_CmoEne WITH (NOLOCK)
            WHERE Recurso = @recurso
              AND Fecha >= @fechaInicio
              AND Fecha <= @fechaFin
            ORDER BY Fecha DESC
        `);

        // Reordenar cronológicamente ascendente para el gráfico
        const datos = result.recordset
            .map(r => ({
                fecha:  fromSqlDate(r.Fecha),
                valor:  parseFloat(r.Valor) || 0,
                unidad: (r.Unidad || '').trim()
            }))
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        const response = {
            success: true,
            data: { recurso: recursoNum, datos },
            timestamp: new Date().toISOString()
        };
        setCache(cacheKey, response);
        res.json(response);

    } catch (error) {
        console.error(`❌ Error consumo energético recurso ${req.params.recurso}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo consumo energético', details: error.message });
    }
});

// ===== RUTA PRINCIPAL =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== MANEJO DE ERRORES =====
app.use((err, req, res, next) => {
    console.error('❌ Error del servidor:', err);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        timestamp: new Date().toISOString()
    });
});

// Ruta para manejar 404
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
});

// ===== PRE-CACHÉ LIVIANO =====
// Solo precachea el listado general de recursos (1 sola query).
// El detalle de cada recurso se cachea bajo demanda cuando un usuario lo solicita.
async function precacheRecursos() {
    if (precacheRunning) return;
    precacheRunning = true;
    try {
        const connection = await connectTableroDB();
        const request = new sql.Request(connection);
        request.timeout = 30000;

        // OJO: esta query duplica la de /api/recursos y pisa el mismo caché.
        // Si se agrega o saca una columna allá, hay que hacerlo también acá.
        const result = await request.query(`
            SELECT Recurso, Multiplicidad, Estado, MotivoInterrup, Operarios, OpEnCurso,
                   OpPendientes, Producto, KgAcumDelDia, MinsInterrupDelDia, MinsEstadoActual
            FROM GCWin_V_EstadoRecursosCables ORDER BY Recurso, TRY_CAST(Multiplicidad AS INT)
        `);

        const recursos = result.recordset.map(row => {
            const recursoData = { Operarios: row.Operarios, Estado: row.Estado, MotivoInterrup: row.MotivoInterrup };
            const estadoInfo = determinarEstadoRecurso(recursoData);
            return {
                numero: row.Recurso, multiplicidad: (row.Multiplicidad || '').toString().trim(),
                estado: estadoInfo.estado, estadoTexto: estadoInfo.estadoTexto,
                motivoInterrupcion: row.MotivoInterrup || '', operarios: row.Operarios || 0,
                opEnCurso: row.OpEnCurso || 'Sin OP', opPendientes: row.OpPendientes || 0,
                producto: row.Producto || 'Sin producto', kgAcumulados: parseFloat(row.KgAcumDelDia) || 0,
                minutosInterrupcion: parseInt(row.MinsInterrupDelDia) || 0, minutosEstadoActual: parseInt(row.MinsEstadoActual) || 0
            };
        });

        setCache('recursos_all', {
            success: true, data: recursos, total: recursos.length, timestamp: new Date().toISOString()
        });
        console.log(`[PRECACHE] Listado de ${recursos.length} recursos actualizado`);
    } catch (err) {
        console.error('[PRECACHE] Error:', err.message);
    } finally {
        precacheRunning = false;
    }
}

// ===== INICIAR SERVIDOR =====
app.listen(PORT, () => {
    console.log(`
🚀 ===== SERVIDOR TABLERO IMSA INICIADO =====
🌐 URL Local: http://localhost:${PORT}
🏢 URL Intranet: http://[IP-DEL-SERVIDOR]:${PORT}
📊 Endpoints disponibles:
   • GET /api/test-connection
   • GET /api/diagnostico/:recurso  (diagnóstico de tiempos)
   • GET /api/recursos
   • GET /api/objetivos
   • POST /api/objetivos
   • GET /api/recurso/:id/all  (unificado)
🔄 Servidor listo para recibir conexiones...
==========================================
    `);

    // Precaché liviano: solo el listado general de recursos
    setTimeout(() => precacheRecursos(), 10000);
    // Refrescar el listado cada 2 minutos (alineado con el polling del frontend)
    setInterval(() => precacheRecursos(), 120000);
});

// ===== MANEJO DE CIERRE GRACEFUL =====
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor...');
    if (connectionPool) {
        await connectionPool.close();
        console.log('✅ Conexión a base de datos cerrada');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Cerrando servidor...');
    if (connectionPool) {
        await connectionPool.close();
        console.log('✅ Conexión a base de datos cerrada');
    }
    process.exit(0);
}); 