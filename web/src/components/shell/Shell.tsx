import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, CaretDown, SignOut, CalendarCheck, Buildings, ShieldCheck, UserCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { meApi } from "@/api/endpoints";
import { cx } from "@/lib/cx";

export function Wordmark({ to = "/" }: { to?: string }) {
    const { t } = useI18n();
    return (
        <Link to={to} className="group inline-flex items-center gap-2 rounded-control text-ink" aria-label={t("brand")}>
            <svg aria-hidden viewBox="0 0 32 32" className="size-8">
                <rect width="32" height="32" rx="6" className="fill-malachite" />
                <path d="M7 10h18M7 16h18M7 22h11" stroke="#F7F8F6" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="23" cy="22" r="3" className="fill-saffron" />
            </svg>
            <span className="text-lg font-semibold tracking-tight">{t("brand")}</span>
        </Link>
    );
}

export function LocaleSwitch() {
    const { locale, t } = useI18n();
    const { setLocalePreference } = useAuth();
    const next = locale === "en" ? "ar" : "en";
    return (
        <button
            type="button"
            onClick={() => setLocalePreference(next)}
            lang={next}
            className="inline-flex min-h-10 items-center rounded-control px-2.5 text-sm font-medium text-ink hover:bg-ink/5"
            aria-label={`${t("common.language")}: ${next === "ar" ? t("common.arabic") : t("common.english")}`}
        >
            {next === "ar" ? "ع" : "EN"}
        </button>
    );
}

export function useUnreadCount() {
    const { me } = useAuth();
    return useQuery({
        queryKey: ["notifications", "unread"],
        queryFn: () => meApi.notifications({ pageSize: 1 }),
        enabled: Boolean(me),
        refetchInterval: 60_000,
        select: (data) => data.unread,
    });
}

export function NotificationBell() {
    const { t } = useI18n();
    const { data: unread = 0 } = useUnreadCount();
    return (
        <NavLink
            to="/notifications"
            className="relative inline-flex size-10 items-center justify-center rounded-control text-ink hover:bg-ink/5"
            aria-label={unread > 0 ? `${t("nav.notifications")} — ${t("notifications.unread", { n: unread })}` : t("nav.notifications")}
        >
            <Bell aria-hidden size={22} />
            {unread > 0 && (
                <span aria-hidden className="tabular absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-carmine px-1 text-center text-[0.6875rem] font-semibold leading-5 text-white">
                    {unread > 99 ? "99+" : unread}
                </span>
            )}
        </NavLink>
    );
}

export function UserMenu() {
    const { me, logout } = useAuth();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (!me) return null;
    const item = "flex min-h-11 items-center gap-2.5 px-4 text-sm text-ink hover:bg-paper";
    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen((value) => !value)}
                className="inline-flex min-h-10 max-w-48 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium hover:bg-ink/5"
            >
                <UserCircle aria-hidden size={22} />
                <span className="truncate">{me.user.name}</span>
                <CaretDown aria-hidden size={14} />
            </button>
            {open && (
                <div id={menuId} className="absolute end-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-sheet bg-surface py-1 shadow-float ring-1 ring-rule">
                    <p className="truncate px-4 py-2 text-xs text-graphite">{me.user.email}</p>
                    <Link className={item} to="/me/appointments" onClick={() => setOpen(false)}>
                        <CalendarCheck aria-hidden size={18} /> {t("nav.myAppointments")}
                    </Link>
                    <Link className={item} to="/workspace" onClick={() => setOpen(false)}>
                        <Buildings aria-hidden size={18} /> {t("nav.workspace")}
                    </Link>
                    {me.user.platformRole === "SUPER_ADMIN" && (
                        <Link className={item} to="/admin" onClick={() => setOpen(false)}>
                            <ShieldCheck aria-hidden size={18} /> {t("nav.admin")}
                        </Link>
                    )}
                    <Link className={item} to="/profile" onClick={() => setOpen(false)}>
                        <UserCircle aria-hidden size={18} /> {t("nav.profile")}
                    </Link>
                    <button
                        type="button"
                        className={cx(item, "w-full border-t border-rule text-carmine-deep")}
                        onClick={async () => {
                            setOpen(false);
                            await logout();
                            navigate("/");
                        }}
                    >
                        <SignOut aria-hidden size={18} className="flip-rtl" /> {t("nav.logout")}
                    </button>
                </div>
            )}
        </div>
    );
}

export function SkipLink() {
    const { t } = useI18n();
    return (
        <a href="#main" className="sr-only-focusable fixed start-3 top-3 z-[200] rounded-control bg-ink px-4 py-2 text-sm text-paper">
            {t("common.skipToContent")}
        </a>
    );
}
