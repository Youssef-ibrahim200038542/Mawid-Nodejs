// READ-ONLY report of every clinic membership and its trust evidence, for the mandatory
// production-rollout review (docs/architecture/07-account-security.md, "Legacy memberships").
//
// Usage:
//   node scripts/review-memberships.js --env .env.test --db mawid_test [--show-emails]
//
// Safety:
//   - The target is explicit: --env names the env file and --db must equal the database it points
//     at; the shared db-guard refuses anything that isn't `mawid` / `mawid_<suffix>`.
//   - The live connection must report DATABASE() = --db before any query.
//   - Everything runs inside START TRANSACTION READ ONLY on a dedicated connection and ends with
//     ROLLBACK, so the server itself rejects any write. Only SELECT statements are issued.
//   - Credentials are never printed. Emails are masked unless --show-emails is passed.
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const mariadb = require("mariadb");
const { assertMawidDatabase, databaseNameFromUrl } = require("../src/config/db-guard");

function argValue(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : process.argv[index + 1] || null;
}

function mask(email) {
    const [local, domain] = String(email).split("@");
    return domain ? `${local.slice(0, 1)}***@${domain}` : "***";
}

(async () => {
    const envArg = argValue("--env");
    const db = argValue("--db");
    const showEmails = process.argv.includes("--show-emails");
    if (!envArg || !db) throw new Error("Usage: node scripts/review-memberships.js --env <env file> --db <database> [--show-emails]");

    const envFile = path.resolve(process.cwd(), envArg);
    if (!fs.existsSync(envFile)) throw new Error(`Env file not found: ${envArg}`);
    const env = dotenv.parse(fs.readFileSync(envFile));
    assertMawidDatabase({ dbName: env.DB_NAME, databaseUrl: env.DATABASE_URL, expected: db });
    if (env.DB_NAME !== db || databaseNameFromUrl(env.DATABASE_URL) !== db) {
        throw new Error(`${envArg} does not point at "${db}". Refusing to continue.`);
    }

    const connection = await mariadb.createConnection({
        host: env.DB_HOST,
        port: Number(env.DB_PORT),
        user: env.DB_USER,
        password: env.DB_PASSWORD ?? "",
        database: env.DB_NAME,
    });
    try {
        const [{ current }] = await connection.query("SELECT DATABASE() AS current");
        if (current !== db) throw new Error(`Connected to "${current}", expected "${db}". Refusing to continue.`);
        await connection.query("START TRANSACTION READ ONLY");

        const members = await connection.query(`
            SELECT m.id AS memberId, m.clinic_id AS clinicId, c.slug AS clinicSlug, c.status AS clinicStatus,
                   m.user_id AS userId, u.email, u.email_verified_at AS emailVerifiedAt,
                   m.role, m.status, m.trust_state AS trustState, m.trust_source AS trustSource,
                   m.trusted_at AS trustedAt, m.created_at AS createdAt
            FROM clinic_members m
            JOIN clinics c ON c.id = m.clinic_id
            JOIN users u ON u.id = m.user_id
            ORDER BY m.clinic_id, m.id`);
        const evidence = await connection.query(`
            SELECT clinic_id AS clinicId, action, actor_user_id AS actorUserId, target_id AS targetId,
                   JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.userId')) AS metaUserId, created_at AS createdAt
            FROM audit_logs
            WHERE action IN ('member.added', 'clinic.created')
            ORDER BY id`);
        await connection.query("ROLLBACK");

        const rows = members.map((m) => {
            const proof = evidence.find((e) =>
                e.clinicId === m.clinicId &&
                ((e.action === "member.added" && e.targetId === String(m.memberId)) ||
                    (e.action === "clinic.created" && e.actorUserId === m.userId))
            );
            return {
                clinic: `${m.clinicSlug} (#${m.clinicId}${m.clinicStatus === "ACTIVE" ? "" : `, ${m.clinicStatus}`})`,
                memberId: m.memberId,
                userId: m.userId,
                email: showEmails ? m.email : mask(m.email),
                role: m.role,
                status: m.status,
                createdAt: new Date(m.createdAt).toISOString(),
                emailVerified: m.emailVerifiedAt ? "yes" : "no",
                trust: m.trustState + (m.trustSource ? ` / ${m.trustSource}` : ""),
                evidence: proof
                    ? proof.action === "clinic.created"
                        ? `created the clinic (${new Date(proof.createdAt).toISOString()})`
                        : `added by user #${proof.actorUserId ?? "?"} (${new Date(proof.createdAt).toISOString()})`
                    : "none recorded",
            };
        });
        console.log(`Database "${current}" — ${rows.length} membership(s). Read-only report; nothing was changed.`);
        console.table(rows);
        const legacy = rows.filter((r) => r.trust.startsWith("LEGACY_UNREVIEWED")).length;
        console.log(`${legacy} membership(s) are LEGACY_UNREVIEWED and need review / re-confirmation before production.`);
    } finally {
        await connection.end();
    }
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
