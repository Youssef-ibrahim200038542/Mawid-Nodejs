// Staff invitations and legacy-membership re-confirmation.
//
// Lock order for EVERY mutation (create, resend, revoke, re-confirm, admin bootstrap, accept,
// decline): 1) the clinic row, 2) the invitation row, 3) membership rows. Bookings never lock
// clinics or invitations, so there is no cycle. Because every path of one clinic serialises on
// the clinic row, two concurrent creates/resends cannot produce two open invitations or bypass
// the 60 s cooldown; the UNIQUE active_key is the database backstop.
//
// Every email (first send or resend, any endpoint) goes through rotate(): a new raw token, the
// old link dead, last_sent_at/send_count updated — all under the locks, after the cooldown check.
// The email is sent after COMMIT and its status is stored only if the token hash still matches.
const prisma = require("../../config/database");
const logger = require("../../lib/logger");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const background = require("../../lib/background-work");
const { createMemoryQuota } = require("../../lib/memory-quota");
const { generateToken, hashToken, isWellFormedToken, sha256Hex, keyedHash, maskEmail } = require("../../lib/tokens");
const { deliver } = require("../notifications/email-provider");
const { buildInvitationEmail } = require("../auth/auth.emails");
const trust = require("../membership/membership-trust.service");

const DAY = 86_400_000;
const INVITATION_TTL_MS = 7 * DAY;
const COOLDOWN_MS = 60_000;
const DELIVERY_UNKNOWN_MS = 10 * 60_000;
const txOptions = { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 };
// 3 emails per hour per clinic + recipient (single process; the DB cooldown is cross-instance).
const recipientQuota = createMemoryQuota({ windowMs: 60 * 60_000, limit: 3 });

const invitationSelect = {
    id: true,
    clinicId: true,
    kind: true,
    memberId: true,
    email: true,
    role: true,
    status: true,
    tokenHash: true,
    expiresAt: true,
    lastSentAt: true,
    sendCount: true,
    deliveryStatus: true,
    deliveryError: true,
    acceptedAt: true,
    acceptedByUserId: true,
    createdAt: true,
    invitedBy: { select: { id: true, name: true } },
};

const invalid = () => new AppError(404, "INVITATION_INVALID", "This invitation link is not valid.");
const noLongerValid = () => new AppError(409, "INVITATION_NO_LONGER_VALID", "This invitation was already used, declined or withdrawn.");
const expiredError = () => new AppError(410, "INVITATION_EXPIRED", "This invitation has expired. Ask the clinic to send a new one.");

function activeKey(kind, clinicId, subject) {
    return sha256Hex(`${kind}:${clinicId}:${subject}`);
}

function deliveryOf(invitation, now = new Date()) {
    if (invitation.deliveryStatus === "PENDING") {
        return now.getTime() - invitation.lastSentAt.getTime() > DELIVERY_UNKNOWN_MS ? "unknown" : "pending";
    }
    return invitation.deliveryStatus.toLowerCase();
}

function present(invitation, now = new Date()) {
    return {
        id: invitation.id,
        kind: invitation.kind,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        memberId: invitation.memberId,
        expiresAt: invitation.expiresAt.toISOString(),
        expired: invitation.status === "PENDING" && invitation.expiresAt <= now,
        lastSentAt: invitation.lastSentAt.toISOString(),
        sendCount: invitation.sendCount,
        delivery: deliveryOf(invitation, now),
        createdAt: invitation.createdAt.toISOString(),
        invitedBy: invitation.invitedBy ? { id: invitation.invitedBy.id, name: invitation.invitedBy.name } : null,
    };
}

async function lockClinic(tx, clinicId) {
    const rows = await tx.$queryRaw`SELECT id, slug, name, status, default_locale AS defaultLocale FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
    return rows[0] ?? null;
}

async function lockInvitationById(tx, clinicId, invitationId) {
    const rows = await tx.$queryRaw`SELECT id FROM clinic_invitations WHERE id = ${invitationId} AND clinic_id = ${clinicId} FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.clinicInvitation.findUnique({ where: { id: invitationId }, select: invitationSelect });
}

