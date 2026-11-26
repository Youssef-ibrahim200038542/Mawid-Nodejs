import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { adminApi } from "@/api/endpoints";
import type { AdminUser } from "@/api/types";
import { Button, EmptyState, ErrorPanel, Field, PageHeader, Pagination, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatNumber } from "@/lib/format";

export default function AdminUsersPage() {
    const { t, locale, errorMessage } = useI18n();
    const { me } = useAuth();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [q, setQ] = useState("");
    const [page, setPage] = useState(1);
    useEffect(() => {
        const id = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
        return () => clearTimeout(id);
    }, [search]);

    const list = useQuery({ queryKey: ["admin", "users", q, page], queryFn: () => adminApi.users({ q: q || undefined, page, pageSize: 25 }), placeholderData: keepPreviousData });
    const setRole = useMutation({
        mutationFn: (u: AdminUser) => adminApi.setUserRole(u.id, u.platformRole === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN"),
        onSuccess: () => {
            notify(t("admin.roleChanged"));
            queryClient.invalidateQueries({ queryKey: ["admin"] });
        },
        onError: (error) => notify(errorMessage(error), "error"),
    });

    return (
        <div>
            <PageHeader title={t("admin.users")} />
            <Field label={t("admin.searchUsers")} className="mb-5 max-w-md">{(p) => <TextInput {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}</Field>
            {list.isPending ? (
                <SkeletonRows rows={5} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.items.length === 0 ? (
                <EmptyState title={t("common.nothingHere")} />
            ) : (
                <>
                    <ul>
                        {list.data.items.map((u) => (
                            <li key={u.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-medium">
                                        {u.name} {u.platformRole === "SUPER_ADMIN" && <span className="ms-1 rounded-full bg-ink px-2 py-0.5 text-xs text-paper">{t("roles.SUPER_ADMIN")}</span>}
                                    </p>
                                    <p className="truncate text-sm text-graphite">
                                        {u.email} · {t("admin.memberships")}: {formatNumber(u._count.memberships, locale)} · {formatDate(u.createdAt, "Africa/Cairo", locale, "short")}
                                    </p>
                                </div>
                                {u.id !== me?.user.id && (
                                    <Button size="sm" loading={setRole.isPending && setRole.variables?.id === u.id} onClick={() => setRole.mutate(u)}>
                                        {u.platformRole === "SUPER_ADMIN" ? t("admin.removeAdmin") : t("admin.makeAdmin")}
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
                </>
            )}
        </div>
    );
}
