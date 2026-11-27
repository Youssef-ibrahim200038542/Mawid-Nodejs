// Loaded FIRST by every integration test file and by scripts/test-db.js, before anything
// requires src/config/database. It pins the whole process to ONE Mawid test database:
//   default            .env.test     → mawid_test
//   MAWID_IT=1         .env.test-it  → mawid_test_it  (dedicated, disposable integration database;
//                                       must be created and approved by the owner first)
//   1. The env file must exist — there is no fallback to .env.
//   2. Its values override anything already in the environment.
//   3. DB_NAME and DATABASE_URL must both name the expected database exactly.
//   4. MAWID_EXPECT_DB makes the app's own db-guard (and prisma7.config.js) refuse any other name.
// src/config/database.js later calls dotenv.config() for .env, but dotenv never overrides
// variables that are already set, so the test values below always win.
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { databaseNameFromUrl } = require("../../src/config/db-guard");

const dedicated = process.env.MAWID_IT === "1";
const TEST_DATABASE = dedicated ? "mawid_test_it" : "mawid_test";
const envFile = path.join(__dirname, "..", "..", dedicated ? ".env.test-it" : ".env.test");

if (!fs.existsSync(envFile)) {
    throw new Error(`Missing ${envFile}. Integration tests never fall back to .env; copy .env.test.example to it.`);
}

const parsed = dotenv.parse(fs.readFileSync(envFile));
for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME", "DATABASE_URL", "SESSION_SECRET"]) {
    if (!parsed[key]) {
        throw new Error(`${path.basename(envFile)} must define ${key} itself; refusing to inherit it from another environment.`);
    }
}
if (parsed.DB_NAME !== TEST_DATABASE || databaseNameFromUrl(parsed.DATABASE_URL) !== TEST_DATABASE) {
    throw new Error(`${path.basename(envFile)} must point DB_NAME and DATABASE_URL at "${TEST_DATABASE}"; refusing to run.`);
}

Object.assign(process.env, parsed, { MAWID_EXPECT_DB: TEST_DATABASE });

module.exports = { TEST_DATABASE };
