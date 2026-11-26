import type { Role } from "@/api/types";

// Mirror of src/lib/permissions.js — used ONLY to decide what to show. The API enforces every rule.
const readAll = ["clinic:read", "specialties:read", "services:read", "doctors:read", "schedule:read"];
const frontDesk = ["appointments:read", "appointments:create", "appointments:manage", "patients:read", "patients:manage"];

const rolePermissions: Record<Role, Set<string>> = {
    OWNER: new Set([
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
    ]),
    DOCTOR: new Set([...readAll, "schedule:manage_own", "appointments:read_own", "appointments:update_own"]),
    RECEPTIONIST: new Set([...readAll, ...frontDesk]),
};

export type Permission =
    | "clinic:update"
    | "members:read"
    | "members:manage"
    | "audit:read"
    | "analytics:read"
    | "specialties:manage"
    | "services:manage"
    | "doctors:manage"
    | "schedule:manage"
    | "schedule:manage_own"
    | "appointments:read"
    | "appointments:read_own"
    | "appointments:create"
    | "appointments:manage"
    | "appointments:update_own"
    | "patients:read"
    | "patients:manage"
    | "schedule:read"
    | "doctors:read"
    | "services:read"
    | "specialties:read";

export const can = (role: Role, permission: Permission) => rolePermissions[role].has(permission);
