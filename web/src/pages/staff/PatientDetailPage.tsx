import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { patientsApi } from "@/api/endpoints";
import { ErrorPanel, PageHeader, Section, SkeletonRows } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ledger/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { formatDateTime } from "@/lib/format";
import { PatientForm } from "./PatientsPage";
import { NotAllowed } from "./StaffIndex";

export default function PatientDetailPage() {
    const { patientId } = useParams();
    const id = Number(patientId);
    const { t, pick, locale } = useI18n();
    const { slug, zone, can } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();

    const query = useQuery({ queryKey: ["staff", slug, "patients", "one", id], queryFn: () => patientsApi.get(slug, id), enabled: Number.isInteger(id) && can("patients:read") });
    const save = useMutation({
        mutationFn: (values: { fullName: string; phone: string | null; email: string | null }) => patientsApi.update(slug, id, values),
        onSuccess: () => {
            notify(t("patients.saved"));
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "patients"] });
        },
    });

    if (!can("patients:read")) return <NotAllowed />;
    if (query.isPending) return <SkeletonRows rows={4} />;
    if (query.isError) return <ErrorPanel error={query.error} onRetry={() => query.refetch()} />;
    const patient = query.data.patient;

    return (
        <div className="max-w-4xl">
            <p className="mb-2 text-sm">
                <Link to={`/c/${slug}/patients`} className="text-malachite-deep hover:underline">
                    {t("patients.title")}
                </Link>
            </p>
            <PageHeader title={patient.fullName} description={patient.hasAccount ? t("appt.hasAccount") : t("appt.walkIn")} />
            <div className="grid gap-6 lg:grid-cols-2">
                <Section title={t("common.details")}>
                    {can("patients:manage") ? (
                        <PatientForm
                            key={patient.updatedAt}
                            initial={{ fullName: patient.fullName, phone: patient.phone ?? "", email: patient.email ?? "" }}
                            submitLabel={t("common.save")}
                            pending={save.isPending}
                            error={save.error}
                            onSubmit={(v) => save.mutate(v)}
                        />
                    ) : (
                        <p>{patient.phone}</p>
                    )}
                </Section>
                <Section title={t("patients.recent")}>
                    {(patient.recentAppointments ?? []).length === 0 ? (
                        <p className="text-sm text-graphite">{t("patients.noRecent")}</p>
                    ) : (
                        <ul>
                            {patient.recentAppointments!.map((a) => (
                                <li key={a.id} className="ledger-rule flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                                    <span>
                                        <span className="tabular block font-medium">{formatDateTime(a.startsAt, zone, locale)}</span>
                                        <span className="text-graphite">
                                            {pick(a.service.nameEn, a.service.nameAr)} · {pick(a.doctor.displayNameEn, a.doctor.displayNameAr)}
                                        </span>
                                    </span>
                                    <StatusBadge status={a.status} />
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            </div>
        </div>
    );
}
