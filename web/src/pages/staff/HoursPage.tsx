import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { doctorsApi, scheduleApi } from "@/api/endpoints";
import type { WeeklyInterval } from "@/api/types";
import { ErrorPanel, PageHeader, Section, SkeletonRows } from "@/components/ui/primitives";
import { WeeklyHoursEditor } from "@/components/staff/WeeklyHoursEditor";
import { ExceptionsManager } from "@/components/staff/ExceptionsManager";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

export default function HoursPage() {
    const { t, pick } = useI18n();
    const { slug, can } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const hours = useQuery({ queryKey: ["staff", slug, "hours", "clinic"], queryFn: () => scheduleApi.clinicHours(slug) });
    const doctors = useQuery({ queryKey: ["staff", slug, "doctors", "all"], queryFn: () => doctorsApi.list(slug, { includeInactive: true, pageSize: 100 }) });
    const save = useMutation({
        mutationFn: (intervals: WeeklyInterval[]) => scheduleApi.setClinicHours(slug, intervals),
        onSuccess: (data) => {
            queryClient.setQueryData(["staff", slug, "hours", "clinic"], data);
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
            notify(t("hours.saved"));
        },
    });

    if (!can("schedule:manage")) return <NotAllowed />;
    const scopes = [{ value: null, label: t("hours.wholeClinic") }, ...(doctors.data?.items ?? []).map((d) => ({ value: d.id, label: pick(d.displayNameEn, d.displayNameAr) }))];

    return (
        <div className="max-w-4xl">
            <PageHeader title={t("hours.title")} />
            <div className="flex flex-col gap-6">
                <Section title={t("hours.clinicHours")}>
                    <p className="mb-3 text-sm text-graphite">{t("hours.clinicHoursHelp")}</p>
                    {hours.isPending ? <SkeletonRows rows={3} /> : hours.isError ? <ErrorPanel error={hours.error} onRetry={() => hours.refetch()} /> : <WeeklyHoursEditor intervals={hours.data.intervals} onSave={(i) => save.mutate(i)} saving={save.isPending} error={save.error} />}
                </Section>
                <Section title={t("hours.exceptionsTitle")}>
                    <ExceptionsManager scopes={scopes} canDelete={() => true} />
                </Section>
            </div>
        </div>
    );
}
