# Política de seguridad

## Versiones soportadas

El proyecto está en estado **MVP** y se desarrolla sobre `main`. Solo la última
versión publicada recibe correcciones de seguridad.

## Reportar una vulnerabilidad

**No abras un issue público.** Envía un correo a **hensip@protonmail.com** con:

- Descripción del problema y su impacto.
- Pasos para reproducirlo (versión, configuración y datos relevantes).
- Prueba de concepto si la tienes.
- Cómo prefieres que te acreditemos, si procede.

Acusaremos recibo en un plazo orientativo de 72 horas y acordaremos contigo la
divulgación responsable antes de publicar detalles.

## Modelo de amenazas relevante

- **Secretos en reposo**: las claves de proveedores y las credenciales Git se
  cifran con AES-256-GCM usando `SECRETS_ENCRYPTION_KEY`. No las registres en
  logs ni las devuelvas en respuestas de la API.
- **Aislamiento de ejecución**: cada proyecto puede correr en su propio
  contenedor, sin privilegios y con red cerrada por defecto. No desactives ese
  aislamiento en producción.
- **Permisos de agentes**: el prompt no es un control de seguridad; los
  permisos de cada subagente son los que mandan.
- **Workspaces**: los proyectos se ejecutan sobre bind mounts; evita rutas
  controladas por el usuario fuera de `WORKSPACES_ROOT`.

## Buenas prácticas para despliegues

- Cambia `JWT_SECRET` y `SECRETS_ENCRYPTION_KEY` respecto a los valores de
  ejemplo y no reutilices la clave entre entornos.
- Sirve la aplicación detrás de HTTPS y restringe el acceso a la API.
- Mantén Postgres y Redis en la red privada; solo `web` y `api` deben publicar
  puertos.
- Revisa los permisos del *socket proxy* de Docker y no montes el socket real.
- Rota las claves de proveedores si sospechas que se han filtrado.
