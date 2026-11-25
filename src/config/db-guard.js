// The local MariaDB server is shared with other projects (e.g. DriveX on `car_rental`).
// Mawid must only ever connect to, migrate or query its own databases: `mawid` or `mawid_<suffix>`.
// When MAWID_EXPECT_DB is set (the integration-test harness sets it to `mawid_test`), the
// configured database must be exactly that name — so tests can never fall back to `mawid`.
const allowedDatabaseName = /^mawid(_[a-z0-9]+)?$/;

function databaseNameFromUrl(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    } catch {
        return null;
    }
}

function assertMawidDatabase({ dbName, databaseUrl, expected = process.env.MAWID_EXPECT_DB }) {
    const names = [];
    if (dbName !== undefined) names.push(["DB_NAME", dbName]);
    if (databaseUrl !== undefined) names.push(["DATABASE_URL", databaseNameFromUrl(databaseUrl)]);

    for (const [source, name] of names) {
        if (!name || !allowedDatabaseName.test(name)) {
            throw new Error(
                `${source} points at database "${name}". Mawid may only use "mawid" or "mawid_<suffix>" databases; refusing to continue.`
            );
        }
        if (expected && name !== expected) {
            throw new Error(`${source} points at "${name}" but this run is pinned to "${expected}"; refusing to continue.`);
        }
    }

    if (names.length === 2 && names[0][1] !== names[1][1]) {
        throw new Error(`DB_NAME ("${names[0][1]}") and DATABASE_URL ("${names[1][1]}") point at different databases.`);
    }
}

// Prisma CLI commands that can write to a database's schema or data.
const writingCommands = [
    ["migrate", "deploy"],
    ["migrate", "dev"],
    ["migrate", "reset"],
    ["migrate", "resolve"],
    ["db", "push"],
    ["db", "execute"],
    ["db", "seed"],
];

// The production `mawid` database is frozen until the full rollout review: any writing Prisma
// command against it is refused unless MAWID_ALLOW_PROD_MIGRATE=1 is set explicitly for that run.
// Read-only commands (generate, validate, migrate status, migrate diff) stay allowed.
function assertProductionWriteAllowed({ argv = process.argv, databaseUrl, allow = process.env.MAWID_ALLOW_PROD_MIGRATE }) {
    if (databaseNameFromUrl(databaseUrl) !== "mawid") return;
    const args = argv.slice(2).filter((arg) => !arg.startsWith("-"));
    const isWriting = writingCommands.some(([group, action]) => {
        const index = args.indexOf(group);
        return index !== -1 && args[index + 1] === action;
    });
    if (isWriting && allow !== "1") {
        throw new Error(
            `Refusing "prisma ${args.join(" ")}" against the production "mawid" database: migrations are held until the rollout review. ` +
                `Use mawid_test (npm run test:db:migrate), or set MAWID_ALLOW_PROD_MIGRATE=1 for an approved rollout.`
        );
    }
}

module.exports = { assertMawidDatabase, assertProductionWriteAllowed, databaseNameFromUrl, writingCommands };
