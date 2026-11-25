// Append-only audit trail for sensitive actions. Pass the transaction client so the
// audit row commits or rolls back together with the change it describes.
function recordAudit(db, { actorUserId, clinicId = null, action, targetType = null, targetId = null, metadata = null, ipAddress = null }) {
    return db.auditLog.create({
        data: {
            actorUserId,
            clinicId,
            action,
            targetType,
            targetId: targetId === null ? null : String(targetId),
            metadata,
            ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
        },
    });
}

module.exports = { recordAudit };
