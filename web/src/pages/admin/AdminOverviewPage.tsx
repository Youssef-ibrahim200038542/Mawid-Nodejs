import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { adminApi } from "@/api/endpoints";
import { ErrorPanel, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/format";

export default function AdminOverviewPage() {
    const { t, locale } = useI18n();
    const query = useQuery({ queryKey: ["admin", "overview"], queryFn: adminApi.overview });
    if (query.isPending) return <SkeletonRows rows={3} />;
    if (query.isError) return <ErrorPanel error={query.error} onRetry={() => query.refetch()} />;
    const d = query.data;
    const kpis = [
        [t("admin.activeClinics"), d.clinics.ACTIVE ?? 0, null],
        [t("admin.suspendedClinics"), d.clinics.SUSPENDED ?? 0, null],
        [t("admin.totalUsers"), d.users, `${t("admin.superAdmins")}: ${formatNumber(d.superAdmins, locale)}`],
        [t("admin.patients"), d.patients, null],
        [t("admin.appointments"), d.appointments.total, t("admin.last30", { n: formatNumber(d.appointments.last30Days, locale) })],
    ] as const;
    return (
        <div>
            <PageHeader title={t("admin.overview")} />
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                {kpis.map(([label, value, hint]) => (
                    <div key={label} className="ledger-rule pt-3">
                        <dt className="text-sm text-graphite">{label}</dt>
                        <dd className="tabular mt-1 text-3xl font-semibold">{formatNumber(value, locale)}</dd>
                        {hint && <dd className="mt-0.5 text-xs text-graphite">{hint}</dd>}
                    </div>
                ))}
            </dl>
        </div>
    );
}
