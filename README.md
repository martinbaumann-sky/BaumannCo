# BaumannCo.
Website de consultoria Baumann&amp;Co.

## Scheduler backend

Este repositorio ahora incluye un backend de Node/Express que se conecta a Google Calendar para leer disponibilidad real, bloquear el hueco seleccionado y enviar la invitación por correo.

### Pasos para correrlo

1. Copiá `backend/.env.example` a `backend/.env` y completá los valores (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `HOST_URL`, `PORT`, etc.). El `GOOGLE_REDIRECT_URI` debe coincidir con `http://localhost:4000/api/google/oauth2callback` si usás el puerto por defecto.
2. Entrá a la [Google Cloud Console](https://console.cloud.google.com/), creá un proyecto y habilitá la API de Google Calendar. Generá credenciales OAuth tipo Web Application y pegá el client ID y secret en `.env`.
3. Desde la raíz ejecutá:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
4. Abrí el navegador en `http://localhost:4000/api/google/auth-url`, seguí el flujo y concedé acceso. Guardá el token generado en `backend/data/google-tokens.json` (se crea automáticamente).
5. Con el backend corriendo, abrí `schedule.html` desde un servidor estático (ej: `npx serve .`) o tu hosting preferido y asegurate de que la página pueda alcanzar `http://localhost:4000`. Si la página se sirve desde otro origen, definí `window.SCHEDULER_API_URL = 'http://localhost:4000';` antes de cargar el script del calendario.

### Qué hace el backend

- `GET /api/google/availability`: devuelve los próximos días hábiles con franjas libres según los eventos actuales del calendario conectado.
- `POST /api/google/event`: crea el evento en el calendario con los datos proporcionados (nombre, correo, notas) y envía la invitación por correo a los asistentes.
- `GET /api/google/auth-url` y `/api/google/oauth2callback`: permiten refrescar el token de Google cuando lo necesites.

### Detalles importantes

- El backend utiliza la API de Google Calendar con scopes de lectura/escritura. No expone las credenciales, solo un `TOKEN_PATH` local.
- Para integrar Outlook en el futuro, podés añadir rutas similares que usen Microsoft Graph y el flujo OAuth de Azure.
- El frontend ya muestra los slots devueltos por la API y activa la reserva real cuando se presiona “Reservar en mi calendario”; también mantiene los botones para generar eventos manuales o descargar el `.ics`.
- El sistema está pensado para Santiago, Chile (GMT-3): el backend usa `America/Santiago` y la UI formatea en `es-CL`. Modificá `GOOGLE_TIMEZONE` en `.env` si necesitás otra zona.

## Ejecutar el sitio (frontend)

Los siguientes scripts sirven el contenido estático para que puedas navegar `schedule.html` mientras el backend está corriendo.

1. En Windows:
   ```cmd
   run-website-windows.bat
   ```
   Esto utiliza `npx serve` en el puerto `3000` y expone `http://localhost:3000`. Windows solicitará permiso para abrir una terminal si lo ejecutás con doble clic.

2. En macOS/Linux:
   ```bash
   ./run-website-mac.sh
   ```
   Asegurate de que el script sea ejecutable (`chmod +x run-website-mac.sh`, ya aplicado) y tené Node.js disponible para usar `npx serve`.

Si vas a servir el frontend desde otro host, inicializá `window.SCHEDULER_API_URL` antes del script inline en `schedule.html` para apuntar al backend (ej. `window.SCHEDULER_API_URL = 'http://localhost:4000';`).
