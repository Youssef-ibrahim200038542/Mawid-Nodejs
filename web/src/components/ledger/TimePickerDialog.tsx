import { useCallback, useState } from "react";
import type { Availability } from "@/api/types";
import { useI18n } from "@/i18n";
import { Button, Dialog, ErrorPanel, ErrorSummary, Field, Select, Skeleton } from "@/components/ui/primitives";
import { DayStrip } from "./DayStrip";
import { SlotPicker, type LedgerSlot } from "./SlotPicker";
import { useLedger } from "./useLedger";
import { formatDate, formatTime } from "@/lib/format";

// Choose a new time from REAL availability (public or staff endpoint), then confirm.
export function TimePickerDialog({
    open,
    onClose,
    title,
    note,
    zone,
    serviceId,
    doctors,
    initialDoctorId,
    days,
    queryKey,
    fetcher,
    onConfirm,
    submitting,
    error,
    allowDoctorChange = true,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    note?: string;
    zone: string;
    serviceId: number;
    doctors: { id: number; name: string }[];
    initialDoctorId: number;
    days: number;
    queryKey: unknown[];
    fetcher: (query: { serviceId: number; from: string; to: string }) => Promise<Availability>;
    onConfirm: (startsAt: string, doctorId: number) => void;
    submitting: boolean;
    error: unknown;
    allowDoctorChange?: boolean;
}) {
    const { t, locale, errorMessage } = useI18n();
    const [doctorId, setDoctorId] = useState(initialDoctorId);
    const [date, setDate] = useState<string | null>(null);
    const [slot, setSlot] = useState<LedgerSlot | null>(null);

    const { query, from, counts, slots } = useLedger({
        key: queryKey,
        zone,
        serviceId,
        doctorId,
        days,
        date,
        onDefaultDate: useCallback((d: string) => setDate(d), []),
        fetcher,
        enabled: open,
    });

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={title}
            size="lg"
            footer={
                <>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="primary" disabled={!slot} loading={submitting} onClick={() => slot && onConfirm(slot.startsAt, doctorId)}>
                        {slot ? `${formatTime(slot.startsAt, zone, locale)} · ${formatDate(slot.startsAt, zone, locale, "short")}` : t("clinicPage.pickTime")}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {note && <p className="text-sm text-graphite">{note}</p>}
                {error !== null && error !== undefined && <ErrorSummary message={errorMessage(error)} />}
                {allowDoctorChange && doctors.length > 1 && (
                    <Field label={t("appt.moveDoctor")}>
                        {(p) => (
                            <Select
                                {...p}
                                value={doctorId}
                                onChange={(e) => {
                                    setDoctorId(Number(e.target.value));
                                    setSlot(null);
                                    setDate(null);
                                }}
                            >
                                {doctors.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {d.name}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                )}
                {query.isPending ? (
                    <Skeleton className="h-40" />
                ) : query.isError ? (
                    <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
                ) : (
                    <>
                        <DayStrip
                            label={t("clinicPage.chooseDay")}
                            from={from}
                            days={days}
                            zone={zone}
                            value={date ?? from}
                            counts={counts}
                            onChange={(d) => {
                                setDate(d);
                                setSlot(null);
                            }}
                        />
                        <SlotPicker label={t("appt.movePick")} slots={slots} zone={zone} value={slot?.startsAt ?? null} onChange={setSlot} emptyLabel={t("clinicPage.noSlotsDay")} />
                        <p className="text-xs text-graphite">{t("clinicPage.timezoneNote", { tz: zone })}</p>
                    </>
                )}
            </div>
        </Dialog>
    );
}
