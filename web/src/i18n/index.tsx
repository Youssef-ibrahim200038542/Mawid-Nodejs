import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en, { type Dictionary } from "./en";
import ar from "./ar";
import type { Locale } from "@/api/types";
import { ApiError } from "@/api/client";

const dictionaries: Record<Locale, Dictionary> = { en, ar };
const storageKey = "mawid.locale"; // a UI preference only — never anything sensitive

type Vars = Record<string, string | number>;

interface I18nContextValue {
    locale: Locale;
    dir: "ltr" | "rtl";
    setLocale: (locale: Locale) => void;
    t: (key: string, vars?: Vars) => string;
    has: (key: string) => boolean;
    errorMessage: (error: unknown) => string;
    /** Picks the Arabic text when the UI is Arabic and one exists, otherwise English. */
    pick: (english: string | null | undefined, arabic: string | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function lookup(dict: Dictionary, key: string): unknown {
    return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), dict);
}

function interpolate(text: string, vars?: Vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (vars[name] !== undefined ? String(vars[name]) : match));
}

function initialLocale(): Locale {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
    if (saved === "en" || saved === "ar") return saved;
    return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(initialLocale);
    const dir = locale === "ar" ? "rtl" : "ltr";

    useEffect(() => {
        document.documentElement.lang = locale;
        document.documentElement.dir = dir;
    }, [locale, dir]);

    const setLocale = useCallback((next: Locale) => {
        setLocaleState(next);
        localStorage.setItem(storageKey, next);
    }, []);

    const value = useMemo<I18nContextValue>(() => {
        const dict = dictionaries[locale];
        const t = (key: string, vars?: Vars) => {
            const found = lookup(dict, key) ?? lookup(en, key);
            return typeof found === "string" ? interpolate(found, vars) : key;
        };
        const has = (key: string) => typeof lookup(dict, key) === "string";
        return {
            locale,
            dir,
            setLocale,
            t,
            has,
            errorMessage: (error: unknown) => {
                if (error instanceof ApiError) return has(`errors.${error.code}`) ? t(`errors.${error.code}`) : error.message;
                return t("errors.generic");
            },
            pick: (english, arabic) => (locale === "ar" && arabic ? arabic : english || arabic || ""),
        };
    }, [locale, dir, setLocale]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    const context = useContext(I18nContext);
    if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
    return context;
}
