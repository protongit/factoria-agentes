import type { UserRole } from "@factoria/shared";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "./routes/index.ts";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: import("fastify").FastifyRequest) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: UserRole };
    user: { sub: string; role: UserRole };
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
    cookie: { cookieName: "token", signed: false },
  });

  app.decorate("authenticate", async (request) => {
    await request.jwtVerify();
  });

  await app.register(registerRoutes, { prefix: "/api" });

  return app;
}
