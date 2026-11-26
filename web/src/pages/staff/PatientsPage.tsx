import { useEffect, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MagnifyingGlass, Plus, Users } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { patientsApi } from "@/api/endpoints";
import { Button, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, Pagination, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

const phonePattern = /^\+?[0-9 ()-]{6,30}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PatientForm({
    initial,
    submitLabel,
    pending,
    error,
    onSubmit,
}: {
    initial: { fullName: string; phone: string; email: string };
    submitLabel: string;
    pending: boolean;
    error: unknown;
    onSubmit: (values: { fullName: string; phone: string | null; email: string | null }) => void;
}) {
    const { t, errorMessage } = useI18n();
    const [values, setValues] = useState(initial);
    const [errors, setErrors] = useState<Record<string, string>>({});
    return (
        <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                const next: Record<string, string> = {};
                if (values.fullName.trim().length < 2) next.fullName = t("validation.nameMin");
                if (values.phone.trim() && !phonePattern.test(values.phone.trim())) next.phone = t("validation.phone");
                if (values.email.trim() && !emailPattern.test(values.email.trim())) next.email = t("validation.email");
                setErrors(next);
                if (Object.keys(next).length) return;
                onSubmit({ fullName: values.fullName.trim(), phone: values.phone.trim() || null, email: values.email.trim() || null });
            }}
        >
            {Boolean(error) && <ErrorSummary message={errorMessage(error)} />}
            <Field label={t("patients.fullName")} error={errors.fullName}>
                {(p) => <TextInput {...p} value={values.fullName} maxLength={150} onChange={(e) => setValues({ ...values, fullName: e.target.value })} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("patients.phone")} optional error={errors.phone}>
                    {(p) => <TextInput {...p} type="tel" dir="ltr" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />}
                </Field>
                <Field label={t("patients.email")} optional error={errors.email}>
                    {(p) => <TextInput {...p} type="email" dir="ltr" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
                </Field>
            </div>
            <div>
                <Button type="submit" variant="primary" loading={pending}>
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}

export default function PatientsPage() {
    const { t } = useI18n();
    const { slug, can } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [q, setQ] = useState("");
    const [page, setPage] = useState(1);
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        const id = setTimeout(() => {
            setQ(search.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(id);
    }, [search]);

    const list = useQuery({
        queryKey: ["staff", slug, "patients", "list", q, page],
        queryFn: () => patientsApi.list(slug, { q: q || undefined, page, pageSize: 25 }),
        placeholderData: keepPreviousData,
        enabled: can("patients:read"),
    });
    const create = useMutation({
        mutationFn: (values: { fullName: string; phone: string | null; email: string | null }) => patientsApi.create(slug, values),
        onSuccess: () => {
            notify(t("patients.created"));
            setAdding(false);
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "patients"] });
        },
    });

    if (!can("patients:read")) return <NotAllowed />;

    return (
        <div>
            <PageHeader
                title={t("patients.title")}
                actions={
                    can("patients:manage") && (
                        <Button variant="ink" icon={<Plus aria-hidden size={18} />} onClick={() => setAdding(true)}>
                            {t("patients.add")}
                        </Button>
                    )
                }
            />
            <div className="relative mb-5 max-w-md">
                <MagnifyingGlass aria-hidden size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-graphite" />
                <TextInput type="search" aria-label={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("patients.searchPlaceholder")} className="ps-10" />
            </div>
            {list.isPending ? (
                <SkeletonRows rows={5} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.items.length === 0 ? (
                <EmptyState icon={<Users size={28} aria-hidden />} title={q ? t("patients.noMatch") : t("patients.empty")} />
            ) : (
                <>
                    <div className="overflow-x-auto rounded-sheet bg-surface ring-1 ring-rule">
                        <table className="w-full min-w-[36rem] text-sm">
                            <thead>
                                <tr className="text-start text-xs text-graphite">
                                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("patients.fullName")}</th>
                                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("patients.phone")}</th>
                                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("patients.email")}</th>
                                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("patients.account")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.data.items.map((p) => (
                                    <tr key={p.id} className="ledger-rule hover:bg-paper">
                                        <td className="px-4 py-3">
                                            <Link to={`/c/${slug}/patients/${p.id}`} className="font-medium text-ink hover:text-malachite-deep hover:underline">
                                                {p.fullName}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3" dir="ltr">{p.phone ?? "—"}</td>
                                        <td className="px-4 py-3">{p.email ?? "—"}</td>
                                        <td className="px-4 py-3 text-graphite">{p.hasAccount ? t("appt.hasAccount") : t("appt.walkIn")}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
                </>
            )}
            <Dialog open={adding} onClose={() => { setAdding(false); create.reset(); }} title={t("patients.add")}>
                {adding && <PatientForm initial={{ fullName: "", phone: "", email: "" }} submitLabel={t("patients.add")} pending={create.isPending} error={create.error} onSubmit={(v) => create.mutate(v)} />}
            </Dialog>
        </div>
    );
}
