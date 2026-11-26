import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Phone, EnvelopeSimple, Clock, CheckCircle, Stethoscope } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { publicApi } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import type { Appointment, PublicClinic } from "@/api/types";
import { Button, ButtonLink, ErrorPanel, ErrorSummary, Field, Select, Skeleton, TextArea, TextInput } from "@/components/ui/primitives";
import { DayStrip } from "@/components/ledger/DayStrip";
import { SlotPicker, type LedgerSlot } from "@/components/ledger/SlotPicker";
import { useLedger } from "@/components/ledger/useLedger";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import NotFoundPage from "@/pages/NotFoundPage";

const bookingDays = 14; // the public availability window allowed by the API
const phonePattern = /^\+?[0-9 ()-]{6,30}$/;

export function WeeklyHoursList({ intervals, zone }: { intervals: { weekday: number; start: string; end: string }[]; zone: string }) {
    const { t } = useI18n();
    // Show the week starting Saturday (the common Egyptian working week runs Sat/Sun → Thu).
    const order = [6, 7, 1, 2, 3, 4, 5];
    return (
        <dl className="text-sm">
            {order.map((weekday) => {
                const day = intervals.filter((i) => i.weekday === weekday);
                return (
                    <div key={weekday} className="ledger-rule flex justify-between gap-4 py-2">
                        <dt className="text-graphite">{t(`weekdays.${weekday}`)}</dt>
                        <dd className="tabular text-end">{day.length === 0 ? <span className="text-graphite">{t("clinicPage.closed")}</span> : day.map((i) => `${i.start}–${i.end}`).join(" · ")}</dd>
                    </div>
                );
            })}
            <p className="pt-2 text-xs text-graphite">{t("hours.timezone", { tz: zone })}</p>
        </dl>
    );
}

