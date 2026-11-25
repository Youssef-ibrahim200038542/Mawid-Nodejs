// Static role → permission map for clinic members. Checked on the backend only;
// the frontend may mirror it for display, never for security.
// Ownership-dependent rules (e.g. a doctor may only edit their own schedule) are
// enforced again inside the services.
const readAll = ["clinic:read", "specialties:read", "services:read", "doctors:read", "schedule:read"];

const rolePermissions = {
    OWNER: [
        ...readAll,
        "clinic:update",
        "members:read",
        "members:manage",
        "audit:read",
        "specialties:manage",
        "services:manage",
        "doctors:manage",
        "schedule:manage",
    ],
    // A doctor manages only their own working hours and exceptions.
    DOCTOR: [...readAll, "schedule:manage_own"],
    RECEPTIONIST: [...readAll],
};

const permissionSets = Object.fromEntries(
    Object.entries(rolePermissions).map(([role, permissions]) => [role, new Set(permissions)])
);

function hasPermission(role, permission) {
    const permissions = permissionSets[role];
    return Boolean(permissions && permissions.has(permission));
}

module.exports = { rolePermissions, hasPermission };
