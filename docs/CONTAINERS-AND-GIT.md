# Contenedores y credenciales Git

## Desarrollo siempre en contenedor

Cada proyecto se desarrolla dentro de su propio contenedor aislado:

- **Imagen base**: `docker/Dockerfile.project` (`factoria/project-dev:latest`), ampliable por proyecto con `Project.containerImage`.
- **Sin root**: el agente corre como usuario `dev` (aislamiento kernel-enforced).
- **Límites**: CPU/mem y `no-new-privileges` + `CapDrop: ALL`.
- **Workspace**: se monta el volumen del proyecto en `/workspace`.
- **Red**: `closed` por defecto (red `factoria-projects`, sin egreso); `allowlist`/`open` usan `factoria-agentes_internal`. Configurable por proyecto.

### Ciclo de vida

- Gestionado por `packages/core/src/docker.ts` a través de un **Docker Socket Proxy** restringido (`tecnativa/docker-socket-proxy`); nunca se monta el socket directo en `api`/`worker`.
- API: `POST /projects/:id/container/{up,down,rebuild}`, `GET .../status|logs`.
- **Auto-arranque**: al lanzar una ejecución, el worker arranca el contenedor si no está `running`.
- UI: pestaña **Entorno** de la ficha del proyecto (estado, arrancar/parar/reconstruir, logs).

## Credenciales Git (token HTTPS)

- `projects.repoProvider` (`github`|`gitlab`|`other`), `repoUrl`, `repoBranch` y `repoTokenEncrypted` (**AES-256-GCM**, `encryptSecret`).
- El API **nunca** devuelve el token; expone `hasRepoToken`.
- Inyección efímera en clone/fetch/push (`cloneWithAuth`/`pushWithAuth`): el token viaja en `http.extraHeader` y **no** queda en la URL del remoto, en `docker inspect` ni en logs.
- Comprobación de acceso: `POST /projects/:id/repo/test` (`git ls-remote`).

## Variables de entorno

```
DOCKER_PROXY_URL=http://docker-socket-proxy:2375
PROJECT_CONTAINER_IMAGE=factoria/project-dev:latest
PROJECT_NETWORK_CLOSED=factoria-projects
PROJECT_NETWORK_OPEN=factoria-agentes_internal
```
