import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { specialtiesApi } from "@/api/endpoints";
import type { Specialty } from "@/api/types";
import { Button, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

export default function SpecialtiesPage() {
    const { t, pick, errorMessage } = useI18n();
    const { slug, can } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<Specialty | "new" | null>(null);
    const [nameEn, setNameEn] = useState("");
    const [nameAr, setNameAr] = useState("");
    const [error, setError] = useState<string>();

    const list = useQuery({ queryKey: ["staff", slug, "specialties", "all"], queryFn: () => specialtiesApi.list(slug, true) });
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["staff", slug, "specialties"] });
    const save = useMutation({
        mutationFn: () => {
            const body = { nameEn: nameEn.trim(), nameAr: nameAr.trim() || null };
            return editing && editing !== "new" ? specialtiesApi.update(slug, editing.id, body) : specialtiesApi.create(slug, body);
        },
        onSuccess: () => {
            notify(editing === "new" ? t("specialties.created") : t("specialties.saved"));
            setEditing(null);
            invalidate();
        },
    });
    const toggle = useMutation({
        mutationFn: (s: Specialty) => specialtiesApi.update(slug, s.id, { isActive: !s.isActive }),
        onSuccess: invalidate,
    });

    const open = (s: Specialty | "new") => {
        setEditing(s);
        setNameEn(s === "new" ? "" : s.nameEn);
        setNameAr(s === "new" ? "" : s.nameAr ?? "");
        setError(undefined);
        save.reset();
    };

    if (!can("specialties:manage")) return <NotAllowed />;
    return (
        <div className="max-w-3xl">
            <PageHeader title={t("specialties.title")} actions={<Button variant="ink" icon={<Plus aria-hidden size={18} />} onClick={() => open("new")}>{t("specialties.add")}</Button>} />
            {list.isPending ? (
                <SkeletonRows rows={3} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.specialties.length === 0 ? (
                <EmptyState icon={<Tag size={28} aria-hidden />} title={t("specialties.empty")} />
            ) : (
                <ul>
                    {list.data.specialties.map((s) => (
                        <li key={s.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3">
                            <p className="font-medium">
                                {pick(s.nameEn, s.nameAr)}
                                {s.nameAr && pick(s.nameEn, s.nameAr) !== s.nameEn && <span className="ms-2 text-sm text-graphite">{s.nameEn}</span>}
                                {!s.isActive && <span className="ms-2 text-sm text-graphite">({t("common.inactive")})</span>}
                            </p>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={() => open(s)}>{t("common.edit")}</Button>
                                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)} loading={toggle.isPending && toggle.variables?.id === s.id}>
                                    {s.isActive ? t("common.inactive") : t("common.active")}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <Dialog
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={editing === "new" ? t("specialties.add") : t("common.edit")}
                footer={
                    <>
                        <Button onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
                        <Button
                            variant="primary"
                            loading={save.isPending}
                            onClick={() => {
                                if (nameEn.trim().length < 2) return setError(t("validation.nameMin"));
                                setError(undefined);
                                save.mutate();
                            }}
                        >
                            {t("common.save")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    {save.isError && <ErrorSummary message={errorMessage(save.error)} />}
                    <Field label={t("specialties.nameEn")} error={error}>{(p) => <TextInput {...p} maxLength={100} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />}</Field>
                    <Field label={t("specialties.nameAr")} optional>{(p) => <TextInput {...p} dir="rtl" lang="ar" maxLength={100} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />}</Field>
                </div>
            </Dialog>
        </div>
    );
}
