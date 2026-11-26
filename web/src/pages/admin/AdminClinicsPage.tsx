import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { adminApi } from "@/api/endpoints";
import type { AdminClinic, ClinicStatus } from "@/api/types";
import { Button, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, Pagination, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatNumber } from "@/lib/format";

export default function AdminClinicsPage() {
    const { t, locale, errorMessage } = useI18n();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<ClinicStatus | "">("");
    const [page, setPage] = useState(1);
    const [target, setTarget] = useState<AdminClinic | null>(null);
    const [reason, setReason] = useState("");

    useEffect(() => {
        const id = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
        return () => clearTimeout(id);
    }, [search]);

    const list = useQuery({
        queryKey: ["admin", "clinics", q, status, page],
        queryFn: () => adminApi.clinics({ q: q || undefined, status: status || undefined, page, pageSize: 25 }),
        placeholderData: keepPreviousData,
    });
    const change = useMutation({
        mutationFn: (c: AdminClinic) => adminApi.setClinicStatus(c.id, { status: c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", reason: reason.trim() || undefined }),
        onSuccess: ({ clinic }) => {
            notify(clinic.status === "SUSPENDED" ? t("admin.suspended") : t("admin.reactivated"));
            setTarget(null);
            setReason("");
            queryClient.invalidateQueries({ queryKey: ["admin"] });
        },
    });

    return (
        <div>
            <PageHeader title={t("admin.clinics")} />
            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_14rem]">
                <Field label={t("admin.searchClinics")}>{(p) => <TextInput {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}</Field>
                <Field label={t("appt.status")}>
                    {(p) => (
                        <Select {...p} value={status} onChange={(e) => { setStatus(e.target.value as ClinicStatus | ""); setPage(1); }}>
                            <option value="">{t("admin.anyStatus")}</option>
                            <option value="ACTIVE">{t("common.active")}</option>
                            <option value="SUSPENDED">{t("admin.suspendedClinics")}</option>
                        </Select>
                    )}
                </Field>
            </div>
            {list.isPending ? (
                <SkeletonRows rows={5} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.items.length === 0 ? (
                <EmptyState title={t("common.nothingHere")} />
            ) : (
                <>
                    <div className="overflow-x-auto rounded-sheet bg-surface ring-1 ring-rule">
                        <table className="w-full min-w-[48rem] text-sm">
                            <thead>
                                <tr className="text-xs text-graphite">
                                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("workspace.clinicName")}</th>
                                    <th scope="col" className="px-4 py-3 text-end font-medium">{t("admin.members")}</th>
                                    <th scope="col" className="px-4 py-3 text-end font-medium">{t("admin.doctors")}</th>
                                    <th scope="col" className="px-4 py-3 text-end font-medium">{t("admin.appointments")}</th>
                                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("appt.status")}</th>
                                    <th scope="col" className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.data.items.map((c) => (
                                    <tr key={c.id} className="ledger-rule">
                                        <td className="px-4 py-3">
                                            <a href={`/clinics/${c.slug}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{c.name}</a>
                                            <span className="block text-xs text-graphite" dir="ltr">/{c.slug} · {c.city ?? "—"} · {formatDate(c.createdAt, c.timezone, locale, "short")}</span>
                                        </td>
                                        <td className="tabular px-4 py-3 text-end">{formatNumber(c._count.members, locale)}</td>
                                        <td className="tabular px-4 py-3 text-end">{formatNumber(c._count.doctors, locale)}</td>
                                        <td className="tabular px-4 py-3 text-end">{formatNumber(c._count.appointments, locale)}</td>
                                        <td className={c.status === "ACTIVE" ? "px-4 py-3 text-malachite-deep" : "px-4 py-3 text-carmine-deep"}>{c.status === "ACTIVE" ? t("common.active") : t("admin.suspendedClinics")}</td>
                                        <td className="px-4 py-3 text-end">
                                            <Button size="sm" variant={c.status === "ACTIVE" ? "dangerGhost" : "secondary"} onClick={() => setTarget(c)}>
                                                {c.status === "ACTIVE" ? t("admin.suspend") : t("admin.reactivate")}
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
                </>
            )}
            <Dialog
                open={Boolean(target)}
                onClose={() => { setTarget(null); change.reset(); }}
                title={target ? (target.status === "ACTIVE" ? t("admin.suspendTitle", { name: target.name }) : t("admin.reactivate")) : ""}
                footer={
                    <>
                        <Button onClick={() => setTarget(null)}>{t("common.cancel")}</Button>
                        <Button variant={target?.status === "ACTIVE" ? "danger" : "primary"} loading={change.isPending} onClick={() => target && change.mutate(target)}>
                            {target?.status === "ACTIVE" ? t("admin.suspend") : t("admin.reactivate")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    {change.isError && <ErrorSummary message={errorMessage(change.error)} />}
                    {target?.status === "ACTIVE" && <p className="text-sm text-graphite">{t("admin.suspendBody")}</p>}
                    <Field label={t("admin.reason")} optional>{(p) => <TextInput {...p} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
                </div>
            </Dialog>
        </div>
    );
}
