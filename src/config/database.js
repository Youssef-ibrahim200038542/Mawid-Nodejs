
require('dotenv').config();

const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { PrismaClient } = require('../../generated/prisma');
const { assertMawidDatabase } = require('./db-guard');

const requiredEnvVariables = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_NAME'
];

for (const variable of requiredEnvVariables) {
    if (!process.env[variable]) {
        throw new Error(`Missing environment variable: ${variable}`);
    }
}

assertMawidDatabase({ dbName: process.env.DB_NAME, databaseUrl: process.env.DATABASE_URL });

const adapter = new PrismaMariaDb({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
    connectionLimit: 5,
    // Session-scoped only: applies to Mawid's own connections and never changes the
    // server's global settings, so other databases on the same server are unaffected.
    sessionVariables: {
        sql_mode: 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
        time_zone: '+00:00'
    }
});

const prisma = new PrismaClient({
    adapter
});

const requiredDelegates = [
    'user', 'event', 'registration', 'session', 'clinic', 'clinicMember', 'auditLog',
    'specialty', 'service', 'doctorProfile', 'doctorSpecialty', 'doctorService', 'workingHours', 'scheduleException'
];
const missingDelegates = requiredDelegates.filter((delegate) => !prisma[delegate]);

if (missingDelegates.length > 0) {
    throw new Error(
        `Generated Prisma Client is missing models: ${missingDelegates.join(', ')}. Run "npx prisma generate" and restart the app.`
    );
}

module.exports = prisma;
