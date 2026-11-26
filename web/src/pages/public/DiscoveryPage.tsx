import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { publicApi } from "@/api/endpoints";
import { ClinicCard } from "@/components/public/ClinicCard";
import { Button, EmptyState, ErrorPanel, Field, PageHeader, Pagination, SkeletonRows, TextInput } from "@/components/ui/primitives";

export default function DiscoveryPage() {
    const { t } = useI18n();
    const [params, setParams] = useSearchParams();
    const q = params.get("q") ?? "";
    const city = params.get("city") ?? "";
    const page = Number(params.get("page") ?? 1) || 1;
    const [draftQ, setDraftQ] = useState(q);
    const [draftCity, setDraftCity] = useState(city);

    const query = useQuery({
        queryKey: ["public", "clinics", q, city, page],
        queryFn: () => publicApi.clinics({ q, city, page, pageSize: 12 }),
        placeholderData: keepPreviousData,
    });

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        const next = new URLSearchParams();
        if (draftQ.trim()) next.set("q", draftQ.trim());
        if (draftCity.trim()) next.set("city", draftCity.trim());
        setParams(next);
    };

    return (
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
            <PageHeader title={t("discovery.title")} description={query.data ? t("discovery.results", { n: query.data.total }) : undefined} />
            <form onSubmit={onSubmit} role="search" className="mb-8 grid gap-3 sm:grid-cols-[1fr_0.7fr_auto] sm:items-end">
                <Field label={t("home.searchLabel")}>{(p) => <TextInput {...p} value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder={t("home.searchPlaceholder")} />}</Field>
                <Field label={t("home.cityLabel")}>{(p) => <TextInput {...p} value={draftCity} onChange={(e) => setDraftCity(e.target.value)} placeholder={t("home.cityPlaceholder")} />}</Field>
                <Button type="submit" variant="primary" icon={<MagnifyingGlass aria-hidden size={18} />}>
                    {t("common.search")}
                </Button>
            </form>

            {query.isPending ? (
                <SkeletonRows rows={4} />
            ) : query.isError ? (
                <ErrorPanel error={query.error} onRetry={() => query.refetch()} />
            ) : query.data.items.length === 0 ? (
                <EmptyState
                    title={t("discovery.empty")}
                    action={
                        (q || city) && (
                            <Button
                                size="sm"
                                onClick={() => {
                                    setDraftQ("");
                                    setDraftCity("");
                                    setParams(new URLSearchParams());
                                }}
                            >
                                {t("discovery.clear")}
                            </Button>
                        )
                    }
                />
            ) : (
                <>
                    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {query.data.items.map((clinic) => (
                            <li key={clinic.slug}>
                                <ClinicCard clinic={clinic} />
                            </li>
                        ))}
                    </ul>
                    <Pagination
                        page={query.data.page}
                        pageSize={query.data.pageSize}
                        total={query.data.total}
                        onPage={(next) => {
                            const copy = new URLSearchParams(params);
                            copy.set("page", String(next));
                            setParams(copy);
                        }}
                    />
                </>
            )}
        </div>
    );
}
