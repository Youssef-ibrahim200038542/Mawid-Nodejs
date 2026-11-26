import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { scheduleApi } from "@/api/endpoints";
import type { WeeklyInterval } from "@/api/types";
import { EmptyState, ErrorPanel, PageHeader, Section, SkeletonRows } from "@/components/ui/primitives";
import { WeeklyHoursEditor } from "@/components/staff/WeeklyHoursEditor";
import { ExceptionsManager } from "@/components/staff/ExceptionsManager";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";

// A doctor's own hours and leave (schedule:manage_own). The API checks ownership again.
export default function MySchedulePage() {
    const { t } = useI18n();
    const { slug, clinic } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const doctorId = clinic.doctorProfileId;
    const key = ["staff", slug, "hours", "doctor", doctorId];
    const hours = useQuery({ queryKey: key, queryFn: () => scheduleApi.doctorHours(slug, doctorId!), enabled: doctorId !== null });
    const save = useMutation({
        mutationFn: (intervals: WeeklyInterval[]) => scheduleApi.setDoctorHours(slug, doctorId!, intervals),
        onSuccess: (data) => {
            queryClient.setQueryData(key, data);
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
            notify(t("hours.saved"));
        },
    });

    if (doctorId === null) return <EmptyState title={t("mySchedule.title")} body={t("mySchedule.noProfile")} />;
    return (
        <div className="max-w-4xl">
            <PageHeader title={t("mySchedule.title")} description={t("hours.doctorHoursHelp")} />
            <div className="flex flex-col gap-6">
                <Section title={t("doctors.hours")}>
                    {hours.isPending ? <SkeletonRows rows={3} /> : hours.isError ? <ErrorPanel error={hours.error} onRetry={() => hours.refetch()} /> : <WeeklyHoursEditor intervals={hours.data.intervals} onSave={(i) => save.mutate(i)} saving={save.isPending} error={save.error} />}
                </Section>
                <Section title={t("doctors.exceptions")}>
                    <ExceptionsManager doctorId={doctorId} scopes={[{ value: doctorId, label: clinic.role === "OWNER" ? t("mySchedule.title") : t("mySchedule.title") }]} canDelete={(id) => id === doctorId || clinic.role === "OWNER"} />
                </Section>
            </div>
        </div>
    );
}
