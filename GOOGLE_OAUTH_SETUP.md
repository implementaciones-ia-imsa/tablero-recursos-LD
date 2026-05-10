# 🔐 Configuración de Google OAuth 2.0

## Paso 1: Obtener Google Client ID

### 1. Ir a Google Cloud Console
- Accede a: https://console.cloud.google.com/
- Inicia sesión con tu cuenta Google

### 2. Crear un Proyecto (si no lo tienes)
- Click en el dropdown del proyecto (arriba a la izquierda)
- Click en "NEW PROJECT"
- Nombre: `IMSA-Tablero` (o el que prefieras)
- Click en "CREATE"
- Espera a que se cree

### 3. Habilitar Google+ API
- En el buscador de arriba, busca: `Google+ API`
- Click en el resultado
- Click en "ENABLE"

### 4. Crear OAuth 2.0 Credentials
- Ve a: `Credentials` (en el menú izquierdo)
- Click en "CREATE CREDENTIALS"
- Selecciona: `OAuth client ID`
- Si te pide, configura primero la "OAuth consent screen":
  - Click en "CONFIGURE CONSENT SCREEN"
  - Selecciona: `External`
  - Click "CREATE"
  - Rellena:
    - **App name**: IMSA Tablero
    - **User support email**: tu-email@imsa.com.ar
    - **Developer contact**: tu-email@imsa.com.ar
  - Click "SAVE AND CONTINUE" (puedes dejar todo por defecto)
  - Salta los pasos adicionales
  - Click "BACK TO DASHBOARD"

### 5. Crear OAuth Client ID (nuevamente)
- Ve a: `Credentials`
- Click en "CREATE CREDENTIALS" → "OAuth client ID"
- **Application type**: Web application
- **Name**: IMSA Tablero Web
- En **Authorized JavaScript origins**, agrega:
  ```
  http://localhost:5492
  http://[IP-DEL-SERVIDOR]:5492
  https://tu-dominio.com (si tienes)
  ```
- En **Authorized redirect URIs**, agrega:
  ```
  http://localhost:5492/login.html
  http://[IP-DEL-SERVIDOR]:5492/login.html
  https://tu-dominio.com/login.html (si tienes)
  ```
- Click "CREATE"

### 6. Copiar el Client ID
- Se abrirá un modal con tu credentials
- **Copia el "Client ID"** (es un texto largo terminando en `.apps.googleusercontent.com`)

---

## Paso 2: Actualizar el Código

### En `login.html`, línea ~196:
```javascript
const CLIENT_ID = 'TU_GOOGLE_CLIENT_ID_AQUI';
```

Reemplaza `TU_GOOGLE_CLIENT_ID_AQUI` con tu Client ID copiado.

**Ejemplo:**
```javascript
const CLIENT_ID = '123456789-abcdefg.apps.googleusercontent.com';
```

---

## Paso 3: Actualizar index.html

En `index.html`, busca donde obtiene el usuario (línea ~150) y cambia:

```javascript
const user = localStorage.getItem('imsa_auth_user');
```

Ya está actualizado en el login.html para guardar estos datos:
- `imsa_auth_token`
- `imsa_auth_user` (email completo)
- `imsa_auth_time`
- `imsa_auth_name` (nombre del usuario)
- `imsa_auth_picture` (foto del perfil)

---

## Validaciones Implementadas

✅ **Dominio**: Solo @imsa.com.ar  
✅ **JWT Verificado**: Google firma los tokens  
✅ **Sesión 24h**: Se invalida automáticamente  
✅ **LocalStorage**: Seguro para datos de sesión  

---

## Testing Local

```bash
# URL Local
http://localhost:5492/login.html

# Con la IP del servidor
http://192.168.X.X:5492/login.html
```

---

## Troubleshooting

### "No se carga el botón de Google"
- Verifica que `CLIENT_ID` sea correcto
- Chequea la consola (F12 → Console)

### "No autorizado para este origen"
- Asegúrate de agregar el origen exacto en Google Cloud Console
- Incluye `http://` o `https://` según corresponda

### "Email no autorizado"
- Verifica que el email sea @imsa.com.ar
- El error mostrará qué email intentaste usar

---

**Listo para usar Google OAuth 2.0** 🔐
