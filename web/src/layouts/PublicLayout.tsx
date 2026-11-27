import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { List, X } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { buttonClass } from "@/components/ui/primitives";
import { LocaleSwitch, NotificationBell, SkipLink, UserMenu, Wordmark } from "@/components/shell/Shell";
import { VerifyEmailBanner } from "@/components/shell/VerifyEmailBanner";
import { cx } from "@/lib/cx";

export function PublicLayout() {
    const { t } = useI18n();
    const { me } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();

    // Move focus to the page content on navigation (screen readers) and close the mobile menu.
    useEffect(() => {
        setMenuOpen(false);
        document.getElementById("main")?.focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }, [location.pathname]);

    const link = ({ isActive }: { isActive: boolean }) =>
        cx("inline-flex min-h-10 items-center rounded-control px-3 text-sm font-medium", isActive ? "text-ink underline decoration-malachite decoration-2 underline-offset-8" : "text-graphite hover:text-ink");

    return (
        <div className="flex min-h-dvh flex-col">
            <SkipLink />
            <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
                <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-6">
                    <Wordmark />
                    <nav aria-label="Main" className="ms-4 hidden items-center gap-1 md:flex">
                        <NavLink to="/clinics" className={link}>
                            {t("nav.clinics")}
                        </NavLink>
                        {!me && (
                            <NavLink to="/workspace" className={link}>
                                {t("nav.forClinics")}
                            </NavLink>
                        )}
                    </nav>
                    <div className="ms-auto flex items-center gap-1">
                        <LocaleSwitch />
                        {me ? (
                            <>
                                <NotificationBell />
                                <div className="hidden md:block">
                                    <UserMenu />
                                </div>
                            </>
                        ) : (
                            <div className="hidden items-center gap-2 md:flex">
                                <NavLink to="/login" className={buttonClass("ghost", "sm")}>
                                    {t("nav.login")}
                                </NavLink>
                                <NavLink to="/signup" className={buttonClass("ink", "sm")}>
                                    {t("nav.signup")}
                                </NavLink>
                            </div>
                        )}
                        <button
                            type="button"
                            className="inline-flex size-10 items-center justify-center rounded-control hover:bg-ink/5 md:hidden"
                            aria-expanded={menuOpen}
                            aria-controls="mobile-nav"
                            aria-label={t("common.menu")}
                            onClick={() => setMenuOpen((open) => !open)}
                        >
                            {menuOpen ? <X aria-hidden size={22} /> : <List aria-hidden size={22} />}
                        </button>
                    </div>
                </div>
                {menuOpen && (
                    <nav id="mobile-nav" aria-label="Main" className="flex flex-col gap-1 border-t border-rule px-4 py-3 md:hidden">
                        <NavLink to="/clinics" className={link}>
                            {t("nav.clinics")}
                        </NavLink>
                        {me ? (
                            <>
                                <NavLink to="/me/appointments" className={link}>
                                    {t("nav.myAppointments")}
                                </NavLink>
                                <NavLink to="/workspace" className={link}>
                                    {t("nav.workspace")}
                                </NavLink>
                                {me.user.platformRole === "SUPER_ADMIN" && (
                                    <NavLink to="/admin" className={link}>
                                        {t("nav.admin")}
                                    </NavLink>
                                )}
                                <NavLink to="/profile" className={link}>
                                    {t("nav.profile")}
                                </NavLink>
                            </>
                        ) : (
                            <>
                                <NavLink to="/login" className={link}>
                                    {t("nav.login")}
                                </NavLink>
                                <NavLink to="/signup" className={link}>
                                    {t("nav.signup")}
                                </NavLink>
                            </>
                        )}
                    </nav>
                )}
            </header>
            <VerifyEmailBanner />
            <main id="main" tabIndex={-1} className="flex-1 outline-none">
                <Outlet />
            </main>
            <footer className="border-t border-rule">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-graphite md:px-6">
                    <span>
                        {t("brand")} · موعد
                    </span>
                    <nav aria-label="Footer" className="flex gap-4">
                        <NavLink to="/clinics" className="hover:text-ink">
                            {t("nav.clinics")}
                        </NavLink>
                        <NavLink to="/workspace" className="hover:text-ink">
                            {t("nav.forClinics")}
                        </NavLink>
                    </nav>
                </div>
            </footer>
        </div>
    );
}
