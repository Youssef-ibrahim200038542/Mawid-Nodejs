// Applies migrations to the mawid_test database only.
// Usage: node scripts/test-db.js        (migrate deploy + status)
// Order of checks: .env.test pinned to mawid_test (env.js) → live connection reports
// DATABASE() = mawid_test → `prisma migrate deploy` (never reset) with MAWID_EXPECT_DB set,
// so prisma7.config.js also refuses any other database.
const { TEST_DATABASE } = require("../tests/integration/env");
const { spawnSync } = require("node:child_process");
const prisma = require("../src/config/database");

function runPrisma(args) {
    // args are fixed literals from this file, never user input.
    const result = spawnSync(`npx prisma ${args.join(" ")}`, { stdio: "inherit", env: process.env, shell: true });
    if (result.status !== 0) {
        throw new Error(`prisma ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

(async () => {
    const [{ db }] = await prisma.$queryRaw`SELECT DATABASE() AS db`;
    await prisma.$disconnect();
    if (db !== TEST_DATABASE) {
        throw new Error(`Connected to "${db}", expected "${TEST_DATABASE}". Not migrating.`);
    }
    console.log(`Verified connection to "${db}". Applying migrations with migrate deploy…`);

    runPrisma(["migrate", "deploy"]);
    runPrisma(["migrate", "status"]);
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
