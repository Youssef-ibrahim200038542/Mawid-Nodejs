import { useEffect, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import type { WeeklyInterval } from "@/api/types";
import { useI18n } from "@/i18n";
import { Button, ErrorSummary, TextInput } from "@/components/ui/primitives";
import { cx } from "@/lib/cx";

const order = [6, 7, 1, 2, 3, 4, 5]; // Saturday first (Egyptian working week)
const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const toMinutes = (value: string) => (value === "24:00" ? 1440 : Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)));

type Draft = Record<number, { start: string; end: string }[]>;

function toDraft(intervals: WeeklyInterval[]): Draft {
    const draft: Draft = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    for (const i of intervals) draft[i.weekday].push({ start: i.start, end: i.end });
    return draft;
}

// Edits a whole weekly schedule (PUT semantics). Breaks = a second interval on the same day.
export function WeeklyHoursEditor({
    intervals,
    onSave,
    saving,
    error,
    readOnly = false,
}: {
    intervals: WeeklyInterval[];
    onSave: (intervals: WeeklyInterval[]) => void;
    saving: boolean;
    error: unknown;
    readOnly?: boolean;
}) {
    const { t, errorMessage } = useI18n();
    const [draft, setDraft] = useState<Draft>(() => toDraft(intervals));
    const [problems, setProblems] = useState<Record<string, string>>({});

    useEffect(() => setDraft(toDraft(intervals)), [intervals]);

    const validate = () => {
        const found: Record<string, string> = {};
        for (const day of order) {
            const list = draft[day];
            list.forEach((i, index) => {
                if (!hhmm.test(i.start) || !hhmm.test(i.end) || i.start === "24:00") found[`${day}-${index}`] = t("validation.time");
                else if (toMinutes(i.start) >= toMinutes(i.end)) found[`${day}-${index}`] = t("validation.endAfterStart");
            });
            const sorted = list.map((i, index) => ({ ...i, index })).filter((i) => hhmm.test(i.start) && hhmm.test(i.end)).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
            for (let k = 1; k < sorted.length; k += 1) {
                if (toMinutes(sorted[k].start) < toMinutes(sorted[k - 1].end)) found[`${day}-${sorted[k].index}`] = t("validation.overlap");
            }
        }
        setProblems(found);
        return Object.keys(found).length === 0;
    };

    const setInterval = (day: number, index: number, key: "start" | "end", value: string) =>
        setDraft((d) => ({ ...d, [day]: d[day].map((i, k) => (k === index ? { ...i, [key]: value } : i)) }));

    return (
        <form
            noValidate
            onSubmit={(event) => {
                event.preventDefault();
                if (!validate()) return;
                onSave(order.flatMap((weekday) => draft[weekday].map((i) => ({ weekday, start: i.start, end: i.end }))));
            }}
        >
            {Boolean(error) && (
                <div className="mb-4">
                    <ErrorSummary message={errorMessage(error)} />
                </div>
            )}
            <div>
                {order.map((day) => (
                    <fieldset key={day} className="ledger-rule grid gap-2 py-3 sm:grid-cols-[8rem_1fr] sm:items-start">
                        <legend className="sr-only">{t(`weekdays.${day}`)}</legend>
                        <p aria-hidden className="pt-2.5 text-sm font-medium">
                            {t(`weekdays.${day}`)}
                        </p>
                        <div className="flex flex-col gap-2">
                            {draft[day].length === 0 && <p className="pt-2.5 text-sm text-graphite">{t("hours.closedDay")}</p>}
                            {draft[day].map((interval, index) => {
                                const problem = problems[`${day}-${index}`];
                                return (
                                    <div key={index}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="w-24 shrink-0">
                                                <TextInput
                                                aria-label={`${t(`weekdays.${day}`)} ${t("hours.from")}`}
                                                aria-invalid={problem ? true : undefined}
                                                value={interval.start}
                                                onChange={(e) => setInterval(day, index, "start", e.target.value)}
                                                inputMode="numeric"
                                                placeholder="09:00"
                                                dir="ltr"
                                                className="tabular"
                                                disabled={readOnly}
                                            />
                                            </div>
                                            <span aria-hidden className="text-graphite">–</span>
                                            <div className="w-24 shrink-0">
                                                <TextInput
                                                aria-label={`${t(`weekdays.${day}`)} ${t("hours.to")}`}
                                                aria-invalid={problem ? true : undefined}
                                                value={interval.end}
                                                onChange={(e) => setInterval(day, index, "end", e.target.value)}
                                                inputMode="numeric"
                                                placeholder="17:00"
                                                dir="ltr"
                                                className="tabular"
                                                disabled={readOnly}
                                            />
                                            </div>
                                            {!readOnly && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    aria-label={`${t("common.remove")} ${interval.start}–${interval.end}`}
                                                    onClick={() => setDraft((d) => ({ ...d, [day]: d[day].filter((_, k) => k !== index) }))}
                                                >
                                                    <Trash aria-hidden size={16} />
                                                </Button>
                                            )}
                                        </div>
                                        {problem && <p className="mt-1 text-xs font-medium text-carmine">{problem}</p>}
                                    </div>
                                );
                            })}
                            {!readOnly && (
                                <div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className={cx("text-malachite-deep")}
                                        icon={<Plus aria-hidden size={16} />}
                                        onClick={() => {
                                            const last = draft[day][draft[day].length - 1];
                                            const next = last ? { start: last.end === "24:00" ? "23:00" : last.end, end: last.end === "24:00" ? "24:00" : last.end } : { start: "09:00", end: "17:00" };
                                            setDraft((d) => ({ ...d, [day]: [...d[day], next] }));
                                        }}
                                    >
                                        {t("hours.addInterval")}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </fieldset>
                ))}
            </div>
            {!readOnly && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="primary" loading={saving}>
                        {t("common.save")}
                    </Button>
                    <span className="text-xs text-graphite">{t("hours.addBreakHint")}</span>
                </div>
            )}
        </form>
    );
}
