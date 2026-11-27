const bcrypt = require("bcrypt");
const User = require("../models/user.model");
const { issueCsrfToken } = require("../middleware/csrf");
// Loaded lazily: account.service requires the database client, and tests stub its functions.
const accountService = {
    register: (...args) => require("../modules/auth/account.service").register(...args),
    confirmLoginSnapshot: (...args) => require("../modules/auth/account.service").confirmLoginSnapshot(...args),
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bcryptMaxBytes = 72;
// bcrypt hash (cost 12) of a random throwaway value. Compared against when the email is
// unknown so that login takes the same time whether or not the account exists.
const dummyPasswordHash = "$2b$12$KOJFVQXgL/wgz6y7IUtWvO.XcBGnT4V3CW2KUI.Kn2GgwmexWZkCO";

function formValues(body) {
    const fields = body && typeof body === "object" && !Array.isArray(body) ? body : {};

    return {
        name: typeof fields.name === "string" ? fields.name.trim() : "",
        email: typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "",
        password: typeof fields.password === "string" ? fields.password : "",
    };
}

function validateSignup(values) {
    if (!values.name || !values.email || !values.password) {
        return "All fields are required.";
    }
    if (values.name.length > 100) {
        return "Name must be 100 characters or fewer.";
    }
    if (values.email.length > 255 || !emailPattern.test(values.email)) {
        return "Enter a valid email address.";
    }
    if (values.password.length < 8) {
        return "Password must be at least 8 characters.";
    }
    if (Buffer.byteLength(values.password, "utf8") > bcryptMaxBytes) {
        return "Password must be no more than 72 bytes.";
    }

    return null;
}

function validateLogin(values) {
    if (!values.email || !values.password) {
        return "Email and password are required.";
    }
    if (values.email.length > 255 || !emailPattern.test(values.email)) {
        return "Enter a valid email address.";
    }

    return null;
}

// `sv` is the session_version read together with the password hash BEFORE the password check.
// It is required (never re-read here): storing the version that was current when the credential
// was verified is what lets a later password reset invalidate this session.
function establishSession(req, user, { sv } = {}) {
    if (!Number.isInteger(sv)) {
        return Promise.reject(new Error("establishSession requires the session version from the credential snapshot."));
    }
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) {
                return reject(error);
            }

            req.session.user = { id: user.id, name: user.name, sv };
            // Fresh CSRF token for the new session, written in the same save as the user.
            issueCsrfToken(req);
            req.session.save((saveError) => {
                if (saveError) {
                    return reject(saveError);
                }
                resolve();
            });
        });
    });
}

function showSignup(req, res) {
    res.render("signup", { error: null, sent: false, values: { name: "", email: "" } });
}

// Same account-security flow as POST /api/v1/auth/signup: one generic answer whether or not the
// address already has an account, no session, the email goes out after the database commit.
async function signup(req, res) {
    const values = formValues(req.body);
    const error = validateSignup(values);
    if (error) {
        return res.status(400).render("signup", {
            error,
            sent: false,
            values: { name: values.name, email: values.email },
        });
    }

    await accountService.register({ name: values.name, email: values.email, password: values.password, ipAddress: req.ip });
    res.status(202).render("signup", { error: null, sent: true, values: { name: "", email: "" } });
}

function showLogin(req, res) {
    res.render("login", { error: null, values: { email: "" } });
}

async function login(req, res) {
    const values = formValues(req.body);
    const error = validateLogin(values);
    if (error) {
        return res.status(400).render("login", {
            error,
            values: { email: values.email },
        });
    }

    // Snapshot: password hash and session version are read together, before the comparison.
    const user = await User.findByEmail(values.email);
    const passwordMatches = await bcrypt.compare(values.password, user ? user.passwordHash : dummyPasswordHash);
    if (!user || !passwordMatches) {
        return res.status(401).render("login", {
            error: "Wrong email or password.",
            values: { email: values.email },
        });
    }

    await establishSession(req, user, { sv: user.sessionVersion ?? 0 });
    try {
        await accountService.confirmLoginSnapshot(req, { id: user.id, passwordHash: user.passwordHash, sessionVersion: user.sessionVersion ?? 0 });
    } catch (snapshotError) {
        if (snapshotError && snapshotError.code === "INVALID_CREDENTIALS") {
            return res.status(401).render("login", { error: "Wrong email or password.", values: { email: values.email } });
        }
        throw snapshotError;
    }
    res.redirect("/dashboard");
}

function logout(req, res, next) {
    req.session.destroy((error) => {
        if (error) {
            return next(error);
        }

        res.clearCookie(require("../config/session-cookie").cookieName, { path: "/" });
        res.redirect("/");
    });
}

module.exports = {
    showSignup,
    signup,
    showLogin,
    login,
    logout,
    // Shared with the JSON auth API (src/modules/auth).
    establishSession,
    accountService,
    dummyPasswordHash,
    bcryptMaxBytes,
};
