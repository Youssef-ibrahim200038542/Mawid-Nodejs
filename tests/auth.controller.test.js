const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const User = require("../src/models/user.model");
const authController = require("../src/controllers/auth.controller");

function stubDependencies(t, overrides) {
    const originals = {
        findByEmail: User.findByEmail,
        create: User.create,
        hash: bcrypt.hash,
        compare: bcrypt.compare,
    };

    Object.assign(User, {
        findByEmail: overrides.findByEmail || originals.findByEmail,
        create: overrides.create || originals.create,
    });
    bcrypt.hash = overrides.hash || originals.hash;
    bcrypt.compare = overrides.compare || originals.compare;

    t.after(() => {
        User.findByEmail = originals.findByEmail;
        User.create = originals.create;
        bcrypt.hash = originals.hash;
        bcrypt.compare = originals.compare;
    });
}

function makeRequest(body) {
    const req = {
        body,
        session: {
            regenerated: false,
            saved: false,
            regenerate(callback) {
                this.regenerated = true;
                callback(null);
            },
            save(callback) {
                this.saved = true;
                callback(null);
            },
        },
    };

    return req;
}

function makeResponse() {
    return {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        render(view, locals) {
            this.view = view;
            this.locals = locals;
            return this;
        },
        redirect(path) {
            this.redirectedTo = path;
            return this;
        },
        clearCookie(name) {
            this.clearedCookie = name;
            return this;
        },
    };
}

test("signup rejects missing and invalid fields without querying users", async (t) => {
    stubDependencies(t, {
        findByEmail: async () => {
            assert.fail("Invalid signup must not query the database.");
        },
    });

    const req = makeRequest(undefined);
    const res = makeResponse();
    await authController.signup(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.view, "signup");
    assert.equal(res.locals.error, "All fields are required.");
});

test("signup enforces database and bcrypt field limits", async (t) => {
    stubDependencies(t, {
        findByEmail: async () => {
            assert.fail("Invalid signup must not query the database.");
        },
    });

    const invalidSubmissions = [
        {
            name: "A".repeat(101),
            email: "ada@example.com",
            password: "correct-horse",
        },
        {
            name: "Ada",
            email: "ada@example.com",
            password: "😀".repeat(19),
        },
    ];

    for (const body of invalidSubmissions) {
        const res = makeResponse();
        await authController.signup(makeRequest(body), res);
        assert.equal(res.statusCode, 400);
    }
});

test("login rejects missing or invalid fields before querying users", async (t) => {
    stubDependencies(t, {
        findByEmail: async () => {
            assert.fail("Invalid login must not query the database.");
        },
    });

    for (const body of [undefined, { email: "not-an-email", password: "secret" }]) {
        const res = makeResponse();
        await authController.login(makeRequest(body), res);
        assert.equal(res.statusCode, 400);
    }
});

test("signup gives the same answer for any valid address and never creates a session", async (t) => {
    const calls = [];
    const original = authController.accountService.register;
    authController.accountService.register = async (input) => {
        calls.push(input);
    };
    t.after(() => {
        authController.accountService.register = original;
    });

    for (const email of [" ADA@example.com ", "someone-else@example.com"]) {
        const req = makeRequest({ name: " Ada ", email, password: "correct-horse" });
        const res = makeResponse();
        await authController.signup(req, res);

        assert.equal(res.statusCode, 202);
        assert.equal(res.view, "signup");
        assert.equal(res.locals.sent, true);
        assert.equal(res.locals.error, null);
        assert.equal(req.session.regenerated, false);
        assert.equal(req.session.user, undefined);
    }
    assert.deepEqual(calls.map(({ name, email, password }) => ({ name, email, password })), [
        { name: "Ada", email: "ada@example.com", password: "correct-horse" },
        { name: "Ada", email: "someone-else@example.com", password: "correct-horse" },
    ]);
});

test("login rejects wrong credentials without creating a session", async (t) => {
    stubDependencies(t, {
        findByEmail: async (email) => {
            assert.equal(email, "ada@example.com");
            return { id: 42, name: "Ada", passwordHash: "stored-hash" };
        },
        compare: async () => false,
    });

    const req = makeRequest({
        email: " ADA@example.com ",
        password: "wrong-password",
    });
    const res = makeResponse();
    await authController.login(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.locals.error, "Wrong email or password.");
    assert.equal(req.session.regenerated, false);
});

test("login persists a regenerated session for valid credentials", async (t) => {
    stubDependencies(t, {
        findByEmail: async () => ({ id: 42, name: "Ada", passwordHash: "stored-hash", sessionVersion: 3 }),
        compare: async (password, hash) => password === "correct-horse" && hash === "stored-hash",
    });
    let snapshot;
    const original = authController.accountService.confirmLoginSnapshot;
    authController.accountService.confirmLoginSnapshot = async (req, value) => {
        snapshot = value;
    };
    t.after(() => {
        authController.accountService.confirmLoginSnapshot = original;
    });

    const req = makeRequest({
        email: " ADA@example.com ",
        password: "correct-horse",
    });
    const res = makeResponse();
    await authController.login(req, res);

    assert.deepEqual(req.session.user, { id: 42, name: "Ada", sv: 3 });
    assert.deepEqual(snapshot, { id: 42, passwordHash: "stored-hash", sessionVersion: 3 });
    assert.equal(req.session.regenerated, true);
    assert.equal(req.session.saved, true);
    assert.equal(res.redirectedTo, "/dashboard");
});

test("login fails like a wrong password when a reset lands between the check and the session", async (t) => {
    stubDependencies(t, {
        findByEmail: async () => ({ id: 42, name: "Ada", passwordHash: "stored-hash", sessionVersion: 0 }),
        compare: async () => true,
    });
    const original = authController.accountService.confirmLoginSnapshot;
    authController.accountService.confirmLoginSnapshot = async () => {
        throw Object.assign(new Error("Wrong email or password."), { code: "INVALID_CREDENTIALS", status: 401 });
    };
    t.after(() => {
        authController.accountService.confirmLoginSnapshot = original;
    });

    const res = makeResponse();
    await authController.login(makeRequest({ email: "ada@example.com", password: "old-password" }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.locals.error, "Wrong email or password.");
    assert.equal(res.redirectedTo, undefined);
});

test("establishSession refuses to run without the snapshot session version", async () => {
    await assert.rejects(authController.establishSession(makeRequest({}), { id: 1, name: "A" }), /session version/);
});

test("login still runs bcrypt when the email is unknown, so timing does not reveal accounts", async (t) => {
    let comparedHash = null;
    stubDependencies(t, {
        findByEmail: async () => null,
        compare: async (password, hash) => {
            comparedHash = hash;
            return true;
        },
    });

    const req = makeRequest({ email: "nobody@example.com", password: "any-password" });
    const res = makeResponse();
    await authController.login(req, res);

    assert.match(comparedHash, /^\$2b\$12\$/);
    assert.equal(res.statusCode, 401);
    assert.equal(req.session.regenerated, false);
});
