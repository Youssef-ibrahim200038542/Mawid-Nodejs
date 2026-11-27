#!/usr/bin/env bash
# Nightly logical backup of ONE Mawid database (Linux production host). Read-only for the database.
#
#   MAWID_DB=mawid BACKUP_DIR=/var/backups/mawid RETENTION_DAYS=14 \
#   MYSQL_DEFAULTS=/etc/mawid/backup.cnf ./mawid-backup.sh
#
# MYSQL_DEFAULTS is a 0600 option file ([client] host/user/password) for a backup account with
# SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT on the Mawid database only — the password never
# appears on the command line or in the process list.
# The dump is consistent without locking writers (--single-transaction, InnoDB), compressed and
# check-summed. Restore is verified separately (docs/operations/deployment.md, "Restore drill").
set -euo pipefail

: "${MAWID_DB:?set MAWID_DB (mawid or mawid_<suffix>)}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${MYSQL_DEFAULTS:?set MYSQL_DEFAULTS (option file with the backup credentials)}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ ! "$MAWID_DB" =~ ^mawid(_[a-z0-9]+)?$ ]]; then
  echo "Refusing: '$MAWID_DB' is not a Mawid database name." >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/${MAWID_DB}-${stamp}.sql.gz"

mariadb-dump --defaults-extra-file="$MYSQL_DEFAULTS" \
  --single-transaction --quick --routines --triggers --events --hex-blob \
  --databases "$MAWID_DB" | gzip -9 > "$file.partial"
mv "$file.partial" "$file"
sha256sum "$file" > "$file.sha256"
gzip -t "$file"

# Retention: delete only this database's own dumps older than RETENTION_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${MAWID_DB}-*.sql.gz*" -mtime +"$RETENTION_DAYS" -delete

echo "Backup written: $file"
