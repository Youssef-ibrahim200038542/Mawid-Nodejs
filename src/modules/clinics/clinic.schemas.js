const { z } = require("zod");

const supportedLocales = ["en", "ar"];
const timezones = new Set(Intl.supportedValuesOf("timeZone"));

// Slugs become public URLs (/clinic/<slug>), so block words used by app routes.
const reservedSlugs = new Set([
    "admin", "api", "app", "assets", "auth", "clinic", "clinics", "dashboard", "events",
    "help", "login", "logout", "new", "settings", "signup", "static", "support", "www",
]);

const optionalText = (max) =>
    z
        .string()
        .trim()
        .max(max)
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional();

const slug = z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.")
    .refine((value) => !reservedSlugs.has(value), "This address is reserved.");

const timezone = z.string().refine((value) => timezones.has(value), "Unknown time zone.");

const editableFields = {
    name: z.string().trim().min(2).max(150),
    timezone,
    defaultLocale: z.enum(supportedLocales),
    phone: optionalText(30),
    email: z
        .union([z.literal(""), z.email().max(255)])
        .transform((value) => (value === "" ? null : value.toLowerCase()))
        .nullable()
        .optional(),
    address: optionalText(255),
    city: optionalText(100),
};

const createClinicSchema = z.strictObject({
    ...editableFields,
    slug,
    timezone: timezone.default("Africa/Cairo"),
    defaultLocale: z.enum(supportedLocales).default("en"),
});

// slug is deliberately not editable: it is the clinic's public link.
const updateClinicSchema = z
    .strictObject({
        name: editableFields.name.optional(),
        timezone: timezone.optional(),
        defaultLocale: editableFields.defaultLocale.optional(),
        phone: editableFields.phone,
        email: editableFields.email,
        address: editableFields.address,
        city: editableFields.city,
    })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

const paginationSchema = z.strictObject({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { createClinicSchema, updateClinicSchema, paginationSchema, reservedSlugs };

// Staff membership. v1 adds people who already have a Mawid account (no email invitations yet).
const memberRole = z.enum(["OWNER", "DOCTOR", "RECEPTIONIST"]);
const addMemberSchema = z.strictObject({
    email: z.email().max(255).transform((value) => value.trim().toLowerCase()),
    role: memberRole,
});
const updateMemberSchema = z
    .strictObject({ role: memberRole.optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

module.exports.addMemberSchema = addMemberSchema;
module.exports.updateMemberSchema = updateMemberSchema;
