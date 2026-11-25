require("dotenv/config");
const { defineConfig } = require("prisma/config");
const { assertMawidDatabase, assertProductionWriteAllowed } = require("./src/config/db-guard");

// Refuse to run any Prisma CLI command (migrate, db, studio…) against a non-Mawid database.
assertMawidDatabase({ databaseUrl: process.env.DATABASE_URL });
// Refuse schema/data-writing commands against production `mawid` until the rollout is approved.
assertProductionWriteAllowed({ databaseUrl: process.env.DATABASE_URL });

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL
  },
});
