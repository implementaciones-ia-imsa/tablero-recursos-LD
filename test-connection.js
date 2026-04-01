// Script para probar la conexión a la base de datos SQL Server
const sql = require('mssql');

// Configuración de la base de datos (igual que en server.js)
const tableroConfig = {
    server: '192.168.100.164',
    database: 'CWSGImsa',
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        requestTimeout: 60000,
        connectionTimeout: 30000,
    },
    authentication: {
        type: 'ntlm',
        options: {
            domain: 'IMSA',
            userName: 'SVC_dashboard_ia',
            password: '2!R4+F7=4hx??9^B3k'
        }
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000
    }
};

async function testConnection() {
    let connection = null;
    
    try {
        console.log('🔄 Intentando conectar a SQL Server...');
        console.log(`📍 Servidor: ${tableroConfig.server}`);
        console.log(`🗄️  Base de datos: ${tableroConfig.database}`);
        console.log(`👤 Usuario: ${tableroConfig.authentication.options.domain}\\${tableroConfig.authentication.options.userName}`);
        console.log('');
        
        // Conectar
        connection = await sql.connect(tableroConfig);
        console.log('✅ Conexión establecida exitosamente!');
        
        // Probar una consulta simple
        const request = new sql.Request(connection);
        const result = await request.query('SELECT @@VERSION as version, GETDATE() as fecha');
        
        console.log('📊 Datos de prueba obtenidos:');
        console.log('   Version:', result.recordset[0].version.substring(0, 50) + '...');
        console.log('   Fecha servidor:', result.recordset[0].fecha);
        console.log('');
        
        // Probar la consulta principal
        console.log('🔍 Probando consulta de recursos...');
        const resourceQuery = `
            SELECT TOP 5
                Recurso,
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
            ORDER BY Recurso
        `;
        
        const resourceResult = await request.query(resourceQuery);
        console.log(`✅ Consulta de recursos exitosa! Encontrados ${resourceResult.recordset.length} registros (mostrando primeros 5)`);
        
        if (resourceResult.recordset.length > 0) {
            console.log('📋 Ejemplo de datos:');
            resourceResult.recordset.forEach((row, index) => {
                console.log(`   ${index + 1}. Recurso ${row.Recurso} - Estado: ${row.Estado || 'N/A'} - Producto: ${row.Producto || 'N/A'}`);
            });
        }
        
        console.log('');
        console.log('🎉 ¡Prueba de conexión completada exitosamente!');
        console.log('✅ El servidor está listo para ejecutarse');
        
    } catch (error) {
        console.error('❌ Error de conexión:');
        console.error('   Mensaje:', error.message);
        
        if (error.code) {
            console.error('   Código:', error.code);
        }
        
        console.log('');
        console.log('🔧 Posibles soluciones:');
        console.log('   1. Verificar que la IP 192.168.100.164 sea accesible');
        console.log('   2. Confirmar que SQL Server esté ejecutándose');
        console.log('   3. Verificar credenciales NTLM');
        console.log('   4. Revisar configuración de firewall');
        console.log('   5. Verificar que el puerto 1433 esté abierto');
        
        process.exit(1);
    } finally {
        if (connection) {
            await connection.close();
            console.log('🔌 Conexión cerrada');
        }
    }
}

console.log('🧪 ===== PRUEBA DE CONEXIÓN SQL SERVER =====');
console.log('');

testConnection(); 