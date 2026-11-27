#!/usr/bin/env bash
# Nightly logical backup of ONE Mawid database (Linux production host). Read-only for the database.
#
#   MAWID_DB=mawid BACKUP_DIR=/var/backups/mawid RETENTION_DAYS=14 \
#   MYSQL_DEFAULTS=/etc/mawid/backup.cnf ./mawid-backup.sh
#
# MYSQL_DEFAULTS is a 0600 option file ([client] host/user/password) for a backup account with
# SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT on the Mawid database only — the password never
# appears on the command line or in the process list.
#
# The dump is consistent without blocking writers (--single-transaction, InnoDB) and is written
# WITHOUT `CREATE DATABASE` / `USE` statements (no --databases), so restoring it can only ever go
# into the database named on the restore command — never back into `mawid` by accident.
# Output: <db>-<UTC timestamp>.sql.gz + .sha256; failures exit non-zero and are logged to syslog.
set -Eeuo pipefail

log() { logger -t mawid-backup -- "$*" 2>/dev/null || true; echo "$*"; }
trap 'log "FAILED (line $LINENO)"; rm -f "${file:-}.partial"; exit 1' ERR

: "${MAWID_DB:?set MAWID_DB (mawid or mawid_<suffix>)}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${MYSQL_DEFAULTS:?set MYSQL_DEFAULTS (option file with the backup credentials)}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_FREE_MB="${MIN_FREE_MB:-1024}"

if [[ ! "$MAWID_DB" =~ ^mawid(_[a-z0-9]+)*$ ]]; then
  log "Refusing: '$MAWID_DB' is not a Mawid database name."
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if (( free_mb < MIN_FREE_MB )); then
  log "Refusing: only ${free_mb} MB free in $BACKUP_DIR (minimum ${MIN_FREE_MB} MB)."
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/${MAWID_DB}-${stamp}.sql.gz"

mariadb-dump --defaults-extra-file="$MYSQL_DEFAULTS" \
  --single-transaction --quick --routines --triggers --events --hex-blob --no-tablespaces \
  "$MAWID_DB" | gzip -9 > "$file.partial"
mv "$file.partial" "$file"
gzip -t "$file"
if zcat "$file" | grep -qiE '^[[:space:]]*(/\*![0-9]+[[:space:]]*)?(CREATE[[:space:]]+(DATABASE|SCHEMA)|USE[[:space:]`])'; then
  log "FAILED: dump unexpectedly contains CREATE DATABASE / USE statements."
  exit 1
fi
(cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")

# Retention: delete only this database's own dumps older than RETENTION_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${MAWID_DB}-*.sql.gz*" -mtime +"$RETENTION_DAYS" -delete

log "Backup OK: $file ($(du -h "$file" | cut -f1))"
