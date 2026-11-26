import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Stethoscope } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { clinicsApi, doctorsApi } from "@/api/endpoints";
import { Button, Checkbox, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, PageHeader, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

export default function DoctorsPage() {
    const { t, pick, errorMessage } = useI18n();
    const { slug, can } = useStaff();
    const { notify } = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [showInactive, setShowInactive] = useState(true);
    const [adding, setAdding] = useState(false);
    const [memberId, setMemberId] = useState("");
    const [nameEn, setNameEn] = useState("");
    const [nameAr, setNameAr] = useState("");
    const [nameError, setNameError] = useState<string>();

    const doctors = useQuery({ queryKey: ["staff", slug, "doctors", "all"], queryFn: () => doctorsApi.list(slug, { includeInactive: true, pageSize: 100 }) });
    const members = useQuery({ queryKey: ["staff", slug, "members", "all"], queryFn: () => clinicsApi.members(slug, { pageSize: 100 }), enabled: adding });

    const withProfile = new Set((doctors.data?.items ?? []).map((d) => d.memberId));
    const eligible = (members.data?.items ?? []).filter((m) => m.status === "ACTIVE" && (m.role === "OWNER" || m.role === "DOCTOR") && !withProfile.has(m.id));

    const create = useMutation({
        mutationFn: () => doctorsApi.create(slug, { memberId: Number(memberId), displayNameEn: nameEn.trim(), displayNameAr: nameAr.trim() || null }),
        onSuccess: ({ doctor }) => {
            notify(t("doctors.created"));
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "doctors"] });
            setAdding(false);
            navigate(`/c/${slug}/doctors/${doctor.id}`);
        },
    });

    if (!can("doctors:manage")) return <NotAllowed />;
    const list = (doctors.data?.items ?? []).filter((d) => showInactive || d.isActive);

    return (
        <div className="max-w-4xl">
            <PageHeader
                title={t("doctors.title")}
                actions={
                    <Button variant="ink" icon={<Plus aria-hidden size={18} />} onClick={() => setAdding(true)}>
                        {t("doctors.add")}
                    </Button>
                }
            />
            <Checkbox label={t("common.showInactive")} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <div className="mt-3">
                {doctors.isPending ? (
                    <SkeletonRows rows={3} />
                ) : doctors.isError ? (
                    <ErrorPanel error={doctors.error} onRetry={() => doctors.refetch()} />
                ) : list.length === 0 ? (
                    <EmptyState icon={<Stethoscope size={28} aria-hidden />} title={t("doctors.title")} body={t("doctors.empty")} />
                ) : (
                    <ul>
                        {list.map((d) => (
                            <li key={d.id} className="ledger-rule">
                                <Link to={`/c/${slug}/doctors/${d.id}`} className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3 hover:bg-paper">
                                    <span>
                                        <span className="block font-semibold">{pick(d.displayNameEn, d.displayNameAr)}</span>
                                        <span className="text-sm text-graphite">{d.services.map((s) => pick(s.nameEn, s.nameAr)).join(" · ") || "—"}</span>
                                    </span>
                                    <span className={d.isActive ? "text-sm text-malachite-deep" : "text-sm text-graphite"}>{d.isActive ? t("common.active") : t("common.inactive")}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                open={adding}
                onClose={() => {
                    setAdding(false);
                    create.reset();
                }}
                title={t("doctors.add")}
                footer={
                    <>
                        <Button onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
                        <Button
                            variant="primary"
                            loading={create.isPending}
                            disabled={!memberId}
                            onClick={() => {
                                if (nameEn.trim().length < 2) {
                                    setNameError(t("validation.nameMin"));
                                    return;
                                }
                                setNameError(undefined);
                                create.mutate();
                            }}
                        >
                            {t("common.add")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    {create.isError && <ErrorSummary message={errorMessage(create.error)} />}
                    {members.isPending ? (
                        <SkeletonRows rows={1} />
                    ) : eligible.length === 0 ? (
                        <p className="text-sm text-graphite">{t("doctors.noEligible")}</p>
                    ) : (
                        <>
                            <Field label={t("doctors.member")} help={t("doctors.memberHelp")}>
                                {(p) => (
                                    <Select
                                        {...p}
                                        value={memberId}
                                        onChange={(e) => {
                                            setMemberId(e.target.value);
                                            const member = eligible.find((m) => String(m.id) === e.target.value);
                                            if (member && !nameEn) setNameEn(member.user.name);
                                        }}
                                    >
                                        <option value="">—</option>
                                        {eligible.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.user.name} · {t(`roles.${m.role}`)}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field label={t("doctors.displayNameEn")} error={nameError}>
                                {(p) => <TextInput {...p} value={nameEn} maxLength={150} onChange={(e) => setNameEn(e.target.value)} />}
                            </Field>
                            <Field label={t("doctors.displayNameAr")} optional>
                                {(p) => <TextInput {...p} dir="rtl" lang="ar" value={nameAr} maxLength={150} onChange={(e) => setNameAr(e.target.value)} />}
                            </Field>
                        </>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
