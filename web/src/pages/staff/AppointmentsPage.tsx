import { useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarPlus } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { appointmentsApi, doctorsApi } from "@/api/endpoints";
import type { Appointment, AppointmentStatus } from "@/api/types";
import { ButtonLink, Dialog, EmptyState, ErrorPanel, Field, PageHeader, Pagination, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { StatusBadge, statusAccent } from "@/components/ledger/StatusBadge";
import { AppointmentPanel } from "@/components/staff/AppointmentPanel";
import { useStaff } from "@/layouts/StaffLayout";
import { addDays, formatDate, formatMoney, formatTime, todayIn } from "@/lib/format";
import { cx } from "@/lib/cx";

const statuses: AppointmentStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"];

export default function AppointmentsPage() {
    const { t, pick, locale } = useI18n();
    const { slug, zone, can, clinic } = useStaff();
    const [params, setParams] = useSearchParams();
    const today = todayIn(zone);
    const from = params.get("from") || today;
    const to = params.get("to") || addDays(from, 6, zone);
    const status = (params.get("status") as AppointmentStatus | null) || undefined;
    const doctorId = Number(params.get("doctor")) || undefined;
    const page = Number(params.get("page")) || 1;
    const focusId = Number(params.get("focus")) || null;
    const [selected, setSelected] = useState<Appointment | null>(null);

    const set = (changes: Record<string, string | undefined>) => {
        const next = new URLSearchParams(params);
        for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
        if (!("page" in changes)) next.delete("page");
        setParams(next, { replace: true });
    };

    const list = useQuery({
        queryKey: ["staff", slug, "appointments", "list", from, to, status, doctorId, page],
        queryFn: () => appointmentsApi.list(slug, { from, to, status, doctorId, page, pageSize: 25 }),
        placeholderData: keepPreviousData,
    });
    const doctors = useQuery({ queryKey: ["staff", slug, "doctors", "active"], queryFn: () => doctorsApi.list(slug, { pageSize: 100 }), enabled: clinic.role !== "DOCTOR" });
    // Deep link from a notification: /appointments?focus=<id>
    const focused = useQuery({ queryKey: ["staff", slug, "appointments", "one", focusId], queryFn: () => appointmentsApi.get(slug, focusId!), enabled: Boolean(focusId) });
    const open = selected ?? focused.data?.appointment ?? null;

    return (
        <div>
            <PageHeader
                title={t("appt.listTitle")}
                actions={
                    can("appointments:create") && (
                        <ButtonLink to={`/c/${slug}/appointments/new`} variant="primary">
                            <CalendarPlus aria-hidden size={18} /> {t("staffNav.newBooking")}
                        </ButtonLink>
                    )
                }
            />
            <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("appt.from")}>{(p) => <TextInput {...p} type="date" value={from} onChange={(e) => set({ from: e.target.value || undefined })} />}</Field>
                <Field label={t("appt.to")}>{(p) => <TextInput {...p} type="date" value={to} min={from} onChange={(e) => set({ to: e.target.value || undefined })} />}</Field>
                <Field label={t("appt.status")}>
                    {(p) => (
                        <Select {...p} value={status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
                            <option value="">{t("appt.anyStatus")}</option>
                            {statuses.map((s) => (
                                <option key={s} value={s}>
                                    {t(`status.${s}`)}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
                {clinic.role !== "DOCTOR" && (
                    <Field label={t("appt.doctor")}>
                        {(p) => (
                            <Select {...p} value={doctorId ?? ""} onChange={(e) => set({ doctor: e.target.value || undefined })}>
                                <option value="">{t("appt.anyDoctor")}</option>
                                {(doctors.data?.items ?? []).map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {pick(d.displayNameEn, d.displayNameAr)}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                )}
            </div>

            {list.isPending ? (
                <SkeletonRows rows={6} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.items.length === 0 ? (
                <EmptyState title={t("appt.empty")} />
            ) : (
                <>
                    <ul className="flex flex-col gap-2">
                        {list.data.items.map((a) => (
                            <li key={a.id}>
                                <button
                                    type="button"
                                    onClick={() => setSelected(a)}
                                    className={cx("grid w-full grid-cols-[5.5rem_1fr] items-center gap-x-4 gap-y-1 border-s-4 bg-surface px-4 py-3 text-start ring-1 ring-rule hover:bg-paper md:grid-cols-[5.5rem_1.2fr_1fr_auto]", statusAccent[a.status])}
                                >
                                    <span className="row-span-2 md:row-span-1">
                                        <span className="tabular block text-lg font-semibold">{formatTime(a.startsAt, zone, locale)}</span>
                                        <span className="block text-xs text-graphite">{formatDate(a.startsAt, zone, locale, "short")}</span>
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">{a.patient?.fullName}</span>
                                        <span className="block truncate text-sm text-graphite">{pick(a.service.nameEn, a.service.nameAr)}</span>
                                    </span>
                                    <span className="text-sm text-graphite">
                                        {pick(a.doctor.displayNameEn, a.doctor.displayNameAr)} · <span className="tabular">{formatMoney(a.price, a.currency, locale)}</span>
                                    </span>
                                    <span className="justify-self-start md:justify-self-end">
                                        <StatusBadge status={a.status} />
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) })} />
                </>
            )}

            <Dialog
                open={Boolean(open)}
                onClose={() => {
                    setSelected(null);
                    if (focusId) set({ focus: undefined });
                }}
                title={t("today.selected")}
            >
                {open && <AppointmentPanel key={open.id} appointment={open} onChanged={setSelected} />}
            </Dialog>
            {focused.isError && (
                <div className="mt-4">
                    <ErrorPanel error={focused.error} />
                </div>
            )}
        </div>
    );
}
