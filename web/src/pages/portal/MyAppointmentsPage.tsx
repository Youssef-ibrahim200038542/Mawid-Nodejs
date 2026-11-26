import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarBlank } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { meApi, publicApi } from "@/api/endpoints";
import type { Appointment } from "@/api/types";
import { Button, ButtonLink, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, Pagination, Segmented, SkeletonRows, TextArea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { StatusBadge, statusAccent } from "@/components/ledger/StatusBadge";
import { TimePickerDialog } from "@/components/ledger/TimePickerDialog";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { cx } from "@/lib/cx";

const changeWindowMs = 2 * 3_600_000; // mirrors booking-policy.patientChangeMinHours

function AppointmentRow({ appointment, onCancel, onReschedule }: { appointment: Appointment; onCancel?: () => void; onReschedule?: () => void }) {
    const { t, pick, locale } = useI18n();
    const zone = appointment.timezone;
    const active = appointment.status === "PENDING" || appointment.status === "CONFIRMED";
    const tooLate = new Date(appointment.startsAt).getTime() - Date.now() < changeWindowMs;
    return (
        <li className={cx("flex flex-col gap-3 border-s-4 bg-surface p-4 ring-1 ring-rule sm:flex-row sm:items-center sm:gap-6", statusAccent[appointment.status])}>
            <div className="sm:w-28">
                <p className="tabular text-2xl font-semibold leading-none">{formatTime(appointment.startsAt, zone, locale)}</p>
                <p className="mt-1 text-sm text-graphite">{formatDate(appointment.startsAt, zone, locale, "short")}</p>
            </div>
            <div className="min-w-0 flex-1">
                <p className="font-medium">
                    {pick(appointment.service.nameEn, appointment.service.nameAr)} · {pick(appointment.doctor.displayNameEn, appointment.doctor.displayNameAr)}
                </p>
                {appointment.clinic && (
                    <Link to={`/clinics/${appointment.clinic.slug}`} className="text-sm text-malachite-deep hover:underline">
                        {appointment.clinic.name}
                    </Link>
                )}
                <p className="tabular mt-1 text-sm text-graphite">
                    {t("common.minutes", { n: appointment.durationMinutes })} · {formatMoney(appointment.price, appointment.currency, locale)}
                </p>
                {appointment.cancellationReason && <p className="mt-1 text-sm text-graphite">{t("appt.cancelReason", { reason: appointment.cancellationReason })}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={appointment.status} />
                {active && onReschedule && onCancel && (
                    <>
                        <Button size="sm" onClick={onReschedule} disabled={tooLate} title={tooLate ? t("portal.changeClosed") : undefined}>
                            {t("portal.reschedule")}
                        </Button>
                        <Button size="sm" variant="dangerGhost" onClick={onCancel} disabled={tooLate} title={tooLate ? t("portal.changeClosed") : undefined}>
                            {t("portal.cancel")}
                        </Button>
                    </>
                )}
            </div>
            {active && tooLate && <p className="text-xs text-graphite sm:hidden">{t("portal.changeClosed")}</p>}
        </li>
    );
}

export default function MyAppointmentsPage() {
    const { t, pick, errorMessage } = useI18n();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
    const [page, setPage] = useState(1);
    const [cancelling, setCancelling] = useState<Appointment | null>(null);
    const [moving, setMoving] = useState<Appointment | null>(null);
    const [reason, setReason] = useState("");

    const query = useQuery({
        queryKey: ["me", "appointments", scope, page],
        queryFn: () => meApi.appointments({ scope, page, pageSize: 20 }),
        placeholderData: keepPreviousData,
    });
    const clinicQuery = useQuery({
        queryKey: ["public", moving?.clinic?.slug, "clinic"],
        queryFn: () => publicApi.clinic(moving!.clinic!.slug),
        enabled: Boolean(moving?.clinic),
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ["me", "appointments"] });
    const cancel = useMutation({
        mutationFn: () => meApi.cancel(cancelling!.id, reason.trim() || null),
        onSuccess: () => {
            notify(t("portal.cancelled"));
            setCancelling(null);
            setReason("");
            refresh();
        },
    });
    const reschedule = useMutation({
        mutationFn: ({ startsAt, doctorId }: { startsAt: string; doctorId: number }) => meApi.reschedule(moving!.id, { startsAt, doctorId }),
        onSuccess: () => {
            notify(t("portal.rescheduled"));
            setMoving(null);
            refresh();
        },
    });

    const doctorsForService =
        moving && clinicQuery.data
            ? clinicQuery.data.doctors.filter((d) => d.serviceIds.includes(moving.service.id)).map((d) => ({ id: d.id, name: pick(d.displayNameEn, d.displayNameAr) }))
            : [];

    return (
        <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
            <PageHeader title={t("portal.title")} actions={<ButtonLink to="/clinics">{t("portal.findClinic")}</ButtonLink>} />
            <Segmented
                label={t("portal.title")}
                value={scope}
                onChange={(value) => {
                    setScope(value);
                    setPage(1);
                }}
                options={[
                    { value: "upcoming", label: t("portal.upcoming") },
                    { value: "past", label: t("portal.past") },
                ]}
            />
            <div className="mt-6">
                {query.isPending ? (
                    <SkeletonRows rows={3} />
                ) : query.isError ? (
                    <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
                ) : query.data.items.length === 0 ? (
                    <EmptyState
                        icon={<CalendarBlank size={28} aria-hidden />}
                        title={scope === "upcoming" ? t("portal.emptyUpcoming") : t("portal.emptyPast")}
                        action={scope === "upcoming" && <ButtonLink to="/clinics" variant="primary">{t("portal.findClinic")}</ButtonLink>}
                    />
                ) : (
                    <>
                        <ul className="flex flex-col gap-3">
                            {query.data.items.map((a) => (
                                <AppointmentRow key={a.id} appointment={a} onCancel={() => setCancelling(a)} onReschedule={() => setMoving(a)} />
                            ))}
                        </ul>
                        <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
                    </>
                )}
            </div>

            <Dialog
                open={Boolean(cancelling)}
                onClose={() => {
                    setCancelling(null);
                    cancel.reset();
                }}
                title={t("portal.cancelTitle")}
                footer={
                    <>
                        <Button onClick={() => setCancelling(null)}>{t("common.back")}</Button>
                        <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                            {t("portal.confirmCancel")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-graphite">{t("portal.cancelBody")}</p>
                    {cancel.isError && <ErrorSummary message={errorMessage(cancel.error)} />}
                    <Field label={t("portal.reasonLabel")} optional>
                        {(p) => <TextArea {...p} rows={2} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />}
                    </Field>
                </div>
            </Dialog>

            {moving && moving.clinic && (
                <TimePickerDialog
                    open
                    onClose={() => {
                        setMoving(null);
                        reschedule.reset();
                    }}
                    title={t("portal.rescheduleTitle")}
                    note={t("portal.rescheduleNote")}
                    zone={moving.timezone}
                    serviceId={moving.service.id}
                    doctors={doctorsForService.length ? doctorsForService : [{ id: moving.doctor.id, name: pick(moving.doctor.displayNameEn, moving.doctor.displayNameAr) }]}
                    initialDoctorId={moving.doctor.id}
                    days={14}
                    queryKey={["public", moving.clinic.slug, "reschedule"]}
                    fetcher={(q) => publicApi.availability(moving.clinic!.slug, q)}
                    onConfirm={(startsAt, doctorId) => reschedule.mutate({ startsAt, doctorId })}
                    submitting={reschedule.isPending}
                    error={reschedule.error}
                />
            )}
        </div>
    );
}
