import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n";
import { insightsApi } from "@/api/endpoints";
import { Checkbox, EmptyState, ErrorPanel, PageHeader, Section, Segmented, SkeletonRows } from "@/components/ui/primitives";
import { useStaff } from "@/layouts/StaffLayout";
import { addDays, formatLocalDate, formatMoney, formatNumber, formatPercent, todayIn } from "@/lib/format";
import { NotAllowed } from "./StaffIndex";

type Range = "7" | "30" | "90";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="ledger-rule pt-3">
            <dt className="text-sm text-graphite">{label}</dt>
            <dd className="tabular mt-1 text-3xl font-semibold">{value}</dd>
            {hint && <dd className="mt-0.5 text-xs text-graphite">{hint}</dd>}
        </div>
    );
}

export default function AnalyticsPage() {
    const { t, pick, locale, dir } = useI18n();
    const { slug, zone, can } = useStaff();
    const [range, setRange] = useState<Range>("30");
    const [asTable, setAsTable] = useState(false);
    const to = todayIn(zone);
    const from = addDays(to, -(Number(range) - 1), zone);

    const query = useQuery({
        queryKey: ["staff", slug, "analytics", from, to],
        queryFn: () => insightsApi.overview(slug, { from, to }),
        placeholderData: keepPreviousData,
        enabled: can("analytics:read"),
    });

    if (!can("analytics:read")) return <NotAllowed />;
    const data = query.data;

    return (
        <div>
            <PageHeader
                title={t("analytics.title")}
                actions={
                    <Segmented
                        label={t("analytics.range")}
                        value={range}
                        onChange={setRange}
                        options={[
                            { value: "7", label: t("analytics.last7") },
                            { value: "30", label: t("analytics.last30") },
                            { value: "90", label: t("analytics.last90") },
                        ]}
                    />
                }
            />
            {query.isPending ? (
                <SkeletonRows rows={4} />
            ) : query.isError ? (
                <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
            ) : !data ? null : (
                <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
                    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Kpi label={t("analytics.appointments")} value={formatNumber(data.totals.appointments, locale)} hint={`${t("analytics.completed")}: ${formatNumber(data.totals.byStatus.COMPLETED, locale)}`} />
                        <Kpi label={t("analytics.noShowRate")} value={formatPercent(data.totals.noShowRate, locale)} />
                        <Kpi label={t("analytics.cancellationRate")} value={formatPercent(data.totals.cancellationRate, locale)} />
                        <Kpi label={t("analytics.newPatients")} value={formatNumber(data.totals.newPatients, locale)} hint={`${t("analytics.pending")}: ${formatNumber(data.totals.pendingUpcoming, locale)}`} />
                    </dl>

                    <Section title={t("analytics.revenue")}>
                        {data.revenue.length === 0 ? (
                            <p className="text-sm text-graphite">{t("analytics.noRevenue")}</p>
                        ) : (
                            <ul className="flex flex-wrap gap-8">
                                {data.revenue.map((r) => (
                                    <li key={r.currency}>
                                        <p className="tabular text-3xl font-semibold">{formatMoney(r.amount, r.currency, locale)}</p>
                                        <p className="text-sm text-graphite">
                                            {t("analytics.completed")}: {formatNumber(r.completedAppointments, locale)}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section title={t("analytics.daily")} actions={<Checkbox label={t("analytics.tableView")} checked={asTable} onChange={(e) => setAsTable(e.target.checked)} />}>
                        {data.totals.appointments === 0 ? (
                            <EmptyState title={t("analytics.empty")} />
                        ) : asTable ? (
                            <div className="max-h-96 overflow-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-surface">
                                        <tr className="text-xs text-graphite">
                                            <th scope="col" className="py-2 text-start font-medium">{t("analytics.date")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.total")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.completed")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.cancelled")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.noShow")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.daily.map((d) => (
                                            <tr key={d.date} className="ledger-rule tabular">
                                                <th scope="row" className="py-2 text-start font-normal">{formatLocalDate(d.date, zone, locale)}</th>
                                                <td className="py-2 text-end">{d.total}</td>
                                                <td className="py-2 text-end">{d.completed}</td>
                                                <td className="py-2 text-end">{d.cancelled}</td>
                                                <td className="py-2 text-end">{d.noShow}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <figure>
                                <figcaption className="sr-only">
                                    {t("analytics.daily")}: {formatNumber(data.totals.appointments, locale)}
                                </figcaption>
                                <div className="h-64" dir="ltr">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                                            <CartesianGrid vertical={false} stroke="#DDE1DD" />
                                            <XAxis dataKey="date" reversed={dir === "rtl"} tickFormatter={(d: string) => formatLocalDate(d, zone, locale).split(" ").slice(-2).join(" ")} tick={{ fill: "#56615C", fontSize: 12 }} interval="preserveStartEnd" minTickGap={24} />
                                            <YAxis allowDecimals={false} orientation={dir === "rtl" ? "right" : "left"} tick={{ fill: "#56615C", fontSize: 12 }} />
                                            <Tooltip
                                                labelFormatter={(d) => formatLocalDate(String(d), zone, locale, "long")}
                                                formatter={(value, name) => [value as number, name === "completed" ? t("analytics.completed") : t("analytics.total")]}
                                                contentStyle={{ borderRadius: 6, borderColor: "#B6BDB8", fontFamily: "inherit" }}
                                            />
                                            <Bar dataKey="total" fill="#56615C" radius={[3, 3, 0, 0]} name="total" />
                                            <Bar dataKey="completed" fill="#0B6E4F" radius={[3, 3, 0, 0]} name="completed" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="mt-2 flex gap-4 text-xs text-graphite">
                                    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-graphite" /> {t("analytics.total")}</span>
                                    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-malachite" /> {t("analytics.completed")}</span>
                                </p>
                            </figure>
                        )}
                    </Section>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Section title={t("analytics.byDoctor")}>
                            {data.byDoctor.length === 0 ? (
                                <p className="text-sm text-graphite">{t("analytics.empty")}</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-xs text-graphite">
                                            <th scope="col" className="py-2 text-start font-medium">{t("appt.doctor")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.total")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.completed")}</th>
                                            <th scope="col" className="py-2 text-end font-medium">{t("analytics.noShow")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.byDoctor.map((d) => (
                                            <tr key={d.id} className="ledger-rule tabular">
                                                <th scope="row" className="py-2 text-start font-medium">{pick(d.displayNameEn, d.displayNameAr)}</th>
                                                <td className="py-2 text-end">{d.total}</td>
                                                <td className="py-2 text-end">{d.completed}</td>
                                                <td className="py-2 text-end">{d.noShow}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Section>
                        <Section title={t("analytics.topServices")}>
                            {data.topServices.length === 0 ? (
                                <p className="text-sm text-graphite">{t("analytics.empty")}</p>
                            ) : (
                                <ul>
                                    {data.topServices.map((s) => {
                                        const max = data.topServices[0].count || 1;
                                        return (
                                            <li key={s.id} className="ledger-rule py-2.5 text-sm">
                                                <div className="flex justify-between gap-3">
                                                    <span>{pick(s.nameEn ?? `#${s.id}`, s.nameAr)}</span>
                                                    <span className="tabular font-semibold">{s.count}</span>
                                                </div>
                                                <div aria-hidden className="mt-1.5 h-1.5 rounded-full bg-ink/[0.06]">
                                                    <div className="h-full rounded-full bg-malachite" style={{ width: `${(s.count / max) * 100}%` }} />
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Section>
                    </div>
                    {data.truncated && <p className="text-xs text-graphite">{t("analytics.truncated")}</p>}
                </div>
            )}
        </div>
    );
}
