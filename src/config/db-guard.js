// The local MariaDB server is shared with other projects (e.g. DriveX on `car_rental`).
// Mawid must only ever connect to, migrate or query its own databases: `mawid` or `mawid_<suffix>`.
const allowedDatabaseName = /^mawid(_[a-z0-9]+)?$/;

function databaseNameFromUrl(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    } catch {
        return null;
    }
}

function assertMawidDatabase({ dbName, databaseUrl }) {
    const names = [];
    if (dbName !== undefined) names.push(["DB_NAME", dbName]);
    if (databaseUrl !== undefined) names.push(["DATABASE_URL", databaseNameFromUrl(databaseUrl)]);

    for (const [source, name] of names) {
        if (!name || !allowedDatabaseName.test(name)) {
            throw new Error(
                `${source} points at database "${name}". Mawid may only use "mawid" or "mawid_<suffix>" databases; refusing to continue.`
            );
        }
    }

    if (names.length === 2 && names[0][1] !== names[1][1]) {
        throw new Error(`DB_NAME ("${names[0][1]}") and DATABASE_URL ("${names[1][1]}") point at different databases.`);
    }
}

module.exports = { assertMawidDatabase, databaseNameFromUrl };
