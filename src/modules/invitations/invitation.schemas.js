const { z } = require("zod");

const createInvitationSchema = z.strictObject({
    email: z.email().max(255).transform((value) => value.trim().toLowerCase()),
    role: z.enum(["OWNER", "DOCTOR", "RECEPTIONIST"]),
});

// The raw token travels only in request bodies (never URLs), so it never reaches access logs.
const tokenSchema = z.strictObject({ token: z.string().min(1).max(100) });
const emptySchema = z.strictObject({});
const bootstrapSchema = z.strictObject({ memberId: z.number().int().positive().max(2_147_483_647) });

module.exports = { createInvitationSchema, tokenSchema, emptySchema, bootstrapSchema };
