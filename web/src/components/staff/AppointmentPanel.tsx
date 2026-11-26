import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, EnvelopeSimple, UserCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { appointmentsApi, doctorsApi } from "@/api/endpoints";
import type { Appointment } from "@/api/types";
import { Button, Dialog, ErrorSummary, Field, TextArea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { StatusBadge } from "@/components/ledger/StatusBadge";
import { TimePickerDialog } from "@/components/ledger/TimePickerDialog";
import { useStaff } from "@/layouts/StaffLayout";
import { formatDate, formatDateTime, formatMoney, formatTime } from "@/lib/format";

export function useInvalidateAppointments() {
    const queryClient = useQueryClient();
    const { slug } = useStaff();
    return () => {
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "appointments"] });
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "analytics"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="ledger-rule flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
            <dt className="text-graphite">{label}</dt>
            <dd className="text-end">{children}</dd>
        </div>
    );
}

export function AppointmentPanel({ appointment, onChanged }: { appointment: Appointment; onChanged?: (a: Appointment) => void }) {
    const { t, pick, locale, errorMessage } = useI18n();
    const { slug, zone, can, clinic } = useStaff();
    const { notify } = useToast();
    const invalidate = useInvalidateAppointments();
    const [cancelOpen, setCancelOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [reason, setReason] = useState("");

    const ownDoctor = clinic.doctorProfileId !== null && clinic.doctorProfileId === appointment.doctor.id;
    const canManage = can("appointments:manage");
    const canUpdate = canManage || (can("appointments:update_own") && ownDoctor);
    const started = new Date(appointment.startsAt).getTime() <= Date.now();

    const doctors = useQuery({
        queryKey: ["staff", slug, "doctors", "for-service", appointment.service.id],
        queryFn: () => doctorsApi.list(slug, { serviceId: appointment.service.id, pageSize: 100 }),
        enabled: moveOpen,
    });

    const run = useMutation({
        mutationFn: async (action: "confirm" | "complete" | "noShow" | "cancel" | { startsAt: string; doctorId: number }) => {
            if (typeof action === "object") return appointmentsApi.reschedule(slug, appointment.id, action);
            if (action === "cancel") return appointmentsApi.cancel(slug, appointment.id, reason.trim() || null);
            return appointmentsApi[action](slug, appointment.id);
        },
        onSuccess: ({ appointment: updated }, action) => {
            const message =
                typeof action === "object"
                    ? t("appt.moved")
                    : { confirm: t("appt.confirmed"), complete: t("appt.completed"), noShow: t("appt.noShowDone"), cancel: t("appt.cancelledDone") }[action];
            notify(message);
            setCancelOpen(false);
            setMoveOpen(false);
            setReason("");
            invalidate();
            onChanged?.(updated);
        },
    });

    const busy = run.isPending;
    const p = appointment.patient;

    return (
        <div>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="tabular text-3xl font-semibold leading-none">
                        {formatTime(appointment.startsAt, zone, locale)}
                        <span className="text-lg text-graphite"> → {formatTime(appointment.endsAt, zone, locale)}</span>
                    </p>
                    <p className="mt-1.5 text-sm text-graphite">{formatDate(appointment.startsAt, zone, locale)}</p>
                </div>
                <StatusBadge status={appointment.status} />
            </div>

            {run.isError && !cancelOpen && !moveOpen && (
                <div className="mt-4">
                    <ErrorSummary message={errorMessage(run.error)} />
                </div>
            )}

            <dl className="mt-4">
                {p && (
                    <Row label={t("appt.patient")}>
                        <span className="font-medium">{p.fullName}</span>
                        <span className="block text-xs text-graphite">
                            <UserCircle aria-hidden size={14} className="me-1 inline" />
                            {p.hasAccount ? t("appt.hasAccount") : t("appt.walkIn")}
                        </span>
                    </Row>
                )}
                {p && (p.phone || p.email) && (
                    <Row label={t("appt.contact")}>
                        {p.phone && (
                            <a href={`tel:${p.phone}`} dir="ltr" className="inline-flex min-h-8 items-center gap-1.5 hover:underline">
                                <Phone aria-hidden size={14} /> {p.phone}
                            </a>
                        )}
                        {p.email && (
                            <a href={`mailto:${p.email}`} className="flex min-h-8 items-center justify-end gap-1.5 hover:underline">
                                <EnvelopeSimple aria-hidden size={14} /> {p.email}
                            </a>
                        )}
                    </Row>
                )}
                <Row label={t("appt.service")}>{pick(appointment.service.nameEn, appointment.service.nameAr)}</Row>
                <Row label={t("appt.doctor")}>{pick(appointment.doctor.displayNameEn, appointment.doctor.displayNameAr)}</Row>
                <Row label={t("appt.price")}>
                    <span className="tabular">{formatMoney(appointment.price, appointment.currency, locale)}</span>
                </Row>
                <Row label={t("appt.source")}>
                    {t(`appt.${appointment.source}`)}
                    {appointment.rescheduleCount > 0 && <span className="block text-xs text-graphite">{t("appt.rescheduled", { n: appointment.rescheduleCount })}</span>}
                </Row>
                {appointment.note && <Row label={t("appt.note")}>{appointment.note}</Row>}
                {appointment.cancellationReason && <Row label={t("status.CANCELLED")}>{appointment.cancellationReason}</Row>}
                {appointment.cancelledAt && <Row label={t("status.CANCELLED")}>{formatDateTime(appointment.cancelledAt, zone, locale)}</Row>}
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
                {appointment.status === "PENDING" && canUpdate && (
                    <Button variant="primary" loading={busy && run.variables === "confirm"} disabled={busy} onClick={() => run.mutate("confirm")}>
                        {t("appt.confirm")}
                    </Button>
                )}
                {appointment.status === "CONFIRMED" && canUpdate && (
                    <>
                        <Button variant="ink" disabled={busy || !started} title={!started ? t("appt.startsLater") : undefined} onClick={() => run.mutate("complete")}>
                            {t("appt.complete")}
                        </Button>
                        <Button disabled={busy || !started} title={!started ? t("appt.startsLater") : undefined} onClick={() => run.mutate("noShow")}>
                            {t("appt.noShow")}
                        </Button>
                    </>
                )}
                {(appointment.status === "PENDING" || appointment.status === "CONFIRMED") && canManage && (
                    <>
                        <Button disabled={busy} onClick={() => setMoveOpen(true)}>
                            {t("appt.reschedule")}
                        </Button>
                        <Button variant="ghost" className="text-carmine-deep" disabled={busy} onClick={() => setCancelOpen(true)}>
                            {t("appt.cancel")}
                        </Button>
                    </>
                )}
            </div>
            {appointment.status === "CONFIRMED" && canUpdate && !started && <p className="mt-2 text-xs text-graphite">{t("appt.startsLater")}</p>}

            <Dialog
                open={cancelOpen}
                onClose={() => {
                    setCancelOpen(false);
                    run.reset();
                }}
                title={t("appt.cancelTitle")}
                footer={
                    <>
                        <Button onClick={() => setCancelOpen(false)}>{t("common.back")}</Button>
                        <Button variant="danger" loading={busy} onClick={() => run.mutate("cancel")}>
                            {t("appt.confirmCancel")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    {run.isError && <ErrorSummary message={errorMessage(run.error)} />}
                    <Field label={t("appt.reasonLabel")} optional>
                        {(fp) => <TextArea {...fp} rows={2} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />}
                    </Field>
                </div>
            </Dialog>

            {moveOpen && (
                <TimePickerDialog
                    open
                    onClose={() => {
                        setMoveOpen(false);
                        run.reset();
                    }}
                    title={t("appt.moveTitle")}
                    zone={zone}
                    serviceId={appointment.service.id}
                    doctors={(doctors.data?.items ?? [{ id: appointment.doctor.id, displayNameEn: appointment.doctor.displayNameEn, displayNameAr: appointment.doctor.displayNameAr }]).map((d) => ({
                        id: d.id,
                        name: pick(d.displayNameEn, d.displayNameAr),
                    }))}
                    initialDoctorId={appointment.doctor.id}
                    days={21}
                    queryKey={["staff", slug, "move", appointment.id]}
                    fetcher={(q) => appointmentsApi.availability(slug, q)}
                    onConfirm={(startsAt, doctorId) => run.mutate({ startsAt, doctorId })}
                    submitting={busy}
                    error={run.error}
                />
            )}
        </div>
    );
}
