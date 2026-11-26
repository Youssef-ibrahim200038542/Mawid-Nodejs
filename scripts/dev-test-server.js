// Runs the API against the mawid_test database for frontend development and manual testing,
// while the production `mawid` database stays frozen (rollout held — see
// docs/architecture/05-migration-review.md). Uses the same pinning as the integration tests:
// .env.test only, DB_NAME/DATABASE_URL must be mawid_test, MAWID_EXPECT_DB enforced by db-guard.
// Note: `npm run test:integration` empties mawid_test, so data created here is temporary.
process.env.PORT = process.env.PORT || "3100";
require("../tests/integration/env");
process.env.LOG_LEVEL = process.env.MAWID_LOG_LEVEL || "info";
require("../src/index");
