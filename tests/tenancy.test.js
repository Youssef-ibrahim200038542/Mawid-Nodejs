const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/database");
const { loadTenant, requirePermission } = require("../src/middleware/tenant");
const { hasPermission } = require("../src/lib/permissions");
const clinicService = require("../src/modules/clinics/clinic.service");

function stub(t, target, name, implementation) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => {
        target[name] = original;
    });
}

function runMiddleware(middleware, req) {
    return new Promise((resolve, reject) => {
        Promise.resolve(middleware(req, {}, (error) => resolve(error ?? null))).catch(reject);
    });
}

const clinicA = { id: 1, slug: "clinic-a", timezone: "Africa/Cairo" };

test("loadTenant scopes the lookup to the session user and URL slug, ignoring clinicId in the request", async (t) => {
    let receivedWhere;
    stub(t, prisma.clinicMember, "findFirst", async ({ where }) => {
        receivedWhere = where;
        return { id: 10, role: "OWNER", trustState: "TRUSTED", user: { emailVerifiedAt: new Date() }, clinic: clinicA };
    });

    const req = {
        params: { clinicSlug: "clinic-a" },
        session: { user: { id: 7 } },
        body: { clinicId: 999 },
        query: { clinicId: "999" },
    };
    const error = await runMiddleware(loadTenant, req);

    assert.equal(error, null);
    assert.deepEqual(receivedWhere, {
        userId: 7,
        status: "ACTIVE",
        clinic: { slug: "clinic-a", status: "ACTIVE" },
    });
    assert.equal(req.tenant.clinicId, 1);
    assert.equal(req.tenant.role, "OWNER");
    assert.ok(Object.isFrozen(req.tenant));
});

test("loadTenant refuses a legacy (not re-confirmed) membership for every role, even with a verified email", async (t) => {
    for (const role of ["OWNER", "DOCTOR", "RECEPTIONIST"]) {
        stub(t, prisma.clinicMember, "findFirst", async () => ({ id: 10, role, trustState: "LEGACY_UNREVIEWED", user: { emailVerifiedAt: new Date() }, clinic: clinicA }));
        const req = { params: { clinicSlug: "clinic-a" }, session: { user: { id: 7 } } };
        const error = await runMiddleware(loadTenant, req);
        assert.equal(error.status, 403);
        assert.equal(error.code, "MEMBERSHIP_RECONFIRMATION_REQUIRED");
        assert.equal(req.tenant, undefined);
    }
});

test("loadTenant refuses a trusted membership whose account email is not verified", async (t) => {
    stub(t, prisma.clinicMember, "findFirst", async () => ({ id: 10, role: "OWNER", trustState: "TRUSTED", user: { emailVerifiedAt: null }, clinic: clinicA }));
    const req = { params: { clinicSlug: "clinic-a" }, session: { user: { id: 7 } } };
    const error = await runMiddleware(loadTenant, req);
    assert.equal(error.status, 403);
    assert.equal(error.code, "EMAIL_NOT_VERIFIED");
    assert.equal(req.tenant, undefined);
});

test("loadTenant returns 404 when the user is not a member of the clinic (cross-tenant access)", async (t) => {
    stub(t, prisma.clinicMember, "findFirst", async () => null);

    const req = { params: { clinicSlug: "clinic-b" }, session: { user: { id: 7 } } };
    const error = await runMiddleware(loadTenant, req);

    assert.equal(error.status, 404);
    assert.equal(error.code, "NOT_FOUND");
    assert.equal(req.tenant, undefined);
});

test("loadTenant rejects oversized slugs without querying", async (t) => {
    let queried = false;
    stub(t, prisma.clinicMember, "findFirst", async () => {
        queried = true;
    });

    const error = await runMiddleware(loadTenant, { params: { clinicSlug: "x".repeat(81) }, session: { user: { id: 7 } } });

    assert.equal(error.status, 404);
    assert.equal(queried, false);
});

test("role permissions: only owners can update the clinic or read members", () => {
    assert.equal(hasPermission("OWNER", "clinic:update"), true);
    assert.equal(hasPermission("OWNER", "members:read"), true);
    for (const role of ["DOCTOR", "RECEPTIONIST"]) {
        assert.equal(hasPermission(role, "clinic:read"), true);
        assert.equal(hasPermission(role, "clinic:update"), false);
        assert.equal(hasPermission(role, "members:read"), false);
    }
    assert.equal(hasPermission("SUPER_ADMIN", "clinic:read"), false);
    assert.equal(hasPermission(undefined, "clinic:read"), false);
});

