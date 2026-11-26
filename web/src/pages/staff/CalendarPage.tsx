import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import arLocale from "@fullcalendar/core/locales/ar";
import type { DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import { DateTime } from "luxon";
import { useI18n } from "@/i18n";
import { appointmentsApi, doctorsApi, scheduleApi } from "@/api/endpoints";
import type { Appointment, AppointmentStatus } from "@/api/types";
import { Dialog, ErrorPanel, Field, PageHeader, Select } from "@/components/ui/primitives";
import { AppointmentPanel } from "@/components/staff/AppointmentPanel";
import { useStaff } from "@/layouts/StaffLayout";

const eventColors: Record<AppointmentStatus, { bg: string; text: string }> = {
    PENDING: { bg: "#FBF1D8", text: "#17201D" },
    CONFIRMED: { bg: "#0B6E4F", text: "#FFFFFF" },
    CANCELLED: { bg: "#F8E3E6", text: "#93192A" },
    COMPLETED: { bg: "#17201D", text: "#F7F8F6" },
    NO_SHOW: { bg: "#E6E8E6", text: "#56615C" },
};

export default function CalendarPage() {
    const { t, pick, locale, dir } = useI18n();
    const { slug, zone, clinic } = useStaff();
    const [range, setRange] = useState<{ from: string; to: string } | null>(null);
    const [doctorId, setDoctorId] = useState<number | undefined>(clinic.role === "DOCTOR" ? clinic.doctorProfileId ?? undefined : undefined);
    const [selected, setSelected] = useState<Appointment | null>(null);

    const doctors = useQuery({ queryKey: ["staff", slug, "doctors", "active"], queryFn: () => doctorsApi.list(slug, { pageSize: 100 }) });
    const hours = useQuery({ queryKey: ["staff", slug, "hours", "clinic"], queryFn: () => scheduleApi.clinicHours(slug) });
    const appointments = useQuery({
        queryKey: ["staff", slug, "appointments", "calendar", range?.from, range?.to, doctorId],
        queryFn: () => appointmentsApi.list(slug, { from: range!.from, to: range!.to, doctorId, pageSize: 100 }),
        enabled: Boolean(range),
        refetchInterval: 60_000,
    });

    const events = useMemo<EventInput[]>(
        () =>
            (appointments.data?.items ?? []).map((a) => ({
                id: String(a.id),
                start: a.startsAt,
                end: a.endsAt,
                title: `${a.patient?.fullName ?? ""} · ${pick(a.service.nameEn, a.service.nameAr)}`,
                backgroundColor: eventColors[a.status].bg,
                textColor: eventColors[a.status].text,
                classNames: a.status === "CANCELLED" ? ["line-through"] : [],
                extendedProps: { appointment: a },
            })),
        [appointments.data, pick]
    );

    // ISO weekday (1 = Mon … 7 = Sun) → FullCalendar daysOfWeek (0 = Sun).
    const businessHours = (hours.data?.intervals ?? []).map((i) => ({ daysOfWeek: [i.weekday % 7], startTime: i.start, endTime: i.end === "24:00" ? "24:00" : i.end }));

    return (
        <div>
            <PageHeader
                title={t("staffNav.calendar")}
                actions={
                    clinic.role !== "DOCTOR" && (
                        <Field label={t("appt.doctor")} className="min-w-56">
                            {(p) => (
                                <Select {...p} value={doctorId ?? ""} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : undefined)}>
                                    <option value="">{t("appt.anyDoctor")}</option>
                                    {(doctors.data?.items ?? []).map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {pick(d.displayNameEn, d.displayNameAr)}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                    )
                }
            />
            {appointments.isError && (
                <div className="mb-4">
                    <ErrorPanel error={appointments.error} onRetry={() => appointments.refetch()} />
                </div>
            )}
            <div className="rounded-sheet bg-surface p-3 ring-1 ring-rule md:p-4" aria-busy={appointments.isFetching}>
                <FullCalendar
                    plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, luxonPlugin]}
                    initialView={window.matchMedia("(max-width: 768px)").matches ? "timeGridDay" : "timeGridWeek"}
                    headerToolbar={{ start: "prev,next today", center: "title", end: "timeGridDay,timeGridWeek,dayGridMonth" }}
                    timeZone={zone}
                    locales={[arLocale]}
                    locale={locale}
                    direction={dir}
                    firstDay={6}
                    nowIndicator
                    allDaySlot={false}
                    slotMinTime="07:00:00"
                    slotMaxTime="23:00:00"
                    slotDuration="00:15:00"
                    slotLabelInterval="01:00"
                    slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                    eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                    businessHours={businessHours.length ? businessHours : undefined}
                    height="auto"
                    expandRows
                    events={events}
                    datesSet={(arg: DatesSetArg) => {
                        // FullCalendar gives the visible range; translate to clinic-local dates for the API.
                        const from = DateTime.fromJSDate(arg.start).setZone(zone).toISODate()!;
                        const to = DateTime.fromJSDate(arg.end).setZone(zone).minus({ days: 1 }).toISODate()!;
                        setRange((current) => (current?.from === from && current?.to === to ? current : { from, to }));
                    }}
                    eventClick={(arg: EventClickArg) => setSelected(arg.event.extendedProps.appointment as Appointment)}
                    buttonText={locale === "ar" ? undefined : { today: t("common.today") }}
                />
            </div>
            {appointments.data && appointments.data.total > appointments.data.items.length && (
                <p className="mt-2 text-xs text-graphite">{appointments.data.items.length} / {appointments.data.total}</p>
            )}
            <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title={t("today.selected")}>
                {selected && <AppointmentPanel key={selected.id} appointment={selected} onChanged={setSelected} />}
            </Dialog>
        </div>
    );
}
