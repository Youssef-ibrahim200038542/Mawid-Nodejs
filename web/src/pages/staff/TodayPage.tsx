import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CaretLeft, CaretRight, CalendarPlus, Clock } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { appointmentsApi, doctorsApi } from "@/api/endpoints";
import type { Appointment } from "@/api/types";
import { Button, ButtonLink, EmptyState, ErrorPanel, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { StatusBadge, statusAccent } from "@/components/ledger/StatusBadge";
import { AppointmentPanel } from "@/components/staff/AppointmentPanel";
import { useStaff } from "@/layouts/StaffLayout";
import { addDays, formatLocalDate, formatTime, todayIn } from "@/lib/format";
import { cx } from "@/lib/cx";

export default function TodayPage() {
    const { t, pick, locale } = useI18n();
    const { slug, zone, can, clinic } = useStaff();
    const [date, setDate] = useState(() => todayIn(zone));
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const isToday = date === todayIn(zone);

    const appointments = useQuery({
        queryKey: ["staff", slug, "appointments", "day", date],
        queryFn: () => appointmentsApi.list(slug, { from: date, to: date, pageSize: 100 }),
        refetchInterval: 60_000,
    });
    const doctors = useQuery({ queryKey: ["staff", slug, "doctors", "active"], queryFn: () => doctorsApi.list(slug, { pageSize: 100 }) });

    // Columns: doctors (a doctor sees only their own column), plus any doctor who has bookings today.
    const columns = useMemo(() => {
        const list = (doctors.data?.items ?? [])
            .filter((d) => clinic.role !== "DOCTOR" || d.id === clinic.doctorProfileId)
            .map((d) => ({ id: d.id, name: pick(d.displayNameEn, d.displayNameAr) }));
        const ids = new Set(list.map((d) => d.id));
        for (const a of appointments.data?.items ?? []) {
            if (!ids.has(a.doctor.id)) {
                ids.add(a.doctor.id);
                list.push({ id: a.doctor.id, name: pick(a.doctor.displayNameEn, a.doctor.displayNameAr) });
            }
        }
        return list;
    }, [doctors.data, appointments.data, clinic, pick]);

    const rows = useMemo(() => {
        const byTime = new Map<string, Appointment[]>();
        for (const a of appointments.data?.items ?? []) {
            const key = a.startsAt;
            byTime.set(key, [...(byTime.get(key) ?? []), a]);
        }
        return [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [appointments.data]);

    const items = appointments.data?.items ?? [];
    const pending = items.filter((a) => a.status === "PENDING").length;
    const selected = items.find((a) => a.id === selectedId) ?? null;

    return (
        <div>
            <PageHeader
                title={isToday ? t("today.title") : formatLocalDate(date, zone, locale, "long")}
                description={isToday ? formatLocalDate(date, zone, locale, "long") : undefined}
                actions={
                    <>
                        <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" aria-label={t("common.previous")} onClick={() => setDate(addDays(date, -1, zone))}>
                                <CaretLeft aria-hidden size={18} className="flip-rtl" />
                            </Button>
                            <Button size="sm" onClick={() => setDate(todayIn(zone))} disabled={isToday}>
                                {t("common.today")}
                            </Button>
                            <Button size="sm" variant="ghost" aria-label={t("common.next")} onClick={() => setDate(addDays(date, 1, zone))}>
                                <CaretRight aria-hidden size={18} className="flip-rtl" />
                            </Button>
                        </div>
                        {can("appointments:create") && (
                            <ButtonLink to={`/c/${slug}/appointments/new?date=${date}`} variant="primary">
                                <CalendarPlus aria-hidden size={18} /> {t("today.bookWalkIn")}
                            </ButtonLink>
                        )}
                    </>
                }
            />

            {pending > 0 && (
                <p className="mb-4 inline-flex items-center gap-2 rounded-control bg-saffron-tint px-3 py-2 text-sm font-medium ring-1 ring-saffron/50">
                    <Clock aria-hidden size={16} weight="bold" /> {t("today.pendingCount", { n: pending })}
                </p>
            )}

            {appointments.isPending || doctors.isPending ? (
                <SkeletonRows rows={5} />
            ) : appointments.isError ? (
                <ErrorPanel error={appointments.error} onRetry={() => appointments.refetch()} />
            ) : columns.length === 0 ? (
                <EmptyState title={t("today.noDoctors")} action={can("doctors:manage") && <ButtonLink to={`/c/${slug}/doctors`}>{t("staffNav.doctors")}</ButtonLink>} />
            ) : (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                    <div className="overflow-x-auto rounded-sheet bg-surface ring-1 ring-rule">
                        <table className="w-full min-w-[32rem] border-collapse text-sm">
                            <caption className="sr-only">{t("today.title")}</caption>
                            <thead>
                                <tr>
                                    <th scope="col" className="w-20 px-3 py-3 text-start text-xs font-medium text-graphite">
                                        {t("appt.time")}
                                    </th>
                                    {columns.map((c) => (
                                        <th key={c.id} scope="col" className="px-3 py-3 text-start font-semibold">
                                            {c.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="ledger-rule px-3 py-10 text-center text-graphite">
                                            {t("today.empty")}
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map(([startsAt, list]) => (
                                        <tr key={startsAt} className="ledger-rule align-top">
                                            <th scope="row" className="tabular px-3 py-2.5 text-start text-base font-semibold">
                                                {formatTime(startsAt, zone, locale)}
                                            </th>
                                            {columns.map((c) => (
                                                <td key={c.id} className="px-2 py-1.5">
                                                    {list
                                                        .filter((a) => a.doctor.id === c.id)
                                                        .map((a) => (
                                                            <button
                                                                key={a.id}
                                                                type="button"
                                                                onClick={() => setSelectedId(a.id)}
                                                                aria-pressed={selectedId === a.id}
                                                                className={cx(
                                                                    "flex w-full flex-col items-start gap-1 rounded-control border-s-4 bg-paper px-2.5 py-2 text-start transition-colors hover:bg-malachite-tint/60",
                                                                    statusAccent[a.status],
                                                                    selectedId === a.id && "ring-2 ring-ink",
                                                                    a.status === "CANCELLED" && "opacity-70"
                                                                )}
                                                            >
                                                                <span className={cx("font-medium", a.status === "CANCELLED" && "line-through")}>{a.patient?.fullName}</span>
                                                                <span className="flex flex-wrap items-center gap-1.5 text-xs text-graphite">
                                                                    {pick(a.service.nameEn, a.service.nameAr)}
                                                                    <StatusBadge status={a.status} compact />
                                                                </span>
                                                            </button>
                                                        ))}
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <aside aria-label={t("today.selected")} className="rounded-sheet bg-surface p-5 ring-1 ring-rule xl:sticky xl:top-24 xl:self-start">
                        <h2 className="mb-4 text-sm font-medium text-graphite">{t("today.selected")}</h2>
                        {selected ? <AppointmentPanel key={selected.id} appointment={selected} /> : <p className="text-sm text-graphite">{t("today.selectHint")}</p>}
                    </aside>
                </div>
            )}
        </div>
    );
}