async function lockInvitationByKey(tx, key) {
    const rows = await tx.$queryRaw`SELECT id FROM clinic_invitations WHERE active_key = ${key} FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.clinicInvitation.findUnique({ where: { id: rows[0].id }, select: invitationSelect });
}

function takeRecipientQuota(clinicId, email) {
    const result = recipientQuota.take(keyedHash(`invite:${clinicId}`, email));
    if (!result.allowed) {
        throw new AppError(429, "RATE_LIMITED", "Too many emails to this person. Try again later.", { retryAfterSeconds: result.retryAfterSeconds });
    }
}

// The single cooldown + rotation used by every (re)send path. Caller holds clinic + invitation locks.
// The per-recipient quota is only taken once an email will really be sent (after the cooldown check).
async function rotate(tx, invitation, now, extra = {}) {
    const elapsed = now.getTime() - invitation.lastSentAt.getTime();
    if (elapsed < COOLDOWN_MS && invitation.deliveryStatus !== "FAILED") {
        throw new AppError(429, "INVITATION_COOLDOWN", "This invitation was just sent. Wait a minute before sending it again.", {
            retryAfterSeconds: Math.ceil((COOLDOWN_MS - elapsed) / 1000),
        });
    }
    takeRecipientQuota(invitation.clinicId, extra.email || invitation.email);
    const token = generateToken();
    await tx.clinicInvitation.update({
        where: { id: invitation.id },
        data: {
            ...extra,
            tokenHash: token.hash,
            lastSentAt: now,
            sendCount: { increment: 1 },
            deliveryStatus: "PENDING",
            deliveryError: null,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
    });
    return token.raw;
}

// After COMMIT. Waits for the provider (the owner sees the honest result) and stores it only if
// this exact generation (token hash) is still the current one and still PENDING.
async function sendInvitationEmail(job) {
    const work = (async () => {
        const message = buildInvitationEmail({ kind: job.kind, locale: job.locale, clinicName: job.clinicName, role: job.role, raw: job.raw });
        const outcome = await deliver({ to: job.email, subject: message.subject, text: message.text, purpose: `INVITATION_${job.kind}` });
        const status = outcome.status === "SENT" ? "SENT" : outcome.status === "SKIPPED" ? "SKIPPED" : "FAILED";
        const stored = await prisma.clinicInvitation.updateMany({
            where: { id: job.id, tokenHash: job.tokenHash, deliveryStatus: "PENDING" },
            data: { deliveryStatus: status, deliveryError: status === "FAILED" ? outcome.code || "FAILED" : null },
        });
        if (stored.count === 1 && status === "FAILED") {
            logger.warn({ invitationId: job.id, code: outcome.code }, "Invitation email delivery failed");
            await recordAudit(prisma, {
                actorUserId: null,
                clinicId: job.clinicId,
                action: "invitation.delivery_failed",
                targetType: "invitation",
                targetId: job.id,
                metadata: { invitationId: job.id, code: outcome.code || "FAILED" },
            });
        }
        return stored.count === 1 ? status.toLowerCase() : "pending";
    })();
    return background.track(work).then(() => work.catch(() => "pending"));
}

function jobFor(invitation, raw, clinic) {
    return {
        id: invitation.id,
        clinicId: invitation.clinicId,
        tokenHash: hashToken(raw),
        raw,
        kind: invitation.kind,
        email: invitation.email,
        role: invitation.role,
        clinicName: clinic.name,
        locale: clinic.defaultLocale,
    };
}

async function createInvitation(tenant, { input, ipAddress }) {
    const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const clinic = await lockClinic(tx, tenant.clinicId);
        if (!clinic) throw notFound();
        // Only this clinic's own members are looked at, so this reveals nothing new to the owner.
        const member = await tx.clinicMember.findFirst({ where: { clinicId: clinic.id, user: { email: input.email } }, select: { trustState: true } });
        if (member) {
            throw member.trustState === "LEGACY_UNREVIEWED"
                ? new AppError(409, "MEMBER_NEEDS_RECONFIRMATION", "This person is already a member. Ask them to re-confirm their access instead.")
                : new AppError(409, "MEMBER_EXISTS", "That person is already a member of this clinic.");
        }

        const key = activeKey("n", clinic.id, input.email);
        const existing = await lockInvitationByKey(tx, key);
        let invitationId;
        let raw;
        if (existing) {
            raw = await rotate(tx, existing, now, { role: input.role });
            invitationId = existing.id;
        } else {
            takeRecipientQuota(clinic.id, input.email);
            const token = generateToken();
            const created = await tx.clinicInvitation.create({
                data: {
                    clinicId: clinic.id,
                    kind: "NEW_MEMBER",
                    email: input.email,
                    role: input.role,
                    activeKey: key,
                    tokenHash: token.hash,
                    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
                    invitedByUserId: tenant.userId,
                    lastSentAt: now,
                    createdAt: now,
                },
                select: { id: true },
            });
            raw = token.raw;
            invitationId = created.id;
        }
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: clinic.id,
            action: existing ? "invitation.resent" : "invitation.created",
            targetType: "invitation",
            targetId: invitationId,
            metadata: { invitationId, kind: "NEW_MEMBER", role: input.role, emailHint: maskEmail(input.email) },
            ipAddress,
        });
        const invitation = await tx.clinicInvitation.findUnique({ where: { id: invitationId }, select: invitationSelect });
        return { invitation, job: jobFor(invitation, raw, clinic) };
    }, txOptions);
    const delivery = await sendInvitationEmail(result.job);
    return { invitation: { ...present(result.invitation), delivery }, delivery };
}

async function listInvitations(tenant) {
    const rows = await prisma.clinicInvitation.findMany({
        where: { clinicId: tenant.clinicId, status: "PENDING" },
        select: invitationSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
    });
    const now = new Date();
    return { items: rows.map((row) => present(row, now)) };
}

async function resendInvitation(tenant, invitationId, { ipAddress }) {
    const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const clinic = await lockClinic(tx, tenant.clinicId);
        if (!clinic) throw notFound();
        const invitation = await lockInvitationById(tx, clinic.id, invitationId);
        if (!invitation) throw notFound();
        if (invitation.status !== "PENDING") throw noLongerValid();
        let extra = {};
        if (invitation.kind === "RECONFIRM") {
            const member = await lockMember(tx, clinic.id, invitation.memberId);
            if (!member || member.status !== "ACTIVE" || member.trustState !== "LEGACY_UNREVIEWED") {
                throw new AppError(409, "RECONFIRM_NOT_ALLOWED", "This membership no longer needs re-confirmation.");
            }
            extra = { email: member.email, role: member.role };
        }
        const raw = await rotate(tx, invitation, now, extra);
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: clinic.id,
            action: "invitation.resent",
            targetType: "invitation",
            targetId: invitation.id,
            metadata: { invitationId: invitation.id, kind: invitation.kind, emailHint: maskEmail(extra.email || invitation.email) },
            ipAddress,
        });
        const fresh = await tx.clinicInvitation.findUnique({ where: { id: invitation.id }, select: invitationSelect });
        return { invitation: fresh, job: jobFor(fresh, raw, clinic) };
    }, txOptions);
    const delivery = await sendInvitationEmail(result.job);
    return { invitation: { ...present(result.invitation), delivery }, delivery };
}

async function revokeInvitation(tenant, invitationId, { ipAddress }) {
    const invitation = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const clinic = await lockClinic(tx, tenant.clinicId);
        if (!clinic) throw notFound();
        const current = await lockInvitationById(tx, clinic.id, invitationId);
        if (!current) throw notFound();
        if (current.status !== "PENDING") throw noLongerValid();
        await tx.clinicInvitation.update({
            where: { id: current.id },
            data: { status: "REVOKED", revokedAt: now, revokedByUserId: tenant.userId, activeKey: null },
        });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: clinic.id,
            action: "invitation.revoked",
            targetType: "invitation",
            targetId: current.id,
            metadata: { invitationId: current.id, kind: current.kind, emailHint: maskEmail(current.email) },
            ipAddress,
        });
        return tx.clinicInvitation.findUnique({ where: { id: current.id }, select: invitationSelect });
    }, txOptions);
    return { invitation: present(invitation) };
}

async function lockMember(tx, clinicId, memberId) {
    const rows = await tx.$queryRaw`SELECT id FROM clinic_members WHERE id = ${memberId} AND clinic_id = ${clinicId} FOR UPDATE`;
    if (rows.length === 0) return null;
    const member = await tx.clinicMember.findUnique({
        where: { id: memberId },
        select: { id: true, clinicId: true, userId: true, role: true, status: true, trustState: true, user: { select: { email: true } } },
    });
    return member && { ...member, email: member.user.email };
}

// Owner (trusted, members:manage) or verified Super Admin bootstrap (asAdmin) asks a legacy member
// to re-confirm. Neither can grant trust: only the member accepting the emailed link does.
async function requestReconfirmation({ clinicId, memberId, actorUserId, ipAddress, asAdmin = false }) {
    const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const clinic = await lockClinic(tx, clinicId);
        if (!clinic) throw notFound();
        if (clinic.status !== "ACTIVE") throw new AppError(409, "CLINIC_NOT_ACTIVE", "This clinic is suspended.");
        const member = await lockMember(tx, clinicId, memberId);
        if (!member) throw notFound();
        if (member.status !== "ACTIVE" || member.trustState !== "LEGACY_UNREVIEWED") {
            throw new AppError(409, "RECONFIRM_NOT_ALLOWED", "This membership doesn't need re-confirmation.");
        }
        if (asAdmin) {
            if (member.role !== "OWNER") throw new AppError(409, "RECONFIRM_NOT_ALLOWED", "Only an owner can be re-confirmed from the platform console.");
            const trustedOwners = await tx.clinicMember.count({ where: { clinicId, role: "OWNER", status: "ACTIVE", trustState: "TRUSTED" } });
            if (trustedOwners > 0) {
                throw new AppError(409, "CLINIC_HAS_TRUSTED_OWNER", "This clinic already has a trusted owner, who re-confirms the rest of the team.");
            }
        }
        const key = activeKey("r", clinicId, memberId);
        const existing = await lockInvitationByKey(tx, key);
        let invitationId;
        let raw;
        if (existing) {
            raw = await rotate(tx, existing, now, { email: member.email, role: member.role });
            invitationId = existing.id;
        } else {
            takeRecipientQuota(clinicId, member.email);
            const token = generateToken();
            const created = await tx.clinicInvitation.create({
                data: {
                    clinicId,
                    kind: "RECONFIRM",
                    memberId,
                    email: member.email,
                    role: member.role,
                    activeKey: key,
                    tokenHash: token.hash,
                    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
                    invitedByUserId: actorUserId,
                    lastSentAt: now,
                    createdAt: now,
                },
                select: { id: true },
            });
            raw = token.raw;
            invitationId = created.id;
        }
        await recordAudit(tx, {
            actorUserId,
            clinicId,
            action: asAdmin ? "admin.owner_reconfirmation_requested" : existing ? "invitation.resent" : "invitation.created",
            targetType: "member",
            targetId: memberId,
            metadata: { memberId, invitationId, kind: "RECONFIRM", role: member.role, emailHint: maskEmail(member.email) },
            ipAddress,
        });
        const invitation = await tx.clinicInvitation.findUnique({ where: { id: invitationId }, select: invitationSelect });
        return { invitation, job: jobFor(invitation, raw, clinic) };
    }, txOptions);
    const delivery = await sendInvitationEmail(result.job);
    return { invitation: { ...present(result.invitation), delivery }, delivery };
}

async function previewInvitation(raw, viewerUserId = null) {
    if (!isWellFormedToken(raw)) throw invalid();
    const invitation = await prisma.clinicInvitation.findUnique({
        where: { tokenHash: hashToken(raw) },
        select: { kind: true, email: true, role: true, status: true, expiresAt: true, clinic: { select: { name: true, status: true } } },
    });
    if (!invitation || invitation.clinic.status !== "ACTIVE") throw invalid();
    if (invitation.status !== "PENDING") throw noLongerValid();
    if (invitation.expiresAt <= new Date()) throw expiredError();
    let viewer = null;
    if (viewerUserId) {
        const user = await prisma.user.findUnique({ where: { id: viewerUserId }, select: { email: true, emailVerifiedAt: true } });
        if (user) viewer = { matchesInvitation: user.email === invitation.email, emailVerified: user.emailVerifiedAt !== null };
    }
    return {
        clinic: { name: invitation.clinic.name },
        kind: invitation.kind,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        emailHint: maskEmail(invitation.email),
        viewer,
    };
}

// accept / decline share the lookup and checks; `decision` is "accept" or "decline".
async function respondToInvitation(userId, raw, decision, { ipAddress }) {
    if (!isWellFormedToken(raw)) throw invalid();
    const tokenHash = hashToken(raw);
    const found = await prisma.clinicInvitation.findUnique({ where: { tokenHash }, select: { id: true, clinicId: true } });
    if (!found) throw invalid();

    return prisma.$transaction(async (tx) => {
        const now = new Date();
        const clinic = await lockClinic(tx, found.clinicId);
        if (!clinic || clinic.status !== "ACTIVE") throw invalid();
        // Re-match the hash under the lock: a resend in between rotated the token, and the old link is dead.
        const locked = await tx.$queryRaw`SELECT id FROM clinic_invitations WHERE id = ${found.id} AND token_hash = ${tokenHash} FOR UPDATE`;
        if (locked.length === 0) throw invalid();
        const invitation = await tx.clinicInvitation.findUnique({ where: { id: found.id }, select: invitationSelect });
        if (invitation.status !== "PENDING") throw noLongerValid();
        if (invitation.expiresAt <= now) throw expiredError();

        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true } });
        if (!user) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue.");
        if (!user.emailVerifiedAt) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address first.");
        if (user.email !== invitation.email) {
            throw new AppError(403, "INVITATION_EMAIL_MISMATCH", "This invitation was sent to a different email address. Log in with that address.");
        }
        const proofUser = { id: user.id, email: user.email, emailVerified: true };

        if (decision === "decline") {
            await tx.clinicInvitation.update({ where: { id: invitation.id }, data: { status: "DECLINED", declinedAt: now, declinedByUserId: user.id, activeKey: null } });
            await recordAudit(tx, {
                actorUserId: user.id,
                clinicId: clinic.id,
                action: "invitation.declined",
                targetType: "invitation",
                targetId: invitation.id,
                metadata: { invitationId: invitation.id, kind: invitation.kind },
                ipAddress,
            });
            return { declined: true };
        }

        let member = null;
        if (invitation.kind === "RECONFIRM") {
            member = await lockMember(tx, clinic.id, invitation.memberId);
            if (!member || member.userId !== user.id || member.status !== "ACTIVE" || member.trustState !== "LEGACY_UNREVIEWED" || member.role !== invitation.role) {
                throw new AppError(409, "INVITATION_STALE", "This membership changed since the request was sent. Ask the clinic to send a new one.");
            }
        } else {
            const existing = await tx.$queryRaw`SELECT id, trust_state AS trustState FROM clinic_members WHERE clinic_id = ${clinic.id} AND user_id = ${user.id} FOR UPDATE`;
            if (existing.length > 0) {
                throw existing[0].trustState === "LEGACY_UNREVIEWED"
                    ? new AppError(409, "MEMBER_NEEDS_RECONFIRMATION", "You're already a member of this clinic; ask the clinic for a re-confirmation link.")
                    : new AppError(409, "MEMBER_EXISTS", "You're already a member of this clinic.");
            }
        }

        const accepted = await tx.clinicInvitation.update({
            where: { id: invitation.id },
            data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: user.id, activeKey: null },
            select: invitationSelect,
        });
        await recordAudit(tx, {
            actorUserId: user.id,
            clinicId: clinic.id,
            action: "invitation.accepted",
            targetType: "invitation",
            targetId: invitation.id,
            metadata: { invitationId: invitation.id, kind: invitation.kind, role: invitation.role },
            ipAddress,
        });

        if (invitation.kind === "RECONFIRM") {
            await trust.trustReconfirmedMembership(tx, { invitation: accepted, member, user: proofUser, now });
            await recordAudit(tx, {
                actorUserId: user.id,
                clinicId: clinic.id,
                action: "member.reconfirmed",
                targetType: "member",
                targetId: member.id,
                metadata: { memberId: member.id, invitationId: invitation.id, role: member.role },
                ipAddress,
            });
        } else {
            const created = await trust.createInvitedMembership(tx, { invitation: accepted, user: proofUser, now });
            await recordAudit(tx, {
                actorUserId: user.id,
                clinicId: clinic.id,
                action: "member.added",
                targetType: "member",
                targetId: created.id,
                metadata: { via: "invitation", invitationId: invitation.id, userId: user.id, role: invitation.role },
                ipAddress,
            });
        }
        return { clinic: { slug: clinic.slug, name: clinic.name }, role: invitation.role, kind: invitation.kind };
    }, txOptions);
}

async function listOwnersForAdmin(clinicId) {
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
    if (!clinic) throw notFound();
    const owners = await prisma.clinicMember.findMany({
        where: { clinicId, role: "OWNER" },
        select: { id: true, status: true, trustState: true, createdAt: true, user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } } },
        orderBy: { id: "asc" },
        take: 50,
    });
    return {
        items: owners.map((owner) => ({
            memberId: owner.id,
            status: owner.status,
            trustState: owner.trustState,
            createdAt: owner.createdAt.toISOString(),
            user: { id: owner.user.id, name: owner.user.name, emailHint: maskEmail(owner.user.email), emailVerified: owner.user.emailVerifiedAt !== null },
        })),
    };
}

module.exports = {
    INVITATION_TTL_MS,
    COOLDOWN_MS,
    activeKey,
    deliveryOf,
    present,
    createInvitation,
    listInvitations,
    resendInvitation,
    revokeInvitation,
    requestReconfirmation,
    previewInvitation,
    respondToInvitation,
    listOwnersForAdmin,
    recipientQuota,
};
