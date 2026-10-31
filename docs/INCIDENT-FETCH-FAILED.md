# Incidente: «fetch failed» en ejecuciones largas (Zeldo)

- **Fecha del incidente:** 2026-10-30/31 (UTC)
- **Proyecto:** Zeldo (`3dcf9894-66d8-42a8-bc40-f62e465a4f7e`)
- **Ejecuciones afectadas:** `d9fc29fd-db51-4e8b-8527-4f2b0a1ed788` (23:30) y `35936dc3-f300-409a-a9a9-1f04171b97c2` (00:29)
- **Estado:** causa raíz confirmada y corregida.

## Resumen

Dos ejecuciones seguidas fallaron en el paso **«Implementar»** con el mensaje
`Error del modelo: fetch failed`. El mensaje apuntaba al proveedor del modelo,
pero la causa real era el **timeout de 300 s del cliente HTTP de Node
(`undici`)** sobre la llamada **bloqueante** `session.prompt` al servidor local
de opencode. El turno del agente (varias llamadas al modelo + herramientas)
tarda más de 5 minutos; al no recibir respuesta, el SDK aborta la petición y la
traduce como `fetch failed`.

## Evidencia

Patrón temporal idéntico en los dos intentos de cada ejecución:

| Run | Inicio | Primer `fetch failed` | Diferencia | Fallo final | Diferencia |
|---|---|---|---|---|---|
| `d9fc29fd` | 23:30:12 | 23:35:15 (reintento 1/2) | **5 min 03 s** | 23:40:17 | **5 min 02 s** |
| `35936dc3` | 00:29:28 | 00:34:30 (reintento 1/2) | **5 min 02 s** | 00:39:32 | **5 min 02 s** |

Otros datos:

- El log interno de opencode (`/root/.local/share/opencode/log/opencode.log`)
  muestra el agente trabajando con `deepseek-v4-flash` hasta el final.
- A las **00:34:21** el agente solicitó permiso para leer
  `/tmp/zeldo-server.log`:
  `evaluated permission=external_directory pattern=/tmp/* action.action=ask`
  `asking ... permission=external_directory patterns=["/tmp/*"]`.
- A las **00:39:32**, justo al cortarse la petición, opencode registra
  `cancel session=...` y `error=Aborted` para las sesiones del run.
- El test de conexión del proveedor NaN responde correctamente con **13
  modelos**: no hay evidencia de caída del proveedor.
- El worker está en ejecución y **no fue reiniciado por OOM** (`OOMKilled=false`).

## Causa raíz

1. **Timeout de 300 s de `undici` en `session.prompt`.** El SDK llamaba a
   `POST /session/{id}/message` y esperaba a que terminara el turno completo.
   Node aplica por defecto `headersTimeout` y `bodyTimeout` de 300 000 ms.
   Los turnos del agente superaron ese umbral (≈10 min), por lo que la
   petición se abortó y se reportó como `fetch failed`. Los reintentos
   repitieron el mismo patrón: **dos intentos × 5 min ≈ 10 min por paso**.
2. **Solicitudes de permiso sin respuesta.** opencode pide permiso cuando el
   agente intenta acceder a una ruta externa (`external_directory`). El worker
   no escuchaba eventos `permission.updated` ni respondía, de modo que ese
   turno podía quedar esperando indefinidamente (hasta el timeout del cliente).
   Además, los permisos del harness (`read`/`edit`/`bash`/…) no se estaban
   aplicando al agente: la configuración no incluía `external_directory`.
3. **Diagnóstico engañoso.** El error de red del SDK se propagó como «Error
   del modelo», sin distinguir entre:
   - timeout del cliente ↔ servidor local de opencode,
   - error del proveedor,
   - permiso pendiente.

## Factores contribuyentes

- No existía un **timeout propio por paso** con mensaje claro: el único
  límite era el de `undici`, y su mensaje no explica qué pasó.
- El bucle de reintentos no diferenciaba «petición abortada por timeout» de
  «error transitorio del proveedor».
