// Operates on the mawid_test database only.
// Usage:
//   node scripts/test-db.js          migrate deploy + status
//   node scripts/test-db.js diff     print SQL that would bring mawid_test up to prisma/schema.prisma
// Order of checks: .env.test pinned to mawid_test (env.js) → live connection reports
// DATABASE() = mawid_test → Prisma CLI with MAWID_EXPECT_DB set, so prisma7.config.js also
// refuses any other database. Only `migrate deploy` is used (never reset).
const { TEST_DATABASE } = require("../tests/integration/env");
const { spawnSync } = require("node:child_process");
const prisma = require("../src/config/database");

const commands = {
    migrate: [["migrate", "deploy"], ["migrate", "status"]],
    diff: [["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"]],
};

function runPrisma(args) {
    // args are fixed literals from this file, never user input.
    const result = spawnSync(`npx prisma ${args.join(" ")}`, { stdio: "inherit", env: process.env, shell: true });
    if (result.status !== 0) {
        throw new Error(`prisma ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

(async () => {
    const mode = process.argv[2] || "migrate";
    if (!commands[mode]) throw new Error(`Unknown mode "${mode}". Use: migrate | diff`);

    const [{ db }] = await prisma.$queryRaw`SELECT DATABASE() AS db`;
    await prisma.$disconnect();
    if (db !== TEST_DATABASE) {
        throw new Error(`Connected to "${db}", expected "${TEST_DATABASE}". Not running ${mode}.`);
    }
    console.error(`Verified connection to "${db}". Running ${mode}…`);

    for (const args of commands[mode]) runPrisma(args);
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
