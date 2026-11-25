const bcrypt = require("bcrypt");
const User = require("../models/user.model");

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

function establishSession(req, user) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) {
                return reject(error);
            }

            req.session.user = { id: user.id, name: user.name };
            req.session.save((saveError) => {
                if (saveError) {
                    return reject(saveError);
                }
                resolve();
            });
        });
    });
}

function isDuplicateEmailError(error) {
    return error && error.code === "P2002";
}

function showSignup(req, res) {
    res.render("signup", { error: null, values: { name: "", email: "" } });
}

async function signup(req, res) {
    const values = formValues(req.body);
    const error = validateSignup(values);
    if (error) {
        return res.status(400).render("signup", {
            error,
            values: { name: values.name, email: values.email },
        });
    }

    const existing = await User.findByEmail(values.email);
    if (existing) {
        return res.status(409).render("signup", {
            error: "That email is already registered.",
            values: { name: values.name, email: values.email },
        });
    }

    const passwordHash = await bcrypt.hash(values.password, 12);
    let id;
    try {
        id = await User.create(values.name, values.email, passwordHash);
    } catch (createError) {
        if (isDuplicateEmailError(createError)) {
            return res.status(409).render("signup", {
                error: "That email is already registered.",
                values: { name: values.name, email: values.email },
            });
        }
        throw createError;
    }

    await establishSession(req, { id, name: values.name });
    res.redirect("/dashboard");
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

    const user = await User.findByEmail(values.email);
    const passwordMatches = await bcrypt.compare(values.password, user ? user.passwordHash : dummyPasswordHash);
    if (!user || !passwordMatches) {
        return res.status(401).render("login", {
            error: "Wrong email or password.",
            values: { email: values.email },
        });
    }

    await establishSession(req, user);
    res.redirect("/dashboard");
}

function logout(req, res, next) {
    req.session.destroy((error) => {
        if (error) {
            return next(error);
        }

        res.clearCookie("connect.sid");
        res.redirect("/");
    });
}

module.exports = {
    showSignup,
    signup,
    showLogin,
    login,
    logout,
};
