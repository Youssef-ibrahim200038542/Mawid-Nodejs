import { useMemo } from "react";
import { DateTime } from "luxon";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/cx";

// A horizontal strip of local days (clinic zone). Days with nothing bookable can be muted.
export function DayStrip({
    from,
    days,
    zone,
    value,
    onChange,
    counts,
    label,
}: {
    from: string;
    days: number;
    zone: string;
    value: string;
    onChange: (date: string) => void;
    counts?: Record<string, number>;
    label: string;
}) {
    const { locale } = useI18n();
    const list = useMemo(() => {
        const start = DateTime.fromISO(from, { zone });
        const intl = locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
        return Array.from({ length: days }, (_, i) => {
            const d = start.plus({ days: i }).set({ hour: 12 });
            const date = d.toISODate()!;
            const js = d.toJSDate();
            return {
                date,
                weekday: new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: zone }).format(js),
                day: new Intl.DateTimeFormat(intl, { day: "numeric", timeZone: zone }).format(js),
                month: new Intl.DateTimeFormat(intl, { month: "short", timeZone: zone }).format(js),
            };
        });
    }, [from, days, zone, locale]);

    return (
        <div role="group" aria-label={label} className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-2">
            {list.map((item) => {
                const count = counts ? counts[item.date] ?? 0 : undefined;
                const selected = item.date === value;
                return (
                    <button
                        key={item.date}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(item.date)}
                        className={cx(
                            "flex min-h-16 min-w-16 snap-start flex-col items-center justify-center rounded-control border px-2 py-1.5 transition-colors",
                            selected ? "border-ink bg-ink text-paper" : "border-rule-strong bg-surface hover:border-ink",
                            count === 0 && !selected && "text-graphite"
                        )}
                    >
                        <span className="text-xs">{item.weekday}</span>
                        <span className="tabular text-lg font-semibold leading-tight">{item.day}</span>
                        <span className={cx("text-[0.6875rem]", selected ? "text-paper/80" : "text-graphite")}>{item.month}</span>
                    </button>
                );
            })}
        </div>
    );
}
