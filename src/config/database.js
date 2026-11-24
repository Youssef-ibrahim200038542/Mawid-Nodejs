
require('dotenv').config();

const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { PrismaClient } = require('../../generated/prisma');

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

const adapter = new PrismaMariaDb({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
    connectionLimit: 5
});

const prisma = new PrismaClient({
    adapter
});

module.exports = prisma;
