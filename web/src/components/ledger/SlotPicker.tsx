import { useMemo } from "react";
import { DateTime } from "luxon";
import type { Slot } from "@/api/types";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/cx";

export interface LedgerSlot extends Slot {
    /** Doctors free at this time (several when "any doctor" merges schedules). */
    doctorIds: number[];
}

// The ledger: open times as large tabular numerals, broken into runs where the day has a gap
// (a break, an existing booking or a closure) — the gap is drawn as a ruled line.
export function SlotPicker({
    slots,
    zone,
    value,
    onChange,
    emptyLabel,
    label,
}: {
    slots: LedgerSlot[];
    zone: string;
    value: string | null;
    onChange: (slot: LedgerSlot) => void;
    emptyLabel: string;
    label: string;
}) {
    const { locale } = useI18n();
    const runs = useMemo(() => {
        const result: LedgerSlot[][] = [];
        let previous: DateTime | null = null;
        for (const slot of slots) {
            const start = DateTime.fromISO(slot.startsAt);
            // A gap longer than 30 min starts a new run (visually: a ruled break).
            if (!previous || start.diff(previous, "minutes").minutes > 30) result.push([]);
            result[result.length - 1].push(slot);
            previous = start;
        }
        return result;
    }, [slots]);

    if (slots.length === 0) {
        return <p className="ledger-rule py-6 text-sm text-graphite">{emptyLabel}</p>;
    }

    const intl = locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
    const fmt = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone });

    return (
        <div role="radiogroup" aria-label={label} className="flex flex-col">
            {runs.map((run, index) => (
                <div key={run[0].startsAt} className={cx("flex flex-wrap gap-2 py-3", index > 0 && "ledger-rule")}>
                    {run.map((slot) => {
                        const selected = value === slot.startsAt;
                        return (
                            <button
                                key={slot.startsAt}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onChange(slot)}
                                className={cx(
                                    "tabular min-h-11 min-w-[4.75rem] rounded-control border px-3 text-lg font-semibold transition-colors",
                                    selected
                                        ? "animate-ink border-malachite bg-malachite text-white"
                                        : "border-rule-strong bg-surface text-ink hover:border-malachite hover:bg-malachite-tint"
                                )}
                            >
                                {fmt.format(new Date(slot.startsAt))}
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/** Merges per-doctor slots into one ledger for a given local date ("any doctor"). */
export function mergeSlots(doctors: { id: number; slots: Slot[] }[], date: string, zone: string, doctorId?: number): LedgerSlot[] {
    const map = new Map<string, LedgerSlot>();
    for (const doctor of doctors) {
        if (doctorId && doctor.id !== doctorId) continue;
        for (const slot of doctor.slots) {
            if (DateTime.fromISO(slot.startsAt).setZone(zone).toISODate() !== date) continue;
            const existing = map.get(slot.startsAt);
            if (existing) existing.doctorIds.push(doctor.id);
            else map.set(slot.startsAt, { ...slot, doctorIds: [doctor.id] });
        }
    }
    return [...map.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Number of open slots per local date (for the day strip). */
export function countByDate(doctors: { id: number; slots: Slot[] }[], zone: string, doctorId?: number) {
    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const doctor of doctors) {
        if (doctorId && doctor.id !== doctorId) continue;
        for (const slot of doctor.slots) {
            if (seen.has(slot.startsAt)) continue;
            seen.add(slot.startsAt);
            const date = DateTime.fromISO(slot.startsAt).setZone(zone).toISODate()!;
            counts[date] = (counts[date] ?? 0) + 1;
        }
    }
    return counts;
}
