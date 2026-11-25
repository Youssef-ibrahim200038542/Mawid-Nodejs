// Static role → permission map for clinic members. Checked on the backend only;
// the frontend may mirror it for display, never for security.
// Ownership-dependent rules (e.g. a doctor may only edit their own schedule) are
// enforced again inside the services.
const readAll = ["clinic:read", "specialties:read", "services:read", "doctors:read", "schedule:read"];

// Front-desk work shared by owners and receptionists.
const frontDesk = ["appointments:read", "appointments:create", "appointments:manage", "patients:read", "patients:manage"];

const rolePermissions = {
    OWNER: [
        ...readAll,
        ...frontDesk,
        "clinic:update",
        "members:read",
        "members:manage",
        "audit:read",
        "analytics:read",
        "specialties:manage",
        "services:manage",
        "doctors:manage",
        "schedule:manage",
    ],
    // A doctor manages only their own schedule, sees only their own appointments (with the
    // patient's contact details for those), and may confirm / complete / mark no-show on them.
    DOCTOR: [...readAll, "schedule:manage_own", "appointments:read_own", "appointments:update_own"],
    RECEPTIONIST: [...readAll, ...frontDesk],
};

const permissionSets = Object.fromEntries(
    Object.entries(rolePermissions).map(([role, permissions]) => [role, new Set(permissions)])
);

function hasPermission(role, permission) {
    const permissions = permissionSets[role];
    return Boolean(permissions && permissions.has(permission));
}

module.exports = { rolePermissions, hasPermission };
