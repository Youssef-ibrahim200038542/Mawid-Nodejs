-- Mawid least-privilege database accounts (H2).
--
-- RUN BY A DATABASE ADMINISTRATOR, ONCE PER ENVIRONMENT. Not executed by the application, by tests
-- or by any script in this repository. Review it first: it creates accounts on the server.
--
-- Replace before running:
--   {{DB}}            the Mawid database for this environment (mawid, or mawid_test for development)
--   {{APP_HOST}}      host the app connects from ('localhost' on the same machine, or the app server's address)
--   {{APP_PASSWORD}}  long random secret (e.g. 32+ chars), stored only in the app's secret store
--   {{MIG_PASSWORD}}  long random secret for the migration account, stored only for the migration job
--
-- These statements only create accounts and grant rights on {{DB}}. They change no server setting,
-- no other database and no other account. Neither account can see or touch any other database on
-- the server (for example DriveX's `car_rental`).

-- 1) Runtime account: the running app (DB_USER / DB_PASSWORD). Data access only.
CREATE USER 'mawid_app'@'{{APP_HOST}}' IDENTIFIED BY '{{APP_PASSWORD}}';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB}}`.* TO 'mawid_app'@'{{APP_HOST}}';

-- 2) Migration account: only the migration job (DATABASE_URL for `prisma migrate deploy`).
--    Exactly what the committed migrations use (CREATE TABLE, CREATE INDEX, ALTER TABLE … ADD
--    COLUMN / ADD CONSTRAINT for foreign keys and CHECKs) plus row access to _prisma_migrations.
--    No DROP: no migration drops anything; a future migration that needs it gets a temporary,
--    reviewed GRANT DROP for that rollout only. No CREATE DATABASE, no global rights, no GRANT OPTION.
--    (REFERENCES is not enforced by MariaDB for foreign keys but is required by MySQL ≥ 8.0.22.)
CREATE USER 'mawid_migrator'@'{{APP_HOST}}' IDENTIFIED BY '{{MIG_PASSWORD}}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON `{{DB}}`.* TO 'mawid_migrator'@'{{APP_HOST}}';

-- 3) Optional read-only account for scripts/review-memberships.js and reporting.
-- CREATE USER 'mawid_readonly'@'{{APP_HOST}}' IDENTIFIED BY '{{RO_PASSWORD}}';
-- GRANT SELECT ON `{{DB}}`.* TO 'mawid_readonly'@'{{APP_HOST}}';

-- Verify (read-only):
--   SHOW GRANTS FOR 'mawid_app'@'{{APP_HOST}}';
--   node scripts/verify-db-privileges.js --env <app env file> --db {{DB}}                     (role app)
--   node scripts/verify-db-privileges.js --env <migration env file> --db {{DB}} --role migrator
--
-- Roll back (removes only these accounts):
--   DROP USER 'mawid_app'@'{{APP_HOST}}';
--   DROP USER 'mawid_migrator'@'{{APP_HOST}}';
