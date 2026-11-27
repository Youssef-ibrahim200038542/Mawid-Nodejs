import { useEffect, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from "react-router";
import {
    CalendarDots,
    ListChecks,
    CalendarPlus,
    Users,
    Stethoscope,
    Tag,
    FirstAidKit,
    Clock,
    UsersThree,
    ChartLineUp,
    ClockCounterClockwise,
    GearSix,
    Sun,
    CalendarCheck,
    List,
    X,
    ArrowSquareOut,
} from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { can, type Permission } from "@/auth/permissions";
import type { MyClinic } from "@/api/types";
import { LocaleSwitch, NotificationBell, SkipLink, UserMenu, Wordmark } from "@/components/shell/Shell";
import NotFoundPage from "@/pages/NotFoundPage";
import { ButtonLink, EmptyState } from "@/components/ui/primitives";
import { cx } from "@/lib/cx";

export interface StaffContext {
    clinic: MyClinic;
    slug: string;
    zone: string;
    can: (permission: Permission) => boolean;
}

export function useStaff() {
    return useOutletContext<StaffContext>();
}

interface NavItem {
    to: string;
    label: string;
    Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
    show: boolean;
}

export default function StaffLayout() {
    const { slug = "" } = useParams();
    const { t } = useI18n();
    const { clinicBySlug, me } = useAuth();
    const [drawer, setDrawer] = useState(false);
    const location = useLocation();
    const clinic = clinicBySlug(slug);

    useEffect(() => {
        setDrawer(false);
        document.getElementById("main")?.focus({ preventScroll: true });
    }, [location.pathname]);

    if (!clinic) return <NotFoundPage />;
    // Mirrors loadTenant (the API refuses with 403 anyway): a legacy membership awaiting
    // re-confirmation, or an unconfirmed email, never opens the workspace.
    if (clinic.trustState !== "TRUSTED" || !me?.user.emailVerified) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-16">
                <EmptyState
                    title={clinic.trustState !== "TRUSTED" ? t("workspace.awaitingTitle") : t("errors.EMAIL_NOT_VERIFIED")}
                    body={clinic.trustState !== "TRUSTED" ? t("workspace.reconfirmPageBody") : t("account.bannerText")}
                    action={<ButtonLink to="/workspace">{t("workspace.switchClinic")}</ButtonLink>}
                />
            </div>
        );
    }
    const allowed = (p: Permission) => can(clinic.role, p);
    const base = `/c/${slug}`;

    const groups: { label: string; items: NavItem[] }[] = [
        {
            label: t("staffNav.groupDay"),
            items: [
                { to: `${base}/today`, label: t("staffNav.today"), Icon: Sun, show: true },
                { to: `${base}/calendar`, label: t("staffNav.calendar"), Icon: CalendarDots, show: true },
                { to: `${base}/appointments`, label: t("staffNav.appointments"), Icon: ListChecks, show: true },
                { to: `${base}/appointments/new`, label: t("staffNav.newBooking"), Icon: CalendarPlus, show: allowed("appointments:create") },
                { to: `${base}/patients`, label: t("staffNav.patients"), Icon: Users, show: allowed("patients:read") },
                { to: `${base}/my-schedule`, label: t("staffNav.mySchedule"), Icon: CalendarCheck, show: clinic.role === "DOCTOR" || (clinic.role === "OWNER" && clinic.doctorProfileId !== null) },
            ],
        },
        {
            label: t("staffNav.groupSetup"),
            items: [
                { to: `${base}/doctors`, label: t("staffNav.doctors"), Icon: Stethoscope, show: allowed("doctors:manage") },
                { to: `${base}/services`, label: t("staffNav.services"), Icon: FirstAidKit, show: allowed("services:manage") },
                { to: `${base}/specialties`, label: t("staffNav.specialties"), Icon: Tag, show: allowed("specialties:manage") },
                { to: `${base}/hours`, label: t("staffNav.hours"), Icon: Clock, show: allowed("schedule:manage") },
                { to: `${base}/team`, label: t("staffNav.team"), Icon: UsersThree, show: allowed("members:manage") },
                { to: `${base}/settings`, label: t("staffNav.settings"), Icon: GearSix, show: allowed("clinic:update") },
            ],
        },
        {
            label: t("staffNav.groupInsight"),
            items: [
                { to: `${base}/analytics`, label: t("staffNav.analytics"), Icon: ChartLineUp, show: allowed("analytics:read") },
                { to: `${base}/audit`, label: t("staffNav.audit"), Icon: ClockCounterClockwise, show: allowed("audit:read") },
            ],
        },
    ];

    const navContent = (
        <nav aria-label={t("nav.workspace")} className="flex flex-col gap-6">
            {groups.map((group) => {
                const items = group.items.filter((i) => i.show);
                if (items.length === 0) return null;
                return (
                    <div key={group.label}>
                        <p className="mb-1.5 px-3 text-xs font-medium text-graphite">{group.label}</p>
                        <ul className="flex flex-col gap-0.5">
                            {items.map(({ to, label, Icon }) => (
                                <li key={to}>
                                    <NavLink
                                        to={to}
                                        end
                                        className={({ isActive }) =>
                                            cx(
                                                "flex min-h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors",
                                                isActive ? "bg-ink text-paper" : "text-ink hover:bg-ink/5"
                                            )
                                        }
                                    >
                                        <Icon aria-hidden size={18} />
                                        {label}
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
            <a href={`/clinics/${slug}`} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-3 rounded-control px-3 text-sm text-graphite hover:text-ink">
                <ArrowSquareOut aria-hidden size={18} /> {t("settings.publicPage")}
            </a>
        </nav>
    );

    const context: StaffContext = { clinic, slug, zone: clinic.timezone, can: allowed };

    return (
        <div className="min-h-dvh">
            <SkipLink />
            <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur">
                <div className="flex h-16 items-center gap-3 px-4 md:px-6">
                    <button
                        type="button"
                        className="inline-flex size-10 items-center justify-center rounded-control hover:bg-ink/5 lg:hidden"
                        aria-expanded={drawer}
                        aria-controls="staff-nav"
                        aria-label={t("common.menu")}
                        onClick={() => setDrawer((open) => !open)}
                    >
                        {drawer ? <X aria-hidden size={22} /> : <List aria-hidden size={22} />}
                    </button>
                    <Wordmark to={base} />
                    <span aria-hidden className="hidden h-6 w-px bg-rule sm:block" />
                    <div className="hidden min-w-0 sm:block">
                        <p className="truncate text-sm font-semibold">{clinic.name}</p>
                        <p className="text-xs text-graphite">{t(`roles.${clinic.role}`)}</p>
                    </div>
                    {me && me.clinics.length > 1 && (
                        <Link to="/workspace" className="hidden text-xs font-medium text-malachite-deep hover:underline md:inline">
                            {t("workspace.switchClinic")}
                        </Link>
                    )}
                    <div className="ms-auto flex items-center gap-1">
                        <LocaleSwitch />
                        <NotificationBell />
                        <UserMenu />
                    </div>
                </div>
            </header>
            <div className="flex">
                <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 overflow-y-auto border-e border-rule px-3 py-6 lg:block">{navContent}</aside>
                {drawer && (
                    <div id="staff-nav" className="fixed inset-0 top-16 z-30 overflow-y-auto bg-paper px-3 py-6 lg:hidden">
                        <p className="mb-4 px-3 text-sm font-semibold sm:hidden">{clinic.name}</p>
                        {navContent}
                    </div>
                )}
                <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
                    <Outlet context={context} />
                </main>
            </div>
        </div>
    );
}
