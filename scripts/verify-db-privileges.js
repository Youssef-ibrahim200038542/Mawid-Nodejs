// READ-ONLY check that the app's database account is least-privilege (H2).
//
// Usage:
//   node scripts/verify-db-privileges.js --env .env.production --db mawid
//
// Connects with the RUNTIME credentials of that env file (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME),
// verifies the live database name, then only reads:
//   - SHOW GRANTS FOR CURRENT_USER()     → no global rights, only SELECT/INSERT/UPDATE/DELETE on --db
//   - information_schema.SCHEMATA        → the account can see no database other than --db
// It never queries any other database's tables and never writes. Exit code 0 = PASS, 1 = FAIL.
// Credentials are never printed.
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const mariadb = require("mariadb");
const { assertMawidDatabase } = require("../src/config/db-guard");
const { grantProblems } = require("../src/config/db-privileges");

function argValue(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : process.argv[index + 1] || null;
}

(async () => {
    const envArg = argValue("--env");
    const db = argValue("--db");
    if (!envArg || !db) throw new Error("Usage: node scripts/verify-db-privileges.js --env <env file> --db <database>");
    const envFile = path.resolve(process.cwd(), envArg);
    if (!fs.existsSync(envFile)) throw new Error(`Env file not found: ${envArg}`);
    const env = dotenv.parse(fs.readFileSync(envFile));
    assertMawidDatabase({ dbName: env.DB_NAME, expected: db });

    const connection = await mariadb.createConnection({
        host: env.DB_HOST,
        port: Number(env.DB_PORT),
        user: env.DB_USER,
        password: env.DB_PASSWORD ?? "",
        database: env.DB_NAME,
    });
    try {
        const [{ current, account }] = await connection.query("SELECT DATABASE() AS current, CURRENT_USER() AS account");
        if (current !== db) throw new Error(`Connected to "${current}", expected "${db}". Refusing to continue.`);
        const grants = (await connection.query("SHOW GRANTS FOR CURRENT_USER()")).map((row) => String(Object.values(row)[0]));
        const visible = (await connection.query("SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA")).map((row) => row.name);

        const problems = grantProblems(grants, db);
        const otherSchemas = visible.filter((name) => name !== db && name !== "information_schema");
        if (otherSchemas.length) problems.push(`can see other databases: ${otherSchemas.join(", ")}`);

        console.log(`Account ${String(account).replace(/@.*/, "@…")} on database "${current}"`);
        console.log(`Grants: ${grants.length} line(s); visible databases: ${visible.join(", ")}`);
        if (problems.length) {
            console.log("FAIL — not least-privilege:");
            for (const problem of problems) console.log(`  - ${problem}`);
            process.exitCode = 1;
        } else {
            console.log("PASS — data privileges on this database only; no other database is visible.");
        }
    } finally {
        await connection.end();
    }
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
