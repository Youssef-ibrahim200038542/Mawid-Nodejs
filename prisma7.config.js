require("dotenv/config");
const { defineConfig } = require("prisma/config");
const { assertMawidDatabase } = require("./src/config/db-guard");

// Refuse to run any Prisma CLI command (migrate, db, studio…) against a non-Mawid database.
assertMawidDatabase({ databaseUrl: process.env.DATABASE_URL });

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL
  },
});
