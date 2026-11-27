// Loaded with --require by `npm test` (unit tests). Unit tests must never reach a real database:
// point every DB setting at a closed local port and a database name that does not exist, so a test
// that accidentally queries fails fast instead of touching `mawid` or `mawid_test`.
// src/config/database.js calls dotenv.config(), which never overrides variables already set here.
const crypto = require("node:crypto");

Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: process.env.UNIT_LOG_LEVEL || "silent",
    DB_HOST: "127.0.0.1",
    DB_PORT: "1",
    DB_USER: "unit",
    DB_PASSWORD: "",
    DB_NAME: "mawid_unit",
    DATABASE_URL: "mysql://unit@127.0.0.1:1/mawid_unit",
    EMAIL_PROVIDER: "none",
    DB_ACQUIRE_TIMEOUT_MS: "300",
    SESSION_SECRET: crypto.randomBytes(32).toString("base64url"),
});
