// Least-privilege checks for the database account the RUNNING app uses (H2).
//
// Two accounts, two sets of variables:
//   runtime   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME   → src/config/database.js
//             needs only SELECT, INSERT, UPDATE, DELETE on `<DB_NAME>`.*
//   migrator  DATABASE_URL                                         → Prisma CLI (prisma7.config.js)
//             adds CREATE, ALTER, INDEX, REFERENCES on the same database only (no DROP —
//             no committed migration drops anything).
// In production the app process must not hold the migrator credentials at all, must not run as
// root, and its grants are read back with SHOW GRANTS at startup: anything beyond the four data
// privileges on its own database refuses to start (a compromise of the app then cannot reach
// another project's database on the same server, e.g. DriveX's `car_rental`).
const RUNTIME_PRIVILEGES = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
// The migration job: exactly what the committed migrations need (see deploy/database/create-accounts.sql).
const MIGRATOR_PRIVILEGES = new Set([...RUNTIME_PRIVILEGES, "CREATE", "ALTER", "INDEX", "REFERENCES"]);
const ADMIN_USERS = new Set(["root", "admin", "mysql", "mariadb.sys", "debian-sys-maint"]);

function assertRuntimeCredentials(env = process.env) {
    if (env.NODE_ENV !== "production") return;
    const user = (env.DB_USER || "").trim();
    if (!user || ADMIN_USERS.has(user.toLowerCase())) {
        throw new Error(`DB_USER "${user || "(unset)"}" cannot be used in production. Use the dedicated least-privilege Mawid application account.`);
    }
    if ((env.DB_PASSWORD || "").length < 16) {
        throw new Error("DB_PASSWORD must be set (at least 16 characters) in production.");
    }
    if (env.DATABASE_URL) {
        throw new Error("DATABASE_URL (migration credentials) must not be set in the production app process. Provide it only to the migration job.");
    }
}

// Parses SHOW GRANTS output. Returns the list of problems (empty = exactly the expected privileges).
// Fails closed: unknown grant forms (roles, pattern/wildcard databases, column grants, PROXY) are
// problems. `allowed` is both the ceiling and the requirement: every listed privilege must be granted
// at database level on `dbName`, and nothing else anywhere.
function grantProblems(grantLines, dbName, allowed = RUNTIME_PRIVILEGES) {
    const problems = [];
    const grantedOnDb = new Set();
    for (const line of grantLines) {
        const match = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s/i.exec(line);
        if (!match) {
            if (/^GRANT\s+/i.test(line) && !/^GRANT\s+PROXY/i.test(line)) problems.push(`unrecognised grant: ${line.replace(/IDENTIFIED BY.*$/i, "")}`);
            continue;
        }
        const privileges = match[1].split(",").map((p) => p.trim().toUpperCase());
        if (privileges[0] === "PROXY") {
            problems.push("PROXY grant");
            continue;
        }
        const target = match[2].replace(/`/g, "");
        if (target === "*.*") {
            if (!(privileges.length === 1 && privileges[0] === "USAGE")) problems.push(`global privileges: ${privileges.join(", ")}`);
            continue;
        }
        const [schema, object] = target.split(".");
        if (schema !== dbName) {
            problems.push(`privileges on another database: ${schema}`);
            continue;
        }
        const extra = privileges.filter((p) => !allowed.has(p));
        if (extra.length) problems.push(`more than the allowed privileges on ${schema}: ${extra.join(", ")}`);
        if (/WITH GRANT OPTION/i.test(line)) problems.push(`GRANT OPTION on ${schema}`);
        if (object === "*") for (const p of privileges) grantedOnDb.add(p);
    }
    const missing = [...allowed].filter((p) => !grantedOnDb.has(p));
    if (missing.length) problems.push(`missing required privileges on ${dbName}: ${missing.join(", ")}`);
    return problems;
}

async function readGrants(db) {
    const rows = await db.$queryRawUnsafe("SHOW GRANTS FOR CURRENT_USER()");
    return rows.map((row) => String(Object.values(row)[0]));
}

// Production: throws on any problem. Elsewhere: returns the problems so the caller can warn.
async function verifyRuntimeGrants(db, { dbName = process.env.DB_NAME, production = process.env.NODE_ENV === "production" } = {}) {
    const problems = grantProblems(await readGrants(db), dbName);
    if (problems.length && production) {
        throw new Error(`The database account is not least-privilege: ${problems.join("; ")}. Refusing to start.`);
    }
    return problems;
}

module.exports = { assertRuntimeCredentials, grantProblems, readGrants, verifyRuntimeGrants, RUNTIME_PRIVILEGES, MIGRATOR_PRIVILEGES };
