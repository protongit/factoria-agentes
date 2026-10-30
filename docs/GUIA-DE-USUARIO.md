# Guía de usuario — Factoría de Agentes

Esta guía está escrita para **cualquier persona**, sin necesidad de saber gestionar proyectos ni programar. Explica, paso a paso, cómo usar la aplicación para que un equipo de "ayudantes automáticos" (los agentes de IA) construya un programa de software por ti.

Si en algún momento ves una palabra que no entiendes, salta al **[Glosario](#glosario)** al final: allí se explican todos los términos con palabras sencillas.

---

## Índice

1. [¿Qué es Factoría de Agentes?](#1-qué-es-factoría-de-agentes)
2. [Entrar en la aplicación](#2-entrar-en-la-aplicación)
3. [Conocer la pantalla y el menú](#3-conocer-la-pantalla-y-el-menú)
4. [Paso previo: dar de alta los "ayudantes" (proveedores y modelos)](#4-paso-previo-dar-de-alta-los-ayudantes-proveedores-y-modelos)
5. [Crear un flujo de trabajo](#5-crear-un-flujo-de-trabajo)
6. [Crear un proyecto](#6-crear-un-proyecto)
7. [Completar la definición del proyecto](#7-completar-la-definición-del-proyecto)
8. [Lanzar el desarrollo y seguirlo en vivo](#8-lanzar-el-desarrollo-y-seguirlo-en-vivo)
9. [Aprobar un paso (cuando el flujo lo pida)](#9-aprobar-un-paso-cuando-el-flujo-lo-pida)
10. [Ver el código y los archivos que se generan](#10-ver-el-código-y-los-archivos-que-se-generan)
11. [Consultar los costes](#11-consultar-los-costes)
12. [Hablar con el asistente del proyecto](#12-hablar-con-el-asistente-del-proyecto)
13. [Recorrido completo de ejemplo](#13-recorrido-completo-de-ejemplo)
14. [Preguntas frecuentes](#14-preguntas-frecuentes)
15. [Glosario](#glosario)

---

## 1. ¿Qué es Factoría de Agentes?

Imagina que quieres que alguien te construya un programa (por ejemplo, un juego, una web o una aplicación para el móvil), pero en lugar de contratar a programadores, se lo pides a unos **ayudantes automáticos** que trabajan solos, en cadena, siguiendo tus instrucciones.

Eso es lo que hace esta aplicación:

- **Tú describes lo que quieres** (el objetivo, qué debe hacer el programa, qué debe cumplir).
- **Tú decides el orden de las tareas** (quién hace qué y en qué momento). A ese orden se le llama **flujo de trabajo**.
- **La aplicación lanza a los ayudantes automáticos**, que van programando, revisando su propio trabajo y documentando el resultado.
- **Tú lo ves todo en tiempo real**: en qué paso está, qué está haciendo y qué archivos va creando.

Una idea clave: los ayudantes son programas de inteligencia artificial que has de "dar de alta" antes (indicando con qué servicio y modelo trabajan). Eso se hace **una sola vez**, en el paso 4.

---

## 2. Entrar en la aplicación

### 2.1 Abrir la aplicación

1. Abre tu navegador (Chrome, Firefox, Edge…).
2. Escribe la dirección de la aplicación en la barra superior. En esta instalación es:
   **http://localhost:8088**
3. Pulsa *Intro*.

Verás una pantalla oscura con el texto **"Factoría de Agentes"** y dos pestañas: **Entrar** y **Registrarse**.

### 2.2 Crear tu cuenta (solo la primera vez)

1. Pulsa la pestaña **Registrarse**.
2. Rellena:
   - **Nombre**: tu nombre (por ejemplo, *Ana*).
   - **Email**: tu correo (por ejemplo, *ana@ejemplo.com*).
   - **Contraseña**: una contraseña de al menos 8 caracteres.
3. Pulsa **Crear cuenta**.

La aplicación te lleva directamente dentro, ya con la sesión iniciada.

> **Cuenta de prueba**: si es una instalación de demostración, puede existir ya un usuario de ejemplo con email `demo@factoria.dev` y contraseña `demo12345`.

### 2.3 Entrar si ya tienes cuenta

1. En la pestaña **Entrar**, escribe tu **Email** y tu **Contraseña**.
2. Pulsa **Entrar**.

---

## 3. Conocer la pantalla y el menú

A la izquierda tienes una **barra lateral** (el menú). De arriba abajo:

| Elemento | Para qué sirve |
|---|---|
| **Proyectos** | Tus programas. Es lo primero que verás al entrar. |
| **Flujos de trabajo** | Los "planos" que indican el orden de las tareas. |
| **Subagentes** | Ayudantes especializados (revisor, explorador, escritor de tests…). |
| **Proveedores y modelos** | Los servicios de IA que usan los ayudantes. |
| **ES · English** | Cambia el idioma de los menús. |
| **Tu nombre y email** | Datos de tu sesión. |
| **Salir** | Cierra tu sesión. |

Arriba a la izquierda, el botón **«** oculta el menú para aprovechar toda la pantalla. Cuando está oculto, aparece un botón **»** para volver a mostrarlo.

> **Qué verás**: cada vez que entres en una sección, el contenido se carga en el centro-derecha de la pantalla. Todo se guarda solo cuando pulsas los botones de guardar; no hay que "guardar archivos" como en un procesador de textos.

---

## 4. Paso previo: dar de alta los "ayudantes" (proveedores y modelos)

Antes de crear proyectos, hay que decirle a la aplicación **qué servicios de inteligencia artificial** puede usar. Esto se hace **una sola vez**.

### 4.1 Qué es un "proveedor" y un "modelo"

- **Proveedor**: la empresa o servicio de IA (por ejemplo, *Anthropic*, *OpenAI* o *NaN*).
- **Modelo**: la "versión" concreta del ayudante que ofrece ese proveedor (por ejemplo, *Claude Sonnet* o *DeepSeek*).

### 4.2 Dar de alta un proveedor

1. En el menú, pulsa **Proveedores y modelos**.
2. En el panel **Proveedores** (izquierda), rellena:
   - **Nombre**: el nombre del proveedor (por ejemplo, *Anthropic*).
   - **API key**: una clave secreta que te da ese proveedor (parece una contraseña larga, tipo `sk-...`).
3. Pulsa **Añadir proveedor**.
4. El proveedor aparece en la lista de abajo.

> **Nota**: la "API key" es como la llave de tu casa con ese servicio. La aplicación la guarda cifrada (protegida) y no se muestra a nadie.

### 4.3 Dar de alta un modelo

1. En el panel **Modelos** (derecha), rellena:
   - **Proveedor**: elige el que acabas de crear en la lista desplegable.
   - **ID del modelo**: el nombre técnico del modelo (por ejemplo, `anthropic/claude-sonnet-4-6`). Si no lo sabes, lo indica el proveedor.
   - **Nombre visible**: cómo quieres que aparezca en la aplicación (por ejemplo, *Claude Sonnet*).
   - **Capacidades**: marca las casillas que correspondan a lo que ese modelo sabe hacer:
     - `code` (escribir código), `reasoning` (razonar), `toolUse` (usar herramientas),
       `structuredOutput` (responder de forma ordenada), `longContext` (textos largos),
       `vision` (entender imágenes), `embeddings` y `rerank` (para buscar en documentos),
       `imageGeneration` (crear imágenes).
2. Pulsa **Añadir modelo**.
3. El modelo aparece en la lista.

> **Consejo**: para un proyecto normal, basta con un modelo que tenga `code` y `reasoning`. Si vas a subir documentos (paso 7), añade también un modelo con `embeddings` y otro con `rerank`. Si quieres que el asistente dibuje bocetos, añade uno con `imageGeneration`.

### 4.4 Subagentes (ayudantes especializados) — opcional

1. En el menú, pulsa **Subagentes**.
2. Pulsa **Cargar plantillas (12)** para tener de golpe una docena de ayudantes especializados (revisor, explorador, escritor de tests, documentador…).
3. Puedes ver cómo quedaría cada uno pulsando **Ver fichero**, o crear el tuyo con **Nuevo subagente**.

No es obligatorio, pero usar el subagente **documentador** o **revisor** en tus flujos mejora los resultados.

---

## 5. Crear un flujo de trabajo

El **flujo de trabajo** es el "plano" del desarrollo: una serie de cajas (tareas) conectadas por flechas que indican el orden. Por ejemplo: *primero programar → luego revisar → después documentar*.

Tienes dos formas de crearlo: **desde una plantilla** (recomendado para empezar) o **desde cero**.

### 5.1 Crear un flujo desde una plantilla

1. En el menú, pulsa **Flujos de trabajo**.
2. En la zona **Plantillas** verás cuatro planos ya hechos (por ejemplo, *"Bucle de revisión estricta"* o *"Backend ‖ Frontend → Revisor"*).
3. Pulsa **Usar plantilla** en la que quieras. La aplicación te abre ese flujo listo para ajustar.

### 5.2 Crear un flujo desde cero

1. En **Flujos de trabajo**, pulsa **Nuevo flujo** (arriba a la derecha).
2. Se abre el **editor de flujo**: una pizarra con cajas y flechas.
3. Añade tareas desde la **paleta de nodos** (columna izquierda). Los tipos más útiles:
   - **Tarea**: un ayudante hace un trabajo (programar, crear un archivo…).
   - **Revisor**: comprueba el trabajo y decide si está bien.
   - **Aprobación** (human_approval): el desarrollo se pausa hasta que tú apruebes.
   - **Contratos** (contract_check): comprueba que se cumplen tus criterios de aceptación.
   - **Bucle / condición**: repite o decide caminos.
   - **Nota** (✎): una nota adhesiva para ti; no ejecuta nada.
4. Haz clic en cada caja y, en el panel **Configuración** (derecha), rellena:
   - **Nombre**: cómo se llama el paso.
   - **Tipo**: tarea, revisor, etc.
   - **Descripción**: qué debe hacer el ayudante (cuanto más claro, mejor).
   - **Resultado esperado**: cómo sabremos que ese paso está bien hecho.
   - **Directorio de trabajo**: dónde guarda los archivos (déjalo en `.` si no lo sabes).
   - **Subagente** y **Modelo**: quién lo hace y con qué modelo.
   - **Join**: `all` (esperar a todos) o `any` (seguir con el primero que llegue).
5. Para conectar dos cajas, arrastra desde el punto de la derecha de una caja hasta el punto de la izquierda de otra. Puedes etiquetar la flecha como **éxito** o **fallo** (por ejemplo: "si el revisor falla, vuelve a la tarea").
6. Pulsa **Guardar** (arriba a la derecha).

> **Qué verás**: las cajas se colorean por tipo. Si te lías, pulsa **Auto-ordenar** para que la aplicación las coloque en orden. Con **↶** y **↷** deshaces o rehaces cambios (y se recuerdan aunque cierres el navegador). **Exportar** guarda el flujo en un archivo para reutilizarlo con **Importar JSON**.

### 5.3 Otras herramientas del editor

- **Versiones**: guarda "fotos" del flujo; puedes **Restaurar** una anterior.
- **Variables**: valores reutilizables (por ejemplo, el nombre del programa). Puedes escribirlos una vez y usarlos con `{{ vars.nombre }}`.
- **Probar nodo**: selecciona una caja y pulsa **▶ Probar nodo** para ejecutar solo ese paso y ver el resultado, sin lanzar todo el proyecto.

---

## 6. Crear un proyecto

Un **proyecto** es el programa que quieres construir.

1. En el menú, pulsa **Proyectos**.
2. Pulsa **+ Nuevo proyecto** (arriba a la derecha).
3. Rellena:
   - **Nombre**: un nombre corto (por ejemplo, *Mi juego*).
   - **Nombre del programa**: el nombre del software (por ejemplo, *JuegoPang*).
   - **Objetivo**: escribe, en tus palabras, **qué quieres conseguir**. Por ejemplo: *"Un juego de plataformas 2D donde el personaje salta, hay enemigos y 3 niveles"*.
   - **Flujo de trabajo**: elige el flujo que creaste en el paso 5.
4. Pulsa **Crear proyecto**. Entras directamente en la ficha del proyecto.

> **Qué verás**: arriba, el nombre del proyecto con una etiqueta de estado (por ejemplo, `draft` = borrador, `completed` = completado). De momento está en "borrador" porque aún no se ha ejecutado.

### 6.1 Borrar un proyecto (si te equivocas)

En la lista de **Proyectos**, pasa el cursor por la tarjeta y usa la opción de borrar. Se eliminan también sus datos asociados.

---

## 7. Completar la definición del proyecto

Al abrir un proyecto verás **pestañas** en la parte superior. Vamos una por una.

### 7.1 General

Es el resumen del proyecto. Aquí puedes:

- **Objetivo** y **Descripción**: afinar lo que quieres.
- **Stack**: las "tecnologías" con las que se construirá (por ejemplo, `javascript`, `react`). Si no lo sabes, escribe lo que te suene o déjalo vacío.
- **Flujo de trabajo**: cambiar el flujo asignado.
- **Modelo del asistente**: el modelo que usará el asistente de la pestaña "Asistente".
- **Modelo de embeddings (RAG)** y **Modelo de rerank**: los usados para **buscar** dentro de tus documentos (si subes documentos en 7.4).
- **Guardar cambios** para aplicar.

### 7.2 Funcionalidades

Es la lista de "cosas que debe hacer" el programa.

1. En la caja de texto, escribe una funcionalidad (por ejemplo, *"El personaje salta con la barra espaciadora"*).
2. Pulsa **Añadir**. Repite para cada funcionalidad.

### 7.3 Contratos

Los **contratos** son los **criterios de aceptación**: las condiciones que deben cumplirse para dar el proyecto por terminado (por ejemplo, *"El juego arranca y se puede jugar"*).

1. Rellena:
   - **Título**: un nombre corto.
   - **Verificación**: cómo se comprobará:
     - **juez IA**: una IA lee el resultado y decide si se cumple.
     - **comando**: se ejecuta una orden técnica (por ejemplo, comprobar que existe un archivo).
     - **manual**: lo decides tú.
   - **Criterio de aceptación**: la condición concreta y comprobable.
2. Pulsa **Añadir contrato**.

> **Importante**: el proyecto **no se marcará como "completado"** hasta que todos los contratos estén cumplidos.

### 7.4 Documentación

Aquí guardas **material de apoyo** para los ayudantes y generas bocetos.

- **Añadir documento (texto)**: escribe un **Título** y pega un texto; pulsa **Añadir documento**. Se guarda en la "base de conocimiento".
- **Subir documento (PDF, XML, TXT…)**: pulsa **⬆ Subir documento**, elige un archivo de tu ordenador (por ejemplo, un PDF con los requisitos). La aplicación **extrae el texto** y lo añade a la base de conocimiento automáticamente.
- **Generar imagen (bocetos)**: elige un **Modelo de imagen**, escribe un **Prompt** (descripción de lo que quieres dibujar) y pulsa **Generar imagen**. Se añade como imagen del proyecto.
- **RAG · búsqueda**: escribe una palabra y pulsa **Buscar** para encontrar fragmentos relevantes dentro de tus documentos. **Reindexar todo** vuelve a procesar la documentación.
- **Memoria de largo plazo**: escribe una decisión o nota importante y pulsa **Recordar**; luego podrás **Buscar** en ella.

> **Qué verás**: las etiquetas de estado (*indexed* = indexado) indican que el documento ya es buscable.

### 7.5 Flujo

Muestra el **diagrama** de tu flujo de trabajo.

- Los pasos **no ejecutados** se ven en **gris**.
- Los que están **en ejecución** se resaltan (azul), los **completados** en verde y los **fallidos** en rojo.
- Si un paso se repite (por un bucle), aparece en **naranja** con una etiqueta **×N** (por ejemplo, `×3` = se ha ejecutado 3 veces).
- Usa los controles de **zoom** (＋, －, encuadrar) para acercar o alejar.
- Pulsa el nombre del flujo para **editarlo** si necesitas cambiar algo.

---

## 8. Lanzar el desarrollo y seguirlo en vivo

### 8.1 Lanzar

1. En la cabecera del proyecto, pulsa **▶ Lanzar ejecución**.
2. La aplicación avisa "Ejecución lanzada" y te lleva a la pestaña **Ejecuciones**.

> **Importante**: aunque cierres el navegador o tu sesión, **el desarrollo sigue funcionando** en el servidor. Al volver, podrás ver todo lo ocurrido.

### 8.2 Ver qué está pasando

En **Ejecuciones**, a la izquierda tienes la lista de ejecuciones (con fecha y estado). A la derecha:

- **Observabilidad en vivo**: una ventana donde van apareciendo, en orden, los mensajes de lo que hacen los ayudantes ("Paso iniciado", "El agente terminó su trabajo"…).
- **Botones de control**:
  - **Pausar**: detiene el proceso (puedes reanudarlo después).
  - **Reanudar**: continúa un proceso pausado.
  - **Cancelar**: detiene definitivamente esa ejecución.
  - **Ver trazas**: muestra el **árbol de actividad** (qué paso, cuánto tardó, cuántos "tokens" gastó). Tiene un botón **Exportar OTLP** para llevarte esos datos a otras herramientas.
- Una etiqueta con los **tokens** y el **coste** de la ejecución.

Estados que verás: `queued` (en cola), `running` (en marcha), `paused` (en pausa), `succeeded` (terminó bien), `failed` (falló), `cancelled` (cancelado).

### 8.3 Si un paso falla

Si un paso falla y el flujo está preparado para volver atrás (bucle de corrección), **se repetirá automáticamente** dándole al ayudante las indicaciones de qué corregir. Si no, verás un botón **↻ Reejecutar desde «paso»**: vuelve a empezar desde ese paso concreto, sin repetir lo que ya estaba bien.

---

## 9. Aprobar un paso (cuando el flujo lo pida)

Algunos flujos incluyen un paso de **Aprobación** para que **tú decidas** antes de seguir (por ejemplo, revisar el juego antes de publicarlo).

1. Cuando el proceso llegue a ese paso, la ejecución se **pausa** y en **Observabilidad en vivo** aparece **Aprobaciones pendientes**.
2. Pulsa **Aprobar** para continuar o **Rechazar** para que se corrija.
3. Tras aprobar, el proceso se reanuda solo.

> Si prefieres un desarrollo **totalmente automático**, usa un flujo **sin** pasos de aprobación.

---

## 10. Ver el código y los archivos que se generan

En la pestaña **Archivos** puedes explorar todo lo que los ayudantes han creado.

1. **Explorador** (izquierda): navega por las carpetas. Pulsar una carpeta entra en ella; las "migas de pan" (raíz / carpeta / subcarpeta) te permiten volver atrás. Puedes **Refrescar** para ver los archivos nuevos.
2. **Visor** (derecha): haz clic en un archivo y verás su contenido. Si es muy grande, se muestra recortado; si es una imagen o un archivo binario, lo indica.

Aquí es donde comprobarás, por ejemplo, que se han creado `index.html`, `game.js` y `README.md` de tu programa.

### Descargar el proyecto

En la cabecera del explorador pulsa **Descargar (.tar.gz)**. Se descargará una carpeta comprimida con todos los archivos del proyecto (sin archivos internos como `.git` ni secretos) para que puedas abrirla en tu ordenador.

### Probar la aplicación (pestaña Entorno)

En la pestaña **Entorno**, sección **Aplicación desarrollada**:

- **Vista previa estática**: si el proyecto genera un `index.html`, verás el programa funcionando dentro de la propia página. Usa **Recargar** tras una nueva ejecución y **Abrir en pestaña** si prefieres verlo a pantalla completa.
- **Servidor de desarrollo**: para proyectos con servidor (Vite, Next, Express…):
  1. Escribe el **Comando** de arranque (por ejemplo `npm run dev -- --host 0.0.0.0 --port 3000`) y el **Puerto**.
  2. Pulsa **Guardar**.
  3. Pulsa **Arrancar app**. Cuando esté lista, aparecerá el estado **running** y el botón **Abrir app**.
  4. **Ver logs** muestra los mensajes del servidor; **Parar app** lo detiene.

> El servidor se ejecuta dentro del contenedor aislado del proyecto. Si necesita instalar dependencias con `npm install`, cambia la red del proyecto a **Abierta** o instálalas antes.

---

## 11. Consultar los costes

Los ayudantes de IA consumen "tokens" (una unidad de uso) que tienen un coste.

- En la pestaña **General**, sección **Presupuesto y coste**:
  - **Consumo** actual (tokens y coste acumulado).
  - **Límite blando** y **Límite duro** en dólares: al superar el blando recibes un aviso; al superar el duro, las ejecuciones se pausan.
  - **Webhook de alertas**: una dirección a la que la aplicación avisará (por ejemplo, un aviso a Slack). El botón **Probar** comprueba que funciona.
  - **Coste por modelo/tipo** y un gráfico de **los últimos 30 días**.

---

## 12. Hablar con el asistente del proyecto

En la pestaña **Asistente** tienes un ayudante que conoce tu proyecto.

- **Preguntar**: escribe y pulsa **Enviar**. Por ejemplo, *"¿Qué me recomiendas priorizar?"*.
- **Pedir propuestas**: escribe *"propón funcionalidades"* o *"propón contratos"*. El asistente propondrá una lista, que aparecerá en **Propuestas pendientes** con botones **Aceptar** o **Rechazar**. Al aceptar, se añaden al proyecto.
- **Resumen de ausencia**: si has estado fuera, pulsa **Resumen de ausencia** para saber qué ocurrió mientras no mirabas.
- **Imágenes**: el asistente también puede generar bocetos (según el modelo elegido).

---

## 13. Recorrido completo de ejemplo

Vamos a juntar todo con un caso real: construir **un juego de plataformas sencillo**.

1. **Proveedores y modelos** → añade un proveedor (nombre + API key) y un modelo con capacidades `code` y `reasoning`. Añade también uno con `embeddings` si vas a subir documentos.
2. **Flujos de trabajo** → pulsa **Usar plantilla** en *"Bucle de revisión estricta"*. Aspira a: *programar → revisar (si falla, vuelve a programar) → comprobar contratos → fin*.
3. **Subagentes** → **Cargar plantillas** y añade el subagente **documentador** a un paso de "Documentar" si quieres.
4. **Proyectos** → **+ Nuevo proyecto**:
   - Nombre: *Mi plataformas*
   - Nombre del programa: *Plataformas*
   - Objetivo: *"Un juego 2D con un personaje que salta, enemigos y 3 niveles"*.
   - Flujo de trabajo: el que creaste.
5. Abre el proyecto y completa:
   - **Funcionalidades**: "El personaje se mueve con las flechas y salta con espacio", "Hay enemigos", "3 niveles", "Marcador de puntos".
   - **Contratos**: criterio *"Existe index.html y game.js y su sintaxis es válida"* con verificación **comando**.
   - **Documentación**: **⬆ Subir documento** con un PDF de tus ideas.
6. Cuando el flujo lo pida (paso de revisión), verás el **diagrama en Flujo** coloreándose y, si hay aprobación, la pausa.
7. **Ejecuciones** → sigue la **Observabilidad en vivo** y consulta **Ver trazas** al final.
8. **Archivos** → comprueba `index.html`, `game.js`, `levels.js` y `README.md`.
9. **Asistente** → pídele *"propón funcionalidades"* y acepta las que te gusten.
10. Cuando **todos los contratos** estén cumplidos, el proyecto pasará a **completed**.

---

## 14. Preguntas frecuentes

**¿Necesito saber programar?**
No. Tú describes lo que quieres y eliges el orden de las tareas. Los ayudantes escriben el código.

**¿Qué pasa si cierro el navegador durante un desarrollo?**
Nada: sigue funcionando solo. Al volver verás en **Ejecuciones** todo lo ocurrido, y con **Resumen de ausencia** un resumen.

**¿Cuánto cuesta?**
Depende de los modelos de IA que uses. En **General → Presupuesto y coste** ves el consumo y puedes poner un límite para que no se dispare.

**¿Por qué el proyecto no se marca como "completado"?**
Porque falta cumplir algún **contrato**. Míralos en la pestaña **Contratos**; los pendientes aparecen como `pending`.

**¿Puedo cambiar el flujo de un proyecto?**
Sí: en **General** cambia el **Flujo de trabajo** y guarda. También puedes editar el flujo desde la pestaña **Flujo**.

**Se ha quedado un paso "fallido", ¿qué hago?**
En **Ejecuciones**, pulsa **↻ Reejecutar desde «paso»** para reintentar desde ahí, o **Reanudar** si está en pausa. Revisa **Ver trazas** para entender qué pasó.

**¿Dónde está el código que se genera?**
En la pestaña **Archivos** del proyecto. Los archivos viven en la carpeta de trabajo del proyecto en el servidor.

**¿Cómo borro un proyecto o un flujo?**
En las listas de **Proyectos** o **Flujos de trabajo**, usa el botón **Borrar** correspondiente.

---

## Glosario

- **Agente / Ayudante de IA**: programa automático que hace tareas (programar, revisar, redactar) usando inteligencia artificial.
- **Proveedor**: empresa o servicio que presta la inteligencia artificial (Anthropic, OpenAI, NaN…).
- **Modelo**: la versión concreta del ayudante en un proveedor (por ejemplo, *Claude Sonnet*).
- **API key**: la "llave" secreta para usar un proveedor.
- **Proyecto**: el programa que quieres construir.
- **Flujo de trabajo**: el plano con el orden de las tareas.
- **Tarea (paso / nodo)**: una casilla del flujo que hace un trabajo.
- **Subagente**: ayudante especializado (revisor, documentador, escritor de tests…).
- **Contrato**: criterio de aceptación que debe cumplirse para terminar el proyecto.
- **Objetivo**: la finalidad del proyecto, en tus palabras.
- **Stack**: conjunto de tecnologías con las que se construye el programa.
- **Ejecución (run)**: una "puesta en marcha" del flujo sobre el proyecto.
- **Aprobación (human approval)**: paso que espera tu permiso para continuar.
- **Bucle de revisión**: repetir un paso (o volver atrás) hasta que quede bien.
- **RAG**: búsqueda inteligente dentro de tus documentos para que los ayudantes encuentren la información relevante.
- **Embeddings / Rerank**: modelos que permiten esa búsqueda inteligente.
- **Token**: unidad de uso de la IA; su consumo determina el coste.
- **Presupuesto (límite blando/duro)**: aviso al acercarte y pausa al superar el gasto.
- **Webhook**: dirección a la que se envían avisos automáticos.
- **Traza**: registro detallado de lo que hizo cada paso (tiempo, tokens, coste).
- **OTLP**: formato estándar para llevar las trazas a otras herramientas.
- **Workspace (carpeta de trabajo)**: la carpeta del servidor donde se guardan los archivos del programa.
- **Draft / Completed / Paused / Failed**: estados del proyecto (borrador, completado, en pausa, fallido).
