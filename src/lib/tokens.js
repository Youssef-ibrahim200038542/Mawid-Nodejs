// Security tokens (email verification, password reset, invitations).
// The raw token is 256 random bits in base64url; only its SHA-256 hash is ever stored.
const crypto = require("node:crypto");

const rawTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function hashToken(raw) {
    return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function generateToken() {
    const raw = crypto.randomBytes(32).toString("base64url");
    return { raw, hash: hashToken(raw) };
}

// A hash that matches no raw token (used for rows that must never be redeemable).
function unusableTokenHash() {
    return crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
}

function isWellFormedToken(value) {
    return typeof value === "string" && rawTokenPattern.test(value);
}

function sha256Hex(value) {
    return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

// Keyed hash for rate-limit keys derived from an email address: unlike a plain SHA-256 of
// the email, it cannot be reversed with a dictionary of addresses without the server secret.
function keyedHash(purpose, value) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is required to derive rate-limit keys.");
    return crypto.createHmac("sha256", secret).update(`${purpose}:${value}`, "utf8").digest("hex");
}

// "n***@example.com" — enough for a person to recognise their own address.
function maskEmail(email) {
    const [local, domain] = String(email).split("@");
    if (!domain) return "***";
    return `${local.slice(0, 1)}***@${domain}`;
}

module.exports = { generateToken, hashToken, unusableTokenHash, isWellFormedToken, sha256Hex, keyedHash, maskEmail };
