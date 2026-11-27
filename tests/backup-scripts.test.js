// Safety checks of deploy/backup/*.sh. Every case is refused BEFORE any database client is started
// (the scripts validate names, checksums and dump contents first), so no database is contacted.
// Requires bash, gzip/zcat and sha256sum (Linux, macOS, Git Bash); skipped otherwise.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const drill = path.join(root, "deploy", "backup", "mawid-restore-drill.sh");
const backup = path.join(root, "deploy", "backup", "mawid-backup.sh");
const hasBash = spawnSync("bash", ["-c", "command -v gzip && command -v zcat && command -v sha256sum"], { encoding: "utf8" }).status === 0;
const skip = hasBash ? false : "bash / gzip / sha256sum not available";

function run(script, env) {
    const result = spawnSync("bash", [script], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, ...env, MYSQL_DEFAULTS: "/nonexistent/defaults.cnf" },
        timeout: 20_000,
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function makeDump(dir, name, sql, { badChecksum = false } = {}) {
    const raw = path.join(dir, `${name}.sql`);
    fs.writeFileSync(raw, sql);
    const gz = `${raw}.gz`;
    spawnSync("bash", ["-c", `gzip -c "${raw.replace(/\\/g, "/")}" > "${gz.replace(/\\/g, "/")}"`]);
    const sum = spawnSync("bash", ["-c", `cd "${dir.replace(/\\/g, "/")}" && sha256sum "${path.basename(gz)}"`], { encoding: "utf8" }).stdout;
    fs.writeFileSync(`${gz}.sha256`, badChecksum ? sum.replace(/^[0-9a-f]/, (c) => (c === "0" ? "1" : "0")) : sum);
    return gz.replace(/\\/g, "/");
}

test("restore drill only restores into mawid_restore_* — never mawid, mawid_test, mawid_test_it or car_rental", { skip }, () => {
    for (const target of ["mawid", "mawid_test", "mawid_test_it", "car_rental", "mawid_restore", "mawid_restore_X", "mawid_restore_a;drop", "restore_mawid"]) {
        const { status, out } = run(drill, { DUMP: "/tmp/none.sql.gz", TARGET_DB: target, SOURCE_DB: "mawid" });
        assert.equal(status, 1, target);
        assert.match(out, /Refusing: TARGET_DB must match mawid_restore_<suffix>/, target);
    }
});

test("restore drill refuses dumps that could write elsewhere, and tampered dumps", { skip }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mawid-dump-"));
    try {
        const env = { TARGET_DB: "mawid_restore_check", SOURCE_DB: "mawid" };
        for (const sql of [
            "CREATE DATABASE `mawid`;\nCREATE TABLE t (id INT);\n",
            "USE `mawid`;\nINSERT INTO users VALUES (1);\n",
            "use `car_rental`;\n",
            "USE mawid;\n",
            "  CREATE SCHEMA mawid;\n",
            "/*!32312 USE `mawid`*/;\n",
            "/*!40000 CREATE DATABASE IF NOT EXISTS `x` */;\n",
        ]) {
            const dump = makeDump(dir, `evil${sql.length}`, sql);
            const { status, out } = run(drill, { ...env, DUMP: dump });
            assert.equal(status, 1);
            assert.match(out, /contains CREATE DATABASE \/ USE/);
        }
        const tampered = makeDump(dir, "tampered", "CREATE TABLE t (id INT);\n", { badChecksum: true });
        const result = run(drill, { ...env, DUMP: tampered });
        assert.notEqual(result.status, 0, "checksum mismatch stops the drill");
        assert.match(result.out, /FAILED|did NOT match/i);

        const same = run(drill, { DUMP: tampered, TARGET_DB: "mawid_restore_x", SOURCE_DB: "mawid_restore_x" });
        assert.equal(same.status, 1);
        assert.match(same.out, /target equals source/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("backup refuses non-Mawid database names before dumping anything", { skip }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mawid-bk-"));
    try {
        for (const name of ["car_rental", "mysql", "mawidx", "mawid-test", "Mawid"]) {
            const { status, out } = run(backup, { MAWID_DB: name, BACKUP_DIR: dir.replace(/\\/g, "/") });
            assert.equal(status, 1, name);
            assert.match(out, /is not a Mawid database name/, name);
        }
        assert.deepEqual(fs.readdirSync(dir), [], "nothing written");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("backup script dumps one database without CREATE DATABASE / USE and verifies the result", () => {
    const text = fs.readFileSync(backup, "utf8");
    assert.doesNotMatch(text.replace(/^#.*$/gm, ""), /--databases|--all-databases|-A\b/, "single database, no CREATE DATABASE/USE");
    assert.match(text, /--single-transaction/);
    assert.match(text, /gzip -t/);
    assert.match(text, /sha256sum/);
    assert.match(text, /umask 077/, "backup files are private");
    assert.match(text, /--defaults-extra-file/, "password never on the command line");
    assert.ok(text.includes("(CREATE[[:space:]]+(DATABASE|SCHEMA)|USE[[:space:]`])"), "post-dump check for CREATE DATABASE/SCHEMA and USE");
});
