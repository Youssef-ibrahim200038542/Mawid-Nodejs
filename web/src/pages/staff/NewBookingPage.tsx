import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, UserPlus, CheckCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { appointmentsApi, doctorsApi, patientsApi, servicesApi } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import type { Patient } from "@/api/types";
import { Button, ButtonLink, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, Section, Segmented, Select, Skeleton, Spinner, TextArea, TextInput } from "@/components/ui/primitives";
import { DayStrip } from "@/components/ledger/DayStrip";
import { SlotPicker, type LedgerSlot } from "@/components/ledger/SlotPicker";
import { useLedger } from "@/components/ledger/useLedger";
import { useInvalidateAppointments } from "@/components/staff/AppointmentPanel";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { formatMoney, formatTime, localDateOf } from "@/lib/format";
import { NotAllowed } from "./StaffIndex";

const phonePattern = /^\+?[0-9 ()-]{6,30}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const days = 21;

function useDebounced<T>(value: T, ms = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return debounced;
}

export default function NewBookingPage() {
    const { t, pick, locale, errorMessage } = useI18n();
    const { slug, zone, can } = useStaff();
    const { notify } = useToast();
    const navigate = useNavigate();
    const invalidate = useInvalidateAppointments();
    const [params] = useSearchParams();

    const [mode, setMode] = useState<"existing" | "new">("existing");
    const [search, setSearch] = useState("");
    const debounced = useDebounced(search.trim());
    const [patient, setPatient] = useState<Patient | null>(null);
    const [walkIn, setWalkIn] = useState({ fullName: "", phone: "", email: "" });
    const [walkInErrors, setWalkInErrors] = useState<Record<string, string>>({});
    const [serviceId, setServiceId] = useState<number | undefined>();
    const [doctorId, setDoctorId] = useState<number | undefined>();
    const [date, setDate] = useState<string | null>(params.get("date"));
    const [slot, setSlot] = useState<LedgerSlot | null>(null);
    const [status, setStatus] = useState<"CONFIRMED" | "PENDING">("CONFIRMED");
    const [note, setNote] = useState("");

    const services = useQuery({ queryKey: ["staff", slug, "services", "active"], queryFn: () => servicesApi.list(slug) });
    const doctors = useQuery({
        queryKey: ["staff", slug, "doctors", "for-service", serviceId],
        // Only bookable doctors (the booking engine refuses the rest anyway).
        queryFn: () => doctorsApi.list(slug, { serviceId, pageSize: 100 }).then((page) => ({ ...page, items: page.items.filter((d) => d.bookable) })),
        enabled: Boolean(serviceId),
    });
    const patients = useQuery({
        queryKey: ["staff", slug, "patients", "search", debounced],
        queryFn: () => patientsApi.list(slug, { q: debounced, pageSize: 8 }),
        enabled: mode === "existing" && !patient && debounced.length >= 2,
    });

    useEffect(() => {
        if (!serviceId && services.data?.services[0]) setServiceId(services.data.services[0].id);
    }, [services.data, serviceId]);
    useEffect(() => {
        const list = doctors.data?.items ?? [];
        if (list.length && !list.some((d) => d.id === doctorId)) setDoctorId(list[0].id);
    }, [doctors.data, doctorId]);

    const { query: availability, from, counts, slots } = useLedger({
        key: ["staff", slug],
        zone,
        serviceId,
        doctorId,
        days,
        date,
        onDefaultDate: useCallback((d: string) => setDate(d), []),
        fetcher: (q) => appointmentsApi.availability(slug, { ...q, doctorId }),
        enabled: Boolean(serviceId && doctorId),
    });

    const book = useMutation({
        mutationFn: () =>
            appointmentsApi.create(slug, {
                doctorId: doctorId!,
                serviceId: serviceId!,
                startsAt: slot!.startsAt,
                ...(mode === "existing"
                    ? { patientId: patient!.id }
                    : { patient: { fullName: walkIn.fullName.trim(), phone: walkIn.phone.trim() || null, email: walkIn.email.trim() || null } }),
                note: note.trim() || null,
                status,
            }),
        onSuccess: ({ appointment }) => {
            notify(t("booking.booked", { time: formatTime(appointment.startsAt, zone, locale) }));
            invalidate();
            navigate(`/c/${slug}/today?date=${localDateOf(appointment.startsAt, zone)}`);
        },
        onError: (error) => {
            if (error instanceof ApiError && ["SLOT_TAKEN", "DOCTOR_UNAVAILABLE", "OUTSIDE_WORKING_HOURS"].includes(error.code)) {
                setSlot(null);
                availability.refetch();
            }
        },
    });

    if (!can("appointments:create")) return <NotAllowed />;

    const service = services.data?.services.find((s) => s.id === serviceId);
    const patientReady = mode === "existing" ? Boolean(patient) : walkIn.fullName.trim().length >= 2;

    const submit = () => {
        if (mode === "new") {
            const errors: Record<string, string> = {};
            if (walkIn.fullName.trim().length < 2) errors.fullName = t("validation.nameMin");
            if (walkIn.phone.trim() && !phonePattern.test(walkIn.phone.trim())) errors.phone = t("validation.phone");
            if (walkIn.email.trim() && !emailPattern.test(walkIn.email.trim())) errors.email = t("validation.email");
            setWalkInErrors(errors);
            if (Object.keys(errors).length) return;
        }
        book.mutate();
    };

    if (services.isPending) return <Spinner />;
    if (services.isError) return <ErrorPanel error={services.error} onRetry={() => services.refetch()} />;
    if (services.data.services.length === 0) {
        return <EmptyState title={t("booking.noServices")} action={can("services:manage") && <ButtonLink to={`/c/${slug}/services`}>{t("staffNav.services")}</ButtonLink>} />;
    }

    return (
        <div className="max-w-4xl">
            <PageHeader title={t("booking.title")} />
            <div className="flex flex-col gap-6">
                <Section title={t("booking.patientStep")}>
                    {patient ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="flex items-center gap-2">
                                <CheckCircle aria-hidden size={20} weight="fill" className="text-malachite" />
                                <span className="font-medium">{patient.fullName}</span>
                                <span className="text-sm text-graphite" dir="ltr">
                                    {patient.phone ?? patient.email ?? ""}
                                </span>
                            </p>
                            <Button size="sm" onClick={() => setPatient(null)}>
                                {t("booking.change")}
                            </Button>
                        </div>
                    ) : (
                        <>
                            <Segmented
                                label={t("booking.patientStep")}
                                value={mode}
                                onChange={setMode}
                                options={[
                                    { value: "existing", label: t("booking.findPatient") },
                                    { value: "new", label: t("booking.newPatient") },
                                ]}
                            />
                            {mode === "existing" ? (
                                <div className="mt-4">
                                    <Field label={t("booking.findPatient")}>
                                        {(p) => (
                                            <div className="relative">
                                                <MagnifyingGlass aria-hidden size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-graphite" />
                                                <TextInput {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("booking.findPlaceholder")} className="ps-10" />
                                            </div>
                                        )}
                                    </Field>
                                    <div aria-live="polite" className="mt-3">
                                        {patients.isFetching && <Spinner />}
                                        {patients.data && patients.data.items.length === 0 && (
                                            <p className="text-sm text-graphite">
                                                {t("booking.noMatches")}{" "}
                                                <button type="button" className="font-medium text-malachite-deep underline" onClick={() => setMode("new")}>
                                                    {t("booking.newPatient")}
                                                </button>
                                            </p>
                                        )}
                                        <ul>
                                            {patients.data?.items.map((p) => (
                                                <li key={p.id} className="ledger-rule">
                                                    <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-1 text-start hover:bg-paper" onClick={() => setPatient(p)}>
                                                        <span className="font-medium">{p.fullName}</span>
                                                        <span className="text-sm text-graphite" dir="ltr">
                                                            {[p.phone, p.email].filter(Boolean).join(" · ")}
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                                    <Field label={t("booking.fullName")} error={walkInErrors.fullName}>
                                        {(p) => <TextInput {...p} value={walkIn.fullName} onChange={(e) => setWalkIn({ ...walkIn, fullName: e.target.value })} />}
                                    </Field>
                                    <Field label={t("patients.phone")} optional error={walkInErrors.phone}>
                                        {(p) => <TextInput {...p} type="tel" dir="ltr" value={walkIn.phone} onChange={(e) => setWalkIn({ ...walkIn, phone: e.target.value })} />}
                                    </Field>
                                    <Field label={t("patients.email")} optional error={walkInErrors.email}>
                                        {(p) => <TextInput {...p} type="email" dir="ltr" value={walkIn.email} onChange={(e) => setWalkIn({ ...walkIn, email: e.target.value })} />}
                                    </Field>
                                    <p className="flex items-center gap-2 text-xs text-graphite sm:col-span-3">
                                        <UserPlus aria-hidden size={16} /> {t("appt.walkIn")}
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </Section>

                <Section title={t("booking.time")}>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t("booking.service")}>
                            {(p) => (
                                <Select
                                    {...p}
                                    value={serviceId}
                                    onChange={(e) => {
                                        setServiceId(Number(e.target.value));
                                        setSlot(null);
                                        setDate(null);
                                    }}
                                >
                                    {services.data.services.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {pick(s.nameEn, s.nameAr)} · {t("common.minutes", { n: s.durationMinutes })}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Field label={t("booking.doctor")}>
                            {(p) => (
                                <Select
                                    {...p}
                                    value={doctorId ?? ""}
                                    disabled={!doctors.data?.items.length}
                                    onChange={(e) => {
                                        setDoctorId(Number(e.target.value));
                                        setSlot(null);
                                        setDate(null);
                                    }}
                                >
                                    {(doctors.data?.items ?? []).map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {pick(d.displayNameEn, d.displayNameAr)}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                    </div>
                    <div className="mt-5">
                        {doctors.data && doctors.data.items.length === 0 ? (
                            <p className="text-sm text-graphite">{t("clinicPage.noDoctors")}</p>
                        ) : !doctorId ? (
                            <p className="text-sm text-graphite">{t("booking.pickServiceDoctor")}</p>
                        ) : availability.isPending ? (
                            <Skeleton className="h-40" />
                        ) : availability.isError ? (
                            <ErrorPanel error={availability.error} onRetry={() => availability.refetch()} />
                        ) : (
                            <>
                                <DayStrip label={t("booking.day")} from={from} days={days} zone={zone} value={date ?? from} counts={counts} onChange={(d) => { setDate(d); setSlot(null); }} />
                                <SlotPicker label={t("booking.time")} slots={slots} zone={zone} value={slot?.startsAt ?? null} onChange={setSlot} emptyLabel={t("clinicPage.noSlotsDay")} />
                            </>
                        )}
                    </div>
                </Section>

                <Section>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <p className="mb-1.5 text-sm font-medium">{t("booking.status")}</p>
                            <Segmented
                                label={t("booking.status")}
                                value={status}
                                onChange={setStatus}
                                options={[
                                    { value: "CONFIRMED", label: t("booking.confirmNow") },
                                    { value: "PENDING", label: t("booking.keepPending") },
                                ]}
                            />
                        </div>
                        <Field label={t("booking.note")} optional help={t("clinicPage.noteHelp")}>
                            {(p) => <TextArea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11" />}
                        </Field>
                    </div>
                    {book.isError && (
                        <div className="mt-4">
                            <ErrorSummary message={errorMessage(book.error)} />
                        </div>
                    )}
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <Button variant="primary" disabled={!slot || !patientReady} loading={book.isPending} onClick={submit}>
                            {slot ? t("booking.submit", { time: formatTime(slot.startsAt, zone, locale) }) : t("clinicPage.pickTime")}
                        </Button>
                        {service && slot && <span className="tabular text-sm text-graphite">{formatMoney(service.price, service.currency, locale)}</span>}
                    </div>
                </Section>
            </div>
        </div>
    );
}