- Las herramientas `project-info_*` del MCP fallaron durante el run (eventos
  `project-info_get_project (error)`, `list_features (error)`…): el agente
  recibía el nombre de la carpeta del workspace (`1793402558452`) como
  `project_id` en lugar del UUID del proyecto, por lo que las consultas a la
  base de datos devolvían error.
- El asistente del proyecto no recibía los runs ni los eventos; solo el
  número de ejecuciones. Por eso respondió que no tenía acceso al log.

## Causas descartadas

- **Caída del proveedor:** el endpoint responde y el log de opencode no
   contiene errores del proveedor; contiene una cancelación tras el timeout.
- **Reinicio/crash del servidor opencode:** el servidor siguió atendiendo
   eventos y sesiones hasta el aborto.
- **OOM/fallo del worker:** contenedor `running`, `OOMKilled=false`.
- **Bucle infinito del agente:** el turno avanzaba con herramientas y mensajes
  hasta que se cortó la petición.

## Correcciones aplicadas

1. **`promptAsync` + `session.idle`.** El prompt se envía de forma asíncrona y
   el executor espera el evento de sesión inactiva, sin la petición HTTP de
   5 minutos. El texto final se recupera de `session.messages` si el stream no
   lo entregó.
2. **Respuesta automática a permisos.** El executor escucha
   `permission.updated` (incluidas sesiones hijas de `task`) y responde según
   el harness. `external_directory` y `doom_loop` son **deny** por defecto; los
   rechazos se registran como eventos `warn` con fecha y hora.
3. **Timeout explícito por paso.** `AGENT_STEP_TIMEOUT` (30 min por defecto):
   al superarse, se aborta la sesión y el paso falla con un motivo legible.
4. **Cancelación de la sesión al fallar** (evita eventos tardíos).
5. **Fecha y hora en observabilidad.** Cada línea del stream muestra
   `dd/mm hh:mm:ss`.
6. **Asistente con acceso al log.** El contexto del chat incluye las últimas
   5 ejecuciones, los pasos fallidos con su error y los eventos relevantes
   (errores, avisos, orquestador y texto del agente), con fecha y hora.
7. **Permisos `external_directory` y `doom_loop`** añadidos a
   `PermissionConfig` con valor por defecto `deny`.
8. **Project Info MCP accesible.** El prompt del agente incluye el UUID real
   del proyecto (`project_id`) para las tools `project-info_*`, y el servidor
   MCP expone `get_run_log` para consultar la secuencia de eventos y errores.

## Verificación

- **Replay real:** ejecución `fde42b51-d0a8-4cba-b175-e4654bb647ab` (31/10 01:30:39 →
  01:36:49, **6 min 10 s**, por encima del umbral de 300 s) terminó **`succeeded`**
  con los 3 pasos completados y **sin `fetch failed`**.
- **Asistente:** a la pregunta «La ejecución del proyecto falla ¿Cuál es el
  motivo?» responde citando el log real: paso «Implementar», `fetch failed`,
  horas exactas, duración del turno y modelos; distingue el error de red del
  cliente de una caída del proveedor y pide el log del worker para confirmar.
- **MCP:** `get_project` y `get_run_log` responden con el UUID correcto y
  devuelven los eventos de la última ejecución fallida.
- **Observabilidad:** cada línea del stream muestra `dd/mm hh:mm:ss`.
- `pnpm typecheck` y `pnpm test` en verde (47 tests core + 3 API).

## Recomendaciones

- Integrar los permisos con respuesta `ask` en la UI (hoy se rechazan por
  seguridad) si se quiere permitir acceso puntual a rutas externas.
- Revisar el fallo de las herramientas `project-info_*` durante los runs.
- Añadir una alerta visual cuando un paso lleve mucho tiempo (el timeout ya
  genera un aviso, pero convendría avisar antes).
- Prueba de regresión recomendada: un run de más de 5 minutos y un intento de
  lectura fuera del workspace deben terminar sin `fetch failed`.
