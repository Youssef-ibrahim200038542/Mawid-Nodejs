// Grants SUPER_ADMIN to an existing user. Command line only — there is deliberately no API
// to create the first super admin. The change is audited.
// Usage: node scripts/make-super-admin.js someone@example.com
const prisma = require("../src/config/database");
const { recordAudit } = require("../src/lib/audit");

(async () => {
    const email = (process.argv[2] || "").trim().toLowerCase();
    if (!email) throw new Error("Usage: node scripts/make-super-admin.js <email>");
    const [{ db }] = await prisma.$queryRaw`SELECT DATABASE() AS db`;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, platformRole: true } });
    if (!user) throw new Error(`No user with email ${email} in database "${db}".`);
    if (user.platformRole === "SUPER_ADMIN") {
        console.log(`Already a super admin (database "${db}").`);
    } else {
        await prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id: user.id }, data: { platformRole: "SUPER_ADMIN" } });
            await recordAudit(tx, { actorUserId: null, action: "admin.user_role_changed", targetType: "user", targetId: user.id, metadata: { from: user.platformRole, to: "SUPER_ADMIN", via: "cli" } });
        });
        console.log(`Granted SUPER_ADMIN (database "${db}").`);
    }
    await prisma.$disconnect();
})().catch(async (error) => {
    console.error(error.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
});