test("requirePermission returns 403 for a member without the permission", async () => {
    const error = await runMiddleware(requirePermission("clinic:update"), { tenant: { role: "RECEPTIONIST" } });
    assert.equal(error.status, 403);

    const allowed = await runMiddleware(requirePermission("clinic:update"), { tenant: { role: "OWNER" } });
    assert.equal(allowed, null);
});

test("requirePermission fails closed when no tenant was resolved", async () => {
    const error = await runMiddleware(requirePermission("clinic:read"), {});
    assert.equal(error.status, 403);
});

test("updateClinic writes only to the tenant's clinic and records an audit entry in the same transaction", async (t) => {
    const calls = [];
    const tx = {
        clinic: {
            update: async (args) => {
                calls.push(["clinic.update", args]);
                return { id: 1, name: args.data.name };
            },
        },
        auditLog: {
            create: async (args) => {
                calls.push(["auditLog.create", args]);
            },
        },
    };
    stub(t, prisma, "$transaction", async (callback) => callback(tx));

    const tenant = { clinicId: 1, userId: 7, role: "OWNER" };
    await clinicService.updateClinic(tenant, { ipAddress: "127.0.0.1", input: { name: "New name" } });

    assert.deepEqual(calls[0][1].where, { id: 1 });
    assert.equal(calls[1][0], "auditLog.create");
    assert.equal(calls[1][1].data.clinicId, 1);
    assert.equal(calls[1][1].data.action, "clinic.updated");
    assert.deepEqual(calls[1][1].data.metadata, { fields: ["name"] });
});

test("listMembers filters by the tenant's clinic and never selects password hashes", async (t) => {
    let findArgs;
    let countArgs;
    stub(t, prisma.clinicMember, "findMany", async (args) => {
        findArgs = args;
        return [];
    });
    stub(t, prisma.clinicMember, "count", async (args) => {
        countArgs = args;
        return 0;
    });

    const result = await clinicService.listMembers({ clinicId: 1 }, { page: 2, pageSize: 25 });

    assert.deepEqual(findArgs.where, { clinicId: 1 });
    assert.deepEqual(countArgs.where, { clinicId: 1 });
    assert.equal(findArgs.skip, 25);
    assert.equal(findArgs.take, 25);
    assert.deepEqual(findArgs.select.user.select, { id: true, name: true, email: true });
    assert.deepEqual(result, { items: [], page: 2, pageSize: 25, total: 0 });
});

test("createClinic makes the verified creator a TRUSTED OWNER and maps a duplicate slug to 409", async (t) => {
    const created = [];
    let verifiedAt = new Date();
    const tx = {
        $queryRaw: async () => [{ id: 7, emailVerifiedAt: verifiedAt }],
        clinic: { create: async () => ({ id: 5, slug: "nile-dental" }) },
        clinicMember: { create: async (args) => created.push(args.data) },
        auditLog: { create: async () => {} },
    };
    stub(t, prisma, "$transaction", async (callback) => callback(tx));

    await clinicService.createClinic({ actorUserId: 7, ipAddress: null, input: { name: "Nile Dental", slug: "nile-dental" } });
    assert.equal(created.length, 1);
    const { trustedAt, ...membership } = created[0];
    assert.ok(trustedAt instanceof Date);
    assert.deepEqual(membership, { clinicId: 5, userId: 7, role: "OWNER", trustState: "TRUSTED", trustSource: "CLINIC_CREATOR" });

    verifiedAt = null;
    await assert.rejects(clinicService.createClinic({ actorUserId: 7, ipAddress: null, input: { name: "Nile Dental", slug: "nile-dental" } }), {
        status: 403,
        code: "EMAIL_NOT_VERIFIED",
    });
    assert.equal(created.length, 1);

    prisma.$transaction = async () => {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    };
    await assert.rejects(
        clinicService.createClinic({ actorUserId: 7, ipAddress: null, input: { name: "Nile Dental", slug: "nile-dental" } }),
        { status: 409, code: "CLINIC_SLUG_TAKEN" }
    );
});
