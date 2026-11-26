import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, FirstAidKit } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { servicesApi, type ServiceInput } from "@/api/endpoints";
import type { Service } from "@/api/types";
import { Button, Checkbox, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, Select, SkeletonRows, TextArea, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { formatMoney } from "@/lib/format";
import { NotAllowed } from "./StaffIndex";

const currencies = ["EGP", "USD", "EUR", "SAR", "AED"];
const pricePattern = /^\d{1,7}(\.\d{1,2})?$/;

function ServiceForm({ initial, onSubmit, pending, error }: { initial?: Service; onSubmit: (v: ServiceInput) => void; pending: boolean; error: unknown }) {
    const { t, errorMessage } = useI18n();
    const [v, setV] = useState({
        nameEn: initial?.nameEn ?? "",
        nameAr: initial?.nameAr ?? "",
        descriptionEn: initial?.descriptionEn ?? "",
        descriptionAr: initial?.descriptionAr ?? "",
        durationMinutes: String(initial?.durationMinutes ?? 30),
        price: initial?.price ?? "",
        currency: initial?.currency ?? "EGP",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    return (
        <form
            id="service-form"
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
                event.preventDefault();
                const next: Record<string, string> = {};
                if (v.nameEn.trim().length < 2) next.nameEn = t("validation.nameMin");
                const duration = Number(v.durationMinutes);
                if (!Number.isInteger(duration) || duration < 5 || duration > 480) next.durationMinutes = t("validation.duration");
                if (!pricePattern.test(v.price.trim())) next.price = t("validation.price");
                setErrors(next);
                if (Object.keys(next).length) return;
                onSubmit({
                    nameEn: v.nameEn.trim(),
                    nameAr: v.nameAr.trim() || null,
                    descriptionEn: v.descriptionEn.trim() || null,
                    descriptionAr: v.descriptionAr.trim() || null,
                    durationMinutes: duration,
                    price: v.price.trim(),
                    currency: v.currency,
                });
            }}
        >
            {Boolean(error) && (
                <div className="sm:col-span-2">
                    <ErrorSummary message={errorMessage(error)} />
                </div>
            )}
            <Field label={t("services.nameEn")} error={errors.nameEn}>{(p) => <TextInput {...p} maxLength={150} value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} />}</Field>
            <Field label={t("services.nameAr")} optional>{(p) => <TextInput {...p} dir="rtl" lang="ar" maxLength={150} value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} />}</Field>
            <Field label={t("services.duration")} error={errors.durationMinutes}>{(p) => <TextInput {...p} type="number" inputMode="numeric" min={5} max={480} step={5} value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: e.target.value })} />}</Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
                <Field label={t("services.price")} error={errors.price}>{(p) => <TextInput {...p} inputMode="decimal" dir="ltr" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} placeholder="350.00" />}</Field>
                <Field label={t("services.currency")}>
                    {(p) => (
                        <Select {...p} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
                            {currencies.map((c) => (
                                <option key={c}>{c}</option>
                            ))}
                        </Select>
                    )}
                </Field>
            </div>
            <Field label={t("services.descriptionEn")} optional>{(p) => <TextArea {...p} maxLength={2000} value={v.descriptionEn} onChange={(e) => setV({ ...v, descriptionEn: e.target.value })} />}</Field>
            <Field label={t("services.descriptionAr")} optional>{(p) => <TextArea {...p} dir="rtl" lang="ar" maxLength={2000} value={v.descriptionAr} onChange={(e) => setV({ ...v, descriptionAr: e.target.value })} />}</Field>
            <div className="sm:col-span-2">
                <Button type="submit" variant="primary" loading={pending}>
                    {initial ? t("common.save") : t("services.add")}
                </Button>
            </div>
        </form>
    );
}

export default function ServicesPage() {
    const { t, pick, locale } = useI18n();
    const { slug, can } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<Service | "new" | null>(null);
    const [showInactive, setShowInactive] = useState(true);

    const list = useQuery({ queryKey: ["staff", slug, "services", "all"], queryFn: () => servicesApi.list(slug, true) });
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "services"] });
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
    };
    const save = useMutation({
        mutationFn: (v: ServiceInput) => (editing && editing !== "new" ? servicesApi.update(slug, editing.id, v) : servicesApi.create(slug, v)),
        onSuccess: () => {
            notify(editing === "new" ? t("services.created") : t("services.saved"));
            setEditing(null);
            invalidate();
        },
    });
    const toggle = useMutation({
        mutationFn: (s: Service) => servicesApi.update(slug, s.id, { isActive: !s.isActive }),
        onSuccess: () => {
            notify(t("services.saved"));
            invalidate();
        },
    });

    if (!can("services:manage")) return <NotAllowed />;
    const items = (list.data?.services ?? []).filter((s) => showInactive || s.isActive);

    return (
        <div className="max-w-4xl">
            <PageHeader title={t("services.title")} actions={<Button variant="ink" icon={<Plus aria-hidden size={18} />} onClick={() => setEditing("new")}>{t("services.add")}</Button>} />
            <Checkbox label={t("common.showInactive")} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <div className="mt-3">
                {list.isPending ? (
                    <SkeletonRows rows={3} />
                ) : list.isError ? (
                    <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
                ) : items.length === 0 ? (
                    <EmptyState icon={<FirstAidKit size={28} aria-hidden />} title={t("services.title")} body={t("services.empty")} />
                ) : (
                    <ul>
                        {items.map((s) => (
                            <li key={s.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3">
                                <div>
                                    <p className="font-semibold">
                                        {pick(s.nameEn, s.nameAr)} {!s.isActive && <span className="ms-1 text-sm font-normal text-graphite">({t("common.inactive")})</span>}
                                    </p>
                                    <p className="tabular text-sm text-graphite">
                                        {t("common.minutes", { n: s.durationMinutes })} · {formatMoney(s.price, s.currency, locale)}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => setEditing(s)}>
                                        {t("common.edit")}
                                    </Button>
                                    <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === s.id} onClick={() => toggle.mutate(s)}>
                                        {s.isActive ? t("common.deactivate") : t("common.activate")}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <Dialog open={editing !== null} onClose={() => { setEditing(null); save.reset(); }} title={editing === "new" ? t("services.add") : t("common.edit")} size="lg">
                {editing !== null && <ServiceForm initial={editing === "new" ? undefined : editing} onSubmit={(v) => save.mutate(v)} pending={save.isPending} error={save.error} />}
            </Dialog>
        </div>
    );
}
