const { TEST_DATABASE, prisma, assertConnectedToTestDatabase } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertMawidDatabase } = require("../../src/config/db-guard");

test.after(() => prisma.$disconnect());

test("the live connection is the pinned test database", async () => {
    assert.ok(["mawid_test", "mawid_test_it"].includes(TEST_DATABASE));
    assert.equal(await assertConnectedToTestDatabase(), TEST_DATABASE);
    assert.equal(process.env.DB_NAME, TEST_DATABASE);
    assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${TEST_DATABASE}`);
});

test("this run is pinned: the guard rejects the production mawid database", () => {
    assert.equal(process.env.MAWID_EXPECT_DB, TEST_DATABASE);
    assert.throws(() => assertMawidDatabase({ dbName: "mawid" }), new RegExp(`pinned to "${TEST_DATABASE}"`));
    assert.throws(() => assertMawidDatabase({ databaseUrl: "mysql://root@127.0.0.1:3306/mawid" }), /pinned/);
    assert.throws(() => assertMawidDatabase({ dbName: "car_rental" }), /refusing/);
});

test("strict mode and UTC are session-scoped on Mawid's connection", async () => {
    const [row] = await prisma.$queryRaw`SELECT @@SESSION.sql_mode AS mode, @@SESSION.time_zone AS tz`;
    assert.match(row.mode, /STRICT_TRANS_TABLES/);
    assert.equal(row.tz, "+00:00");
});

test("strict mode rejects oversized values instead of truncating them", async () => {
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO clinics (slug, name, city, updated_at) VALUES ('strict-check', 'Strict', ${"x".repeat(101)}, NOW(3))`,
        /too long|Data too long|1406/i
    );
    assert.equal(await prisma.clinic.count({ where: { slug: "strict-check" } }), 0);
});
