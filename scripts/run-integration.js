// `npm run test:integration`: runs the integration suites against the dedicated, disposable
// `mawid_test_it` database ONLY (MAWID_IT=1 → tests/integration/env.js pins .env.test-it and
// MAWID_EXPECT_DB=mawid_test_it; tests/integration/helpers.js refuses to empty any other database).
//   1. migrate mawid_test_it (guarded `prisma migrate deploy`, never reset)
//   2. node --test tests/integration/*.test.js (one file at a time)
// First-time setup: node scripts/setup-integration-db.js
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const env = { ...process.env, MAWID_IT: "1" };

function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["scripts/test-db.js"]);
run([
    "--test",
    "--test-concurrency=1",
    "--test-timeout=60000",
    "--require",
    "./tests/integration/env.js",
    "tests/integration/*.test.js",
]);
