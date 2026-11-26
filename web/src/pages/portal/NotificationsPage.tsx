import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellSimple } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { meApi } from "@/api/endpoints";
import type { AppNotification } from "@/api/types";
import { Button, Checkbox, EmptyState, ErrorPanel, PageHeader, Pagination, SkeletonRows } from "@/components/ui/primitives";
import { formatDate, formatRelative, formatTime } from "@/lib/format";
import { cx } from "@/lib/cx";

export function useNotificationText() {
    const { t, pick, locale } = useI18n();
    return (n: AppNotification) => {
        const p = n.payload;
        const key = n.type === "APPOINTMENT_BOOKED" ? `notifications.APPOINTMENT_BOOKED_${p.audience}` : `notifications.${n.type}`;
        return {
            title: t(key, { service: pick(p.service.nameEn, p.service.nameAr), doctor: pick(p.doctor.nameEn, p.doctor.nameAr) }),
            when: t("notifications.when", { date: formatDate(p.startsAt, p.timezone, locale, "short"), time: formatTime(p.startsAt, p.timezone, locale), clinic: p.clinic.name }),
        };
    };
}

export default function NotificationsPage() {
    const { t, locale } = useI18n();
    const { clinicBySlug } = useAuth();
    const queryClient = useQueryClient();
    const textOf = useNotificationText();
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [page, setPage] = useState(1);

    const query = useQuery({
        queryKey: ["notifications", "list", unreadOnly, page],
        queryFn: () => meApi.notifications({ unreadOnly, page, pageSize: 20 }),
        placeholderData: keepPreviousData,
    });
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
    const markOne = useMutation({ mutationFn: (id: number) => meApi.readNotification(id), onSuccess: invalidate });
    const markAll = useMutation({ mutationFn: () => meApi.readAllNotifications(), onSuccess: invalidate });

    // Staff notifications open the clinic workspace; patient ones open "my appointments".
    const linkFor = (n: AppNotification) => {
        if (n.payload.audience === "staff" && clinicBySlug(n.payload.clinic.slug)) return `/c/${n.payload.clinic.slug}/appointments?focus=${n.payload.appointmentId}`;
        return "/me/appointments";
    };

    return (
        <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
            <PageHeader
                title={t("notifications.title")}
                description={query.data ? t("notifications.unread", { n: query.data.unread }) : undefined}
                actions={
                    <Button size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={!query.data || query.data.unread === 0}>
                        {t("notifications.markAll")}
                    </Button>
                }
            />
            <Checkbox
                label={t("notifications.onlyUnread")}
                checked={unreadOnly}
                onChange={(e) => {
                    setUnreadOnly(e.target.checked);
                    setPage(1);
                }}
            />
            <div className="mt-4">
                {query.isPending ? (
                    <SkeletonRows rows={4} />
                ) : query.isError ? (
                    <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
                ) : query.data.items.length === 0 ? (
                    <EmptyState icon={<BellSimple size={28} aria-hidden />} title={t("notifications.empty")} />
                ) : (
                    <>
                        <ul>
                            {query.data.items.map((n) => {
                                const text = textOf(n);
                                const unread = !n.readAt;
                                return (
                                    <li key={n.id} className={cx("ledger-rule flex items-start gap-3 py-4", unread && "bg-malachite-tint/40")}>
                                        <span aria-hidden className={cx("mt-2 size-2.5 shrink-0 rounded-full", unread ? "bg-malachite" : "bg-transparent")} />
                                        <div className="min-w-0 flex-1">
                                            <p className={cx("text-sm", unread && "font-semibold")}>
                                                {unread && <span className="sr-only">{t("notifications.unread", { n: 1 })}: </span>}
                                                {text.title}
                                            </p>
                                            <p className="text-sm text-graphite">{text.when}</p>
                                            <p className="mt-0.5 text-xs text-graphite">{formatRelative(n.createdAt, locale)}</p>
                                        </div>
                                        <Link
                                            to={linkFor(n)}
                                            onClick={() => unread && markOne.mutate(n.id)}
                                            className="inline-flex min-h-10 items-center rounded-control px-3 text-sm font-medium text-malachite-deep hover:bg-malachite-tint"
                                        >
                                            {t("notifications.open")}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                        <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
                    </>
                )}
            </div>
        </div>
    );
}
