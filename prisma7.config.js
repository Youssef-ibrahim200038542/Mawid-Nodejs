require("dotenv/config");
const { defineConfig } = require("prisma/config");
const { assertMawidDatabase, assertProductionWriteAllowed } = require("./src/config/db-guard");

// Refuse to run any Prisma CLI command (migrate, db, studio…) against a non-Mawid database, and
// refuse when DB_NAME (the app's database) and DATABASE_URL (the CLI's database) disagree — the CLI
// must never silently act on a different database than the app in the same environment.
assertMawidDatabase({ databaseUrl: process.env.DATABASE_URL, ...(process.env.DB_NAME ? { dbName: process.env.DB_NAME } : {}) });
// Refuse schema/data-writing commands against production `mawid` until the rollout is approved.
assertProductionWriteAllowed({ databaseUrl: process.env.DATABASE_URL });

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL
  },
});
