import { buildServer } from "./server.ts";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

const app = await buildServer();

app
  .listen({ port, host })
  .then((address) => {
    app.log.info(`API escuchando en ${address}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
