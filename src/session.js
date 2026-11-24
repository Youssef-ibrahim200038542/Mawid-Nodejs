const session = require("express-session");
const { PrismaSessionStore } = require("@quixo3/prisma-session-store");
const prisma = require("./config/database");

const sessionSecret = process.env.SESSION_SECRET;
if (
    !sessionSecret ||
    sessionSecret === "replace_with_a_long_random_secret" ||
    Buffer.byteLength(sessionSecret, "utf8") < 32
) {
    throw new Error(
        "SESSION_SECRET must be a random value of at least 32 bytes. Generate one with node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\"."
    );
}

const store = new PrismaSessionStore(prisma, {
    checkPeriod: 10 * 60 * 1000,
    dbRecordIdIsSessionId: true,
});

module.exports = session({
    secret: sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    },
});