function BookingPanel({ data, slug }: { data: PublicClinic; slug: string }) {
    const { t, pick, locale, errorMessage } = useI18n();
    const { me } = useAuth();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const zone = data.clinic.timezone;

    const serviceId = Number(params.get("service")) || data.services[0]?.id;
    const doctorParam = Number(params.get("doctor")) || undefined;
    const date = params.get("date");
    const slotIso = params.get("slot");
    const [phone, setPhone] = useState("");
    const [note, setNote] = useState("");
    const [phoneError, setPhoneError] = useState<string>();
    const [booked, setBooked] = useState<Appointment | null>(null);

    const service = data.services.find((s) => s.id === serviceId);
    const doctorsForService = data.doctors.filter((d) => d.serviceIds.includes(serviceId));
    const doctorId = doctorParam && doctorsForService.some((d) => d.id === doctorParam) ? doctorParam : undefined;

    const update = useCallback(
        (changes: Record<string, string | null>) => {
            setParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    for (const [key, value] of Object.entries(changes)) value === null ? next.delete(key) : next.set(key, value);
                    return next;
                },
                { replace: true }
            );
        },
        [setParams]
    );

    const { query, from, counts, slots } = useLedger({
        key: ["public", slug],
        zone,
        serviceId,
        doctorId,
        days: bookingDays,
        date,
        onDefaultDate: useCallback((d: string) => update({ date: d }), [update]),
        fetcher: (q) => publicApi.availability(slug, q),
        enabled: Boolean(service),
    });

    const selected: LedgerSlot | undefined = slots.find((s) => s.startsAt === slotIso);
    const chosenDoctorId = selected ? doctorId ?? selected.doctorIds[0] : undefined;
    const chosenDoctor = data.doctors.find((d) => d.id === chosenDoctorId);

    const book = useMutation({
        mutationFn: () => publicApi.book(slug, { doctorId: chosenDoctorId!, serviceId: serviceId!, startsAt: selected!.startsAt, phone: phone.trim() || null, note: note.trim() || null }),
        onSuccess: ({ appointment }) => {
            setBooked(appointment);
            queryClient.invalidateQueries({ queryKey: ["public", slug] });
            queryClient.invalidateQueries({ queryKey: ["me", "appointments"] });
        },
        onError: (error) => {
            if (error instanceof ApiError && ["SLOT_TAKEN", "DOCTOR_UNAVAILABLE", "OUTSIDE_WORKING_HOURS", "BOOKING_TOO_SOON"].includes(error.code)) {
                update({ slot: null });
                query.refetch();
            }
        },
    });

    if (booked) {
        return (
            <section aria-labelledby="booked-title" className="animate-ink rounded-sheet bg-surface p-6 ring-2 ring-malachite">
                <p className="flex items-center gap-2 text-malachite-deep">
                    <CheckCircle aria-hidden size={28} weight="fill" />
                    <span id="booked-title" className="text-xl font-semibold" tabIndex={-1} ref={(el) => el?.focus()}>
                        {t("clinicPage.booked")}
                    </span>
                </p>
                <p className="tabular mt-4 text-4xl font-semibold">{formatTime(booked.startsAt, zone, locale)}</p>
                <p className="mt-1 text-graphite">
                    {formatDate(booked.startsAt, zone, locale)} · {pick(booked.doctor.displayNameEn, booked.doctor.displayNameAr)} · {pick(booked.service.nameEn, booked.service.nameAr)}
                </p>
                <p className="mt-4 max-w-prose">{t("clinicPage.bookedBody", { clinic: data.clinic.name })}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                    <ButtonLink to="/me/appointments" variant="primary">
                        {t("clinicPage.viewMine")}
                    </ButtonLink>
                    <Button
                        onClick={() => {
                            setBooked(null);
                            update({ slot: null });
                        }}
                    >
                        {t("clinicPage.bookAnother")}
                    </Button>
                </div>
            </section>
        );
    }

    if (data.services.length === 0) {
        return <p className="text-graphite">{t("clinicPage.chooseService")}</p>;
    }

    const timeLabel = selected ? formatTime(selected.startsAt, zone, locale) : "";
    const next = encodeURIComponent(location.pathname + location.search);

    return (
        <section aria-labelledby="book-title" className="rounded-sheet bg-surface p-5 ring-1 ring-rule md:p-6">
            <h2 id="book-title" className="text-xl font-semibold">
                {t("clinicPage.bookTitle")}
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label={t("clinicPage.service")}>
                    {(p) => (
                        <Select {...p} value={serviceId} onChange={(e) => update({ service: e.target.value, slot: null, date: null })}>
                            {data.services.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {pick(s.nameEn, s.nameAr)} · {t("common.minutes", { n: s.durationMinutes })} · {formatMoney(s.price, s.currency, locale)}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
                <Field label={t("clinicPage.doctor")}>
                    {(p) => (
                        <Select {...p} value={doctorId ?? ""} onChange={(e) => update({ doctor: e.target.value || null, slot: null, date: null })} disabled={doctorsForService.length === 0}>
                            <option value="">{t("clinicPage.anyDoctor")}</option>
                            {doctorsForService.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {pick(d.displayNameEn, d.displayNameAr)}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
            </div>

            <div className="mt-6">
                {doctorsForService.length === 0 ? (
                    <p className="ledger-rule py-6 text-sm text-graphite">{t("clinicPage.noDoctors")}</p>
                ) : query.isPending ? (
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-28" />
                    </div>
                ) : query.isError ? (
                    <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
                ) : (
                    <>
                        <DayStrip label={t("clinicPage.chooseDay")} from={from} days={bookingDays} zone={zone} value={date ?? from} counts={counts} onChange={(d) => update({ date: d, slot: null })} />
                        <h3 className="mt-4 text-sm font-medium text-graphite">{t("clinicPage.times")}</h3>
                        <SlotPicker label={t("clinicPage.pickTime")} slots={slots} zone={zone} value={slotIso} onChange={(slot) => update({ slot: slot.startsAt })} emptyLabel={t("clinicPage.noSlotsDay")} />
                        <p className="mt-1 text-xs text-graphite">{t("clinicPage.timezoneNote", { tz: zone })}</p>
                    </>
                )}
            </div>

            {selected && service && (
                <div className="mt-6 rounded-sheet border border-rule-strong p-4" aria-live="polite">
                    <p className="text-sm font-medium text-graphite">{t("clinicPage.yourAppointment")}</p>
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
                        <span className="tabular text-3xl font-semibold">{timeLabel}</span>
                        <span>{formatDate(selected.startsAt, zone, locale)}</span>
                    </p>
                    <p className="mt-1 text-sm text-graphite">
                        {chosenDoctor && pick(chosenDoctor.displayNameEn, chosenDoctor.displayNameAr)} · {pick(service.nameEn, service.nameAr)} · {t("common.minutes", { n: service.durationMinutes })} ·{" "}
                        {formatMoney(service.price, service.currency, locale)}
                    </p>

                    {me ? (
                        <form
                            className="mt-4 grid gap-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (phone.trim() && !phonePattern.test(phone.trim())) {
                                    setPhoneError(t("validation.phone"));
                                    return;
                                }
                                setPhoneError(undefined);
                                book.mutate();
                            }}
                            noValidate
                        >
                            {book.isError && <ErrorSummary message={errorMessage(book.error)} />}
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={t("clinicPage.phoneLabel")} optional help={t("clinicPage.phoneHelp")} error={phoneError}>
                                    {(p) => <TextInput {...p} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
                                </Field>
                                <Field label={t("clinicPage.noteLabel")} optional help={t("clinicPage.noteHelp")}>
                                    {(p) => <TextArea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11" />}
                                </Field>
                            </div>
                            <div>
                                <Button type="submit" variant="primary" loading={book.isPending}>
                                    {t("clinicPage.book", { time: timeLabel })}
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <ButtonLink to={`/login?next=${next}`} variant="primary" className="mt-4">
                            {t("clinicPage.loginToBook", { time: timeLabel })}
                        </ButtonLink>
                    )}
                </div>
            )}
        </section>
    );
}

export default function ClinicPage() {
    const { slug = "" } = useParams();
    const { t, pick, locale } = useI18n();
    const query = useQuery({ queryKey: ["public", slug, "clinic"], queryFn: () => publicApi.clinic(slug), retry: false });

    const specialtyNames = useMemo(() => new Map((query.data?.specialties ?? []).map((s) => [s.id, pick(s.nameEn, s.nameAr)])), [query.data, pick]);

    if (query.isPending) {
        return (
            <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="mt-6 h-96" />
            </div>
        );
    }
    if (query.isError) {
        if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundPage message={t("clinicPage.notFound")} />;
        return (
            <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
                <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
            </div>
        );
    }

    const { clinic, doctors, services, specialties, workingHours } = query.data;
    return (
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
            <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{clinic.name}</h1>
                    {specialties.length > 0 && <p className="mt-2 text-graphite">{specialties.map((s) => pick(s.nameEn, s.nameAr)).join(" · ")}</p>}
                </div>
                {(clinic.address || clinic.city) && (
                    <p className="flex items-center gap-1.5 text-sm text-graphite">
                        <MapPin aria-hidden size={18} />
                        {[clinic.address, clinic.city].filter(Boolean).join("، ")}
                    </p>
                )}
            </header>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <BookingPanel data={query.data} slug={slug} />

                <aside className="flex flex-col gap-8">
                    <section aria-labelledby="hours-title">
                        <h2 id="hours-title" className="mb-2 flex items-center gap-2 text-base font-semibold">
                            <Clock aria-hidden size={18} /> {t("clinicPage.hours")}
                        </h2>
                        <WeeklyHoursList intervals={workingHours.intervals} zone={workingHours.timezone} />
                    </section>
                    {(clinic.phone || clinic.email) && (
                        <section aria-labelledby="contact-title">
                            <h2 id="contact-title" className="mb-2 text-base font-semibold">
                                {t("clinicPage.contact")}
                            </h2>
                            <ul className="flex flex-col gap-2 text-sm">
                                {clinic.phone && (
                                    <li>
                                        <a href={`tel:${clinic.phone}`} className="inline-flex min-h-10 items-center gap-2 hover:underline" dir="ltr">
                                            <Phone aria-hidden size={18} /> {clinic.phone}
                                        </a>
                                    </li>
                                )}
                                {clinic.email && (
                                    <li>
                                        <a href={`mailto:${clinic.email}`} className="inline-flex min-h-10 items-center gap-2 hover:underline">
                                            <EnvelopeSimple aria-hidden size={18} /> {clinic.email}
                                        </a>
                                    </li>
                                )}
                            </ul>
                        </section>
                    )}
                </aside>
            </div>

            {doctors.length > 0 && (
                <section aria-labelledby="doctors-title" className="mt-14">
                    <h2 id="doctors-title" className="text-2xl font-semibold">
                        {t("clinicPage.doctors")}
                    </h2>
                    <ul className="mt-4 grid gap-4 md:grid-cols-2">
                        {doctors.map((d) => (
                            <li key={d.id} className="ledger-rule flex gap-4 pt-4">
                                <Stethoscope aria-hidden size={24} className="mt-1 shrink-0 text-malachite" />
                                <div>
                                    <p className="text-lg font-semibold">{pick(d.displayNameEn, d.displayNameAr)}</p>
                                    <p className="text-sm text-graphite">
                                        {[pick(d.titleEn, d.titleAr), d.yearsOfExperience ? t("clinicPage.experience", { n: d.yearsOfExperience }) : null].filter(Boolean).join(" · ")}
                                    </p>
                                    {d.specialtyIds.length > 0 && <p className="mt-1 text-sm">{d.specialtyIds.map((id) => specialtyNames.get(id)).filter(Boolean).join(" · ")}</p>}
                                    {pick(d.bioEn, d.bioAr) && <p className="mt-2 max-w-prose text-sm text-graphite">{pick(d.bioEn, d.bioAr)}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {services.length > 0 && (
                <section aria-labelledby="services-title" className="mt-14">
                    <h2 id="services-title" className="text-2xl font-semibold">
                        {t("clinicPage.services")}
                    </h2>
                    <ul className="mt-4">
                        {services.map((s) => (
                            <li key={s.id} className="ledger-rule flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                                <div className="min-w-0">
                                    <p className="font-medium">{pick(s.nameEn, s.nameAr)}</p>
                                    {pick(s.descriptionEn, s.descriptionAr) && <p className="max-w-prose text-sm text-graphite">{pick(s.descriptionEn, s.descriptionAr)}</p>}
                                </div>
                                <p className="tabular text-sm">
                                    {t("common.minutes", { n: s.durationMinutes })} · <span className="font-semibold">{formatMoney(s.price, s.currency, locale)}</span>
                                </p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            <p className="mt-10 text-sm">
                <Link to="/clinics" className="text-malachite-deep hover:underline">
                    ← {t("nav.clinics")}
                </Link>
            </p>
        </div>
    );
}
