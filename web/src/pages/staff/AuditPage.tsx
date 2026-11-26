import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { insightsApi } from "@/api/endpoints";
import { EmptyState, ErrorPanel, Field, PageHeader, Pagination, Select, SkeletonRows } from "@/components/ui/primitives";
import { AuditList, auditActions } from "@/components/staff/AuditList";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

export default function AuditPage() {
    const { t } = useI18n();
    const { slug, zone, can } = useStaff();
    const [action, setAction] = useState("");
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ["staff", slug, "audit", action, page],
        queryFn: () => insightsApi.auditLogs(slug, { action: action || undefined, page, pageSize: 50 }),
        placeholderData: keepPreviousData,
        enabled: can("audit:read"),
    });
    if (!can("audit:read")) return <NotAllowed />;
    return (
        <div>
            <PageHeader title={t("audit.title")} />
            <Field label={t("audit.filter")} className="mb-5 max-w-sm">
                {(p) => (
                    <Select {...p} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
                        <option value="">{t("audit.anyAction")}</option>
                        {auditActions.filter((a) => !a.startsWith("admin.")).map((a) => <option key={a} value={a}>{a}</option>)}
                    </Select>
                )}
            </Field>
            {query.isPending ? (
                <SkeletonRows rows={6} />
            ) : query.isError ? (
                <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
            ) : query.data.items.length === 0 ? (
                <EmptyState title={t("audit.empty")} />
            ) : (
                <>
                    <AuditList items={query.data.items} zone={zone} />
                    <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
                </>
            )}
        </div>
    );
}
