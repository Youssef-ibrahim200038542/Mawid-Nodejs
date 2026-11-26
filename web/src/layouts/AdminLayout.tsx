import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { ChartBar, Buildings, Users, ClockCounterClockwise } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { LocaleSwitch, NotificationBell, SkipLink, UserMenu, Wordmark } from "@/components/shell/Shell";
import { cx } from "@/lib/cx";

export default function AdminLayout() {
    const { t } = useI18n();
    const location = useLocation();
    useEffect(() => {
        document.getElementById("main")?.focus({ preventScroll: true });
    }, [location.pathname]);
    const items = [
        { to: "/admin", label: t("admin.overview"), Icon: ChartBar, end: true },
        { to: "/admin/clinics", label: t("admin.clinics"), Icon: Buildings, end: false },
        { to: "/admin/users", label: t("admin.users"), Icon: Users, end: false },
        { to: "/admin/audit", label: t("admin.audit"), Icon: ClockCounterClockwise, end: false },
    ];
    return (
        <div className="min-h-dvh">
            <SkipLink />
            <header className="sticky top-0 z-40 border-b border-rule bg-ink text-paper">
                <div className="flex h-16 items-center gap-4 px-4 md:px-6">
                    <div className="rounded-control bg-paper px-2 py-1">
                        <Wordmark to="/admin" />
                    </div>
                    <span className="text-sm font-semibold">{t("admin.title")}</span>
                    <div className="ms-auto flex items-center gap-1 rounded-control bg-paper px-1 text-ink">
                        <LocaleSwitch />
                        <NotificationBell />
                        <UserMenu />
                    </div>
                </div>
                <nav aria-label={t("admin.title")} className="flex gap-1 overflow-x-auto px-4 pb-2 md:px-6">
                    {items.map(({ to, label, Icon, end }) => (
                        <NavLink key={to} to={to} end={end} className={({ isActive }) => cx("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-medium", isActive ? "bg-paper text-ink" : "text-paper/85 hover:bg-paper/10")}>
                            <Icon aria-hidden size={18} /> {label}
                        </NavLink>
                    ))}
                </nav>
            </header>
            <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none md:px-6">
                <Outlet />
            </main>
        </div>
    );
}
