#!/usr/bin/env bash
# Restore drill: proves a backup can be restored. Restores a dump into a DISPOSABLE database whose
# name must start with `mawid_restore_` (never `mawid`, never `mawid_test`, never anything else),
# compares row counts with the source, then drops ONLY that disposable database.
#
#   DUMP=/var/backups/mawid/mawid-20261127T020000Z.sql.gz \
#   TARGET_DB=mawid_restore_check SOURCE_DB=mawid \
#   MYSQL_DEFAULTS=/etc/mawid/restore.cnf ./mawid-restore-drill.sh
#
# Run on a NON-production database server (or with explicit approval). The restore account needs
# CREATE, DROP, INSERT, ALTER, INDEX, REFERENCES, SELECT on `mawid_restore\_%`.* and SELECT on the
# source database for the row-count comparison — nothing on any other database.
set -Eeuo pipefail

: "${DUMP:?set DUMP (path to a .sql.gz made by mawid-backup.sh)}"
: "${TARGET_DB:?set TARGET_DB (mawid_restore_<suffix>)}"
: "${SOURCE_DB:?set SOURCE_DB (the database the dump came from)}"
: "${MYSQL_DEFAULTS:?set MYSQL_DEFAULTS}"

if [[ ! "$TARGET_DB" =~ ^mawid_restore_[a-z0-9]+$ ]]; then
  echo "Refusing: TARGET_DB must match mawid_restore_<suffix>." >&2
  exit 1
fi
if [[ "$TARGET_DB" == "$SOURCE_DB" ]]; then
  echo "Refusing: target equals source." >&2
  exit 1
fi
(cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
if zcat "$DUMP" | grep -qiE '^[[:space:]]*(/\*![0-9]+[[:space:]]*)?(CREATE[[:space:]]+(DATABASE|SCHEMA)|USE[[:space:]`])'; then
  echo "Refusing: the dump contains CREATE DATABASE / USE and could write into another database." >&2
  exit 1
fi

mysql() { mariadb --defaults-extra-file="$MYSQL_DEFAULTS" "$@"; }
exists=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${TARGET_DB}'")
if [[ "$exists" != "0" ]]; then
  echo "Refusing: ${TARGET_DB} already exists. Drop it deliberately first." >&2
  exit 1
fi

mysql -e "CREATE DATABASE \`${TARGET_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
zcat "$DUMP" | mysql "$TARGET_DB"

# Every count must succeed: a failed query aborts the drill instead of comparing two empty lists.
count_rows() {
  local tables t n
  tables=$(mysql -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$1' ORDER BY table_name")
  [[ -n "$tables" ]] || { echo "FAILED: no tables found in $1." >&2; return 1; }
  while read -r t; do
    n=$(mysql -N -e "SELECT COUNT(*) FROM \`$1\`.\`$t\`") || { echo "FAILED: cannot count $1.$t" >&2; return 1; }
    echo "$t $n"
  done <<< "$tables"
}
source_counts=$(count_rows "$SOURCE_DB")
target_counts=$(count_rows "$TARGET_DB")
echo "Tables restored: $(wc -l <<< "$target_counts") (source: $(wc -l <<< "$source_counts"))"
if [[ "$source_counts" == "$target_counts" ]]; then
  echo "Row counts match (source may have changed since the dump; differences on live data are expected)."
else
  echo "Row counts differ — review (expected if the source changed after the dump):"
  diff <(echo "$source_counts") <(echo "$target_counts") || true
fi
mysql "$TARGET_DB" -N -e "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at" | tail -3

mysql -e "DROP DATABASE \`${TARGET_DB}\`"
echo "Restore drill finished; ${TARGET_DB} dropped."
