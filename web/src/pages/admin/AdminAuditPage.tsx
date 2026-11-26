import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { adminApi } from "@/api/endpoints";
import { EmptyState, ErrorPanel, Field, PageHeader, Pagination, Select, SkeletonRows } from "@/components/ui/primitives";
import { AuditList, auditActions } from "@/components/staff/AuditList";

export default function AdminAuditPage() {
    const { t } = useI18n();
    const [action, setAction] = useState("");
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ["admin", "audit", action, page],
        queryFn: () => adminApi.auditLogs({ action: action || undefined, page, pageSize: 50 }),
        placeholderData: keepPreviousData,
    });
    return (
        <div>
            <PageHeader title={t("admin.audit")} />
            <Field label={t("audit.filter")} className="mb-5 max-w-sm">
                {(p) => (
                    <Select {...p} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
                        <option value="">{t("audit.anyAction")}</option>
                        {auditActions.map((a) => <option key={a} value={a}>{a}</option>)}
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
                    <AuditList items={query.data.items} zone="Africa/Cairo" showClinic />
                    <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
                </>
            )}
        </div>
    );
}
