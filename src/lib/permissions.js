// Static role → permission map for clinic members. Checked on the backend only;
// the frontend may mirror it for display, never for security.
// Ownership-dependent rules (e.g. a doctor only sees their own appointments) are
// enforced again inside the services.
const rolePermissions = {
    OWNER: [
        "clinic:read",
        "clinic:update",
        "members:read",
        "members:manage",
        "audit:read",
    ],
    DOCTOR: ["clinic:read"],
    RECEPTIONIST: ["clinic:read"],
};

const permissionSets = Object.fromEntries(
    Object.entries(rolePermissions).map(([role, permissions]) => [role, new Set(permissions)])
);

function hasPermission(role, permission) {
    const permissions = permissionSets[role];
    return Boolean(permissions && permissions.has(permission));
}

module.exports = { rolePermissions, hasPermission };
