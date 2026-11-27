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
    const [bootstrapFor, setBootstrapFor] = useState<AdminClinic | null>(null);
    const [ownerId, setOwnerId] = useState<number | null>(null);

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

    // Bootstrap: only starts a re-confirmation; the owner must accept it with their confirmed email.
    const owners = useQuery({
        queryKey: ["admin", "clinic-owners", bootstrapFor?.id],
        queryFn: () => adminApi.clinicOwners(bootstrapFor!.id),
        enabled: Boolean(bootstrapFor),
    });
    const legacyOwners = (owners.data?.items ?? []).filter((o) => o.status === "ACTIVE" && o.trustState === "LEGACY_UNREVIEWED");
    const bootstrap = useMutation({
        mutationFn: () => adminApi.requestOwnerReconfirmation(bootstrapFor!.id, ownerId ?? legacyOwners[0].memberId),
        onSuccess: ({ delivery }) => {
            notify(delivery === "failed" ? t("team.delivery_failed") : `${t("admin.bootstrapSent")} · ${t(`team.delivery_${delivery}`)}`, delivery === "failed" ? "error" : undefined);
            setBootstrapFor(null);
            setOwnerId(null);
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
                                    <th scope="col" className="px-4 py-3 text-end font-medium">{t("admin.trustedOwners")}</th>
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
                                        <td className={c.trustedOwners > 0 ? "tabular px-4 py-3 text-end" : "px-4 py-3 text-end font-medium text-carmine-deep"}>
                                            {c.trustedOwners > 0 ? formatNumber(c.trustedOwners, locale) : t("admin.noTrustedOwner")}
                                        </td>
                                        <td className={c.status === "ACTIVE" ? "px-4 py-3 text-malachite-deep" : "px-4 py-3 text-carmine-deep"}>{c.status === "ACTIVE" ? t("common.active") : t("admin.suspendedClinics")}</td>
                                        <td className="flex flex-wrap justify-end gap-2 px-4 py-3">
                                            {c.trustedOwners === 0 && c.status === "ACTIVE" && (
                                                <Button size="sm" onClick={() => setBootstrapFor(c)}>
                                                    {t("admin.bootstrap")}
                                                </Button>
                                            )}
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
            <Dialog
                open={Boolean(bootstrapFor)}
                onClose={() => { setBootstrapFor(null); setOwnerId(null); bootstrap.reset(); }}
                title={bootstrapFor ? t("admin.bootstrapTitle", { name: bootstrapFor.name }) : ""}
                footer={
                    <>
                        <Button onClick={() => setBootstrapFor(null)}>{t("common.cancel")}</Button>
                        <Button variant="primary" disabled={legacyOwners.length === 0} loading={bootstrap.isPending} onClick={() => bootstrap.mutate()}>
                            {t("admin.bootstrap")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-graphite">{t("admin.bootstrapBody")}</p>
                    {bootstrap.isError && <ErrorSummary message={errorMessage(bootstrap.error)} />}
                    {owners.isPending ? (
                        <SkeletonRows rows={2} />
                    ) : owners.isError ? (
                        <ErrorPanel error={owners.error} onRetry={() => owners.refetch()} />
                    ) : legacyOwners.length === 0 ? (
                        <p className="text-sm">{t("admin.noLegacyOwner")}</p>
                    ) : (
                        <Field label={t("admin.chooseOwner")}>
                            {(p) => (
                                <Select {...p} value={ownerId ?? legacyOwners[0].memberId} onChange={(e) => setOwnerId(Number(e.target.value))}>
                                    {legacyOwners.map((o) => (
                                        <option key={o.memberId} value={o.memberId}>
                                            {o.user.name} · {o.user.emailHint} · {o.user.emailVerified ? t("admin.verified") : t("admin.unverified")}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
