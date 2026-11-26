// THE ONLY CODE THAT WRITES clinic_members.trust_* (a unit test fails if anything else does).
//
// A membership becomes TRUSTED only through one of three proofs, each checked here inside the
// caller's transaction (which already holds the clinic row lock, then the invitation row lock):
//   CLINIC_CREATOR  — the verified account that creates the clinic, in the same transaction.
//   INVITATION      — an ACCEPTED NEW_MEMBER invitation of this clinic, accepted by this user.
//   RECONFIRMATION  — an ACCEPTED RECONFIRM invitation for exactly this member of this clinic,
//                     accepted by the member's own user, role unchanged.
// The database adds a CHECK (trust fields consistent with the source) and a composite foreign key
// (the invitation belongs to the same clinic). Cross-table facts — invitation accepted, kind matches
// the source, member / user / role match — cannot be expressed as a MariaDB CHECK and are asserted
// here. Nothing (Super Admin included) can mark a membership TRUSTED any other way.

class TrustProofError extends Error {
    constructor(reason) {
        super(`Membership trust refused: ${reason}`);
        this.name = "TrustProofError";
        this.reason = reason;
    }
}

function assertProof(condition, reason) {
    if (!condition) throw new TrustProofError(reason);
}

async function createCreatorMembership(tx, { clinicId, userId, userEmailVerified, now }) {
    assertProof(userEmailVerified, "creator email not verified");
    return tx.clinicMember.create({
        data: { clinicId, userId, role: "OWNER", trustState: "TRUSTED", trustSource: "CLINIC_CREATOR", trustedAt: now },
        select: { id: true, role: true },
    });
}

async function createInvitedMembership(tx, { invitation, user, now }) {
    assertProof(invitation.kind === "NEW_MEMBER", "wrong invitation kind");
    assertProof(invitation.status === "ACCEPTED" && invitation.acceptedByUserId === user.id, "invitation not accepted by this user");
    assertProof(user.emailVerified && user.email === invitation.email, "email not verified or not the invited address");
    return tx.clinicMember.create({
        data: {
            clinicId: invitation.clinicId,
            userId: user.id,
            role: invitation.role,
            trustState: "TRUSTED",
            trustSource: "INVITATION",
            trustedAt: now,
            trustedViaInvitationId: invitation.id,
        },
        select: { id: true, role: true },
    });
}

async function trustReconfirmedMembership(tx, { invitation, member, user, now }) {
    assertProof(invitation.kind === "RECONFIRM" && invitation.memberId === member.id, "invitation is not for this member");
    assertProof(invitation.clinicId === member.clinicId, "clinic mismatch");
    assertProof(invitation.status === "ACCEPTED" && invitation.acceptedByUserId === user.id, "invitation not accepted by this user");
    assertProof(member.userId === user.id, "member belongs to another user");
    assertProof(user.emailVerified && user.email === invitation.email, "email not verified or not the invited address");
    assertProof(member.status === "ACTIVE" && member.trustState === "LEGACY_UNREVIEWED", "membership not awaiting re-confirmation");
    assertProof(member.role === invitation.role, "role changed");
    const updated = await tx.clinicMember.updateMany({
        where: { id: member.id, clinicId: member.clinicId, trustState: "LEGACY_UNREVIEWED", status: "ACTIVE", role: invitation.role },
        data: { trustState: "TRUSTED", trustSource: "RECONFIRMATION", trustedAt: now, trustedViaInvitationId: invitation.id },
    });
    assertProof(updated.count === 1, "membership changed concurrently");
}

module.exports = { createCreatorMembership, createInvitedMembership, trustReconfirmedMembership, TrustProofError };
