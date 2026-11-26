// Locale- and timezone-aware formatting. Everything is rendered in the clinic's timezone,
// never the browser's, so a patient abroad sees the clinic's wall-clock time.
import { DateTime } from "luxon";
import type { Locale } from "@/api/types";

// Western digits by default (as in the design direction), Arabic month/day names in Arabic.
const intlLocale = (locale: Locale) => (locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB");

export function formatTime(iso: string, timeZone: string, locale: Locale) {
    return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone: string, locale: Locale, style: "long" | "short" = "long") {
    const options: Intl.DateTimeFormatOptions =
        style === "long" ? { weekday: "long", day: "numeric", month: "long", timeZone } : { weekday: "short", day: "numeric", month: "short", timeZone };
    return new Intl.DateTimeFormat(intlLocale(locale), options).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string, locale: Locale) {
    return `${formatDate(iso, timeZone, locale, "short")} · ${formatTime(iso, timeZone, locale)}`;
}

/** A local calendar date ("2026-01-14") as a label, interpreted in the clinic zone. */
export function formatLocalDate(date: string, timeZone: string, locale: Locale, style: "long" | "short" = "short") {
    const noon = DateTime.fromISO(date, { zone: timeZone }).set({ hour: 12 });
    return formatDate(noon.toUTC().toISO()!, timeZone, locale, style);
}

export function formatMoney(amount: string | number, currency: string, locale: Locale) {
    return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
}

export function formatPercent(ratio: number | null, locale: Locale) {
    if (ratio === null) return "—";
    return new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 1 }).format(ratio);
}

export function formatNumber(value: number, locale: Locale) {
    return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatRelative(iso: string, locale: Locale) {
    const diff = DateTime.fromISO(iso).diffNow(["days", "hours", "minutes"]).shiftTo("minutes").minutes;
    const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
    const abs = Math.abs(diff);
    if (abs < 60) return rtf.format(Math.round(diff), "minute");
    if (abs < 60 * 24) return rtf.format(Math.round(diff / 60), "hour");
    return rtf.format(Math.round(diff / (60 * 24)), "day");
}

// ---- local-date helpers (all in a given IANA zone)
export const todayIn = (timeZone: string) => DateTime.now().setZone(timeZone).toISODate()!;
export const addDays = (date: string, days: number, timeZone: string) => DateTime.fromISO(date, { zone: timeZone }).plus({ days }).toISODate()!;
export const weekdayOf = (date: string, timeZone: string) => DateTime.fromISO(date, { zone: timeZone }).weekday;
export const localDateOf = (iso: string, timeZone: string) => DateTime.fromISO(iso).setZone(timeZone).toISODate()!;
/** "2026-01-14T10:30:00+02:00" → "10:30" (already local). */
export const hhmmOfLocal = (localIso: string) => localIso.slice(11, 16);
/** Input value for <input type="datetime-local"> from a UTC instant, in the clinic zone. */
export const toLocalInput = (iso: string, timeZone: string) => DateTime.fromISO(iso).setZone(timeZone).toFormat("yyyy-MM-dd'T'HH:mm");

/** "Zamalek, Cairo" in English, "الزمالك، القاهرة" in Arabic. */
export const joinParts = (parts: (string | null | undefined)[], locale: Locale) => parts.filter(Boolean).join(locale === "ar" ? "، " : ", ");
