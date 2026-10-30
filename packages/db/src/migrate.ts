import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.ts";

async function main() {
  console.log("Aplicando migraciones...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migraciones aplicadas.");
  await pool.end();
}

main().catch((error) => {
  console.error("Error aplicando migraciones:", error);
  process.exit(1);
});
