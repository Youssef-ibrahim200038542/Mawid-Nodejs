import type { AuditEntry } from "@/api/types";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/lib/format";

// Known audit actions (from the backend) for the filter; unknown ones still render verbatim.
export const auditActions = [
    "clinic.created",
    "clinic.updated",
    "member.added",
    "member.updated",
    "specialty.created",
    "specialty.updated",
    "service.created",
    "service.updated",
    "doctor.created",
    "doctor.updated",
    "doctor.specialties_updated",
    "doctor.services_updated",
    "clinic.working_hours_updated",
    "doctor.working_hours_updated",
    "schedule_exception.created",
    "schedule_exception.deleted",
    "patient.created",
    "patient.updated",
    "appointment.created",
    "appointment.confirmed",
    "appointment.cancelled",
    "appointment.completed",
    "appointment.no_show",
    "appointment.rescheduled",
    "admin.clinic_status_changed",
    "admin.user_role_changed",
];

export function AuditList({ items, zone, showClinic = false }: { items: AuditEntry[]; zone: string; showClinic?: boolean }) {
    const { t, locale } = useI18n();
    return (
        <div className="overflow-x-auto rounded-sheet bg-surface ring-1 ring-rule">
            <table className="w-full min-w-[40rem] text-sm">
                <thead>
                    <tr className="text-xs text-graphite">
                        <th scope="col" className="px-4 py-3 text-start font-medium">{t("audit.when")}</th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">{t("audit.action")}</th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">{t("audit.actor")}</th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">{t("audit.target")}</th>
                        {showClinic && <th scope="col" className="px-4 py-3 text-start font-medium">{t("admin.clinicId")}</th>}
                    </tr>
                </thead>
                <tbody>
                    {items.map((e) => (
                        <tr key={e.id} className="ledger-rule align-top">
                            <td className="tabular whitespace-nowrap px-4 py-3 text-graphite">{formatDateTime(e.createdAt, zone, locale)}</td>
                            <td className="px-4 py-3 font-mono text-xs" dir="ltr">{e.action}</td>
                            <td className="px-4 py-3">{e.actor ? <span title={e.actor.email}>{e.actor.name}</span> : <span className="text-graphite">{t("audit.system")}</span>}</td>
                            <td className="px-4 py-3 text-graphite" dir="ltr">{e.targetType ? `${e.targetType} #${e.targetId}` : "—"}</td>
                            {showClinic && <td className="px-4 py-3 text-graphite">{e.clinicId ?? "—"}</td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
