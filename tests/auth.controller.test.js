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

test("signup handles a duplicate email discovered during insert", async (t) => {
    stubDependencies(t, {
        findByEmail: async () => null,
        hash: async () => "hashed-password",
        create: async () => {
            throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        },
    });

    const req = makeRequest({
        name: " Ada ",
        email: " ADA@example.com ",
        password: "correct-horse",
    });
    const res = makeResponse();
    await authController.signup(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.locals.error, "That email is already registered.");
    assert.equal(res.locals.values.email, "ada@example.com");
    assert.equal(req.session.regenerated, false);
});

test("signup stores a user and persists a regenerated session", async (t) => {
    let createdUser;
    stubDependencies(t, {
        findByEmail: async () => null,
        hash: async (password, rounds) => {
            assert.equal(password, "correct-horse");
            assert.equal(rounds, 12);
            return "hashed-password";
        },
        create: async (name, email, passwordHash) => {
            createdUser = { name, email, passwordHash };
            return 42;
        },
    });

    const req = makeRequest({
        name: " Ada ",
        email: " ADA@example.com ",
        password: "correct-horse",
    });
    const res = makeResponse();
    await authController.signup(req, res);

    assert.deepEqual(createdUser, {
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed-password",
    });
    assert.deepEqual(req.session.user, { id: 42, name: "Ada" });
    assert.equal(req.session.regenerated, true);
    assert.equal(req.session.saved, true);
    assert.equal(res.redirectedTo, "/dashboard");
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
        findByEmail: async () => ({ id: 42, name: "Ada", passwordHash: "stored-hash" }),
        compare: async (password, hash) => password === "correct-horse" && hash === "stored-hash",
    });

    const req = makeRequest({
        email: " ADA@example.com ",
        password: "correct-horse",
    });
    const res = makeResponse();
    await authController.login(req, res);

    assert.deepEqual(req.session.user, { id: 42, name: "Ada" });
    assert.equal(req.session.regenerated, true);
    assert.equal(req.session.saved, true);
    assert.equal(res.redirectedTo, "/dashboard");
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
