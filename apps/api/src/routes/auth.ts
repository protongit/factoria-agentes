import { db, users } from "@factoria/db";
import { loginSchema, registerSchema } from "@factoria/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { hashPassword, verifyPassword } from "../lib/crypto.ts";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    }
    const { email, password, name } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: "El email ya está registrado" });
    }

    const [user] = await db
      .insert(users)
      .values({ email, name, passwordHash: hashPassword(password), role: "member" })
      .returning();

    if (!user) return reply.code(500).send({ error: "No se pudo crear el usuario" });

    const token = app.jwt.sign({ sub: user.id, role: user.role });
    reply.setCookie("token", token, { httpOnly: true, sameSite: "lax", path: "/" });
    return reply.code(201).send({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const token = app.jwt.sign({ sub: user.id, role: user.role });
    reply.setCookie("token", token, { httpOnly: true, sameSite: "lax", path: "/" });
    return reply.send({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("token", { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const [user] = await db.select().from(users).where(eq(users.id, request.user.sub)).limit(1);
    if (!user) return reply.code(404).send({ error: "Usuario no encontrado" });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  });
}
