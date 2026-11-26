import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { clinicsApi } from "@/api/endpoints";
import type { Member, Role } from "@/api/types";
import { Button, Dialog, ErrorPanel, ErrorSummary, Field, PageHeader, Pagination, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

const roles: Role[] = ["OWNER", "DOCTOR", "RECEPTIONIST"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function TeamPage() {
    const { t, errorMessage } = useI18n();
    const { slug, can, clinic } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [adding, setAdding] = useState(false);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<Role>("RECEPTIONIST");
    const [emailError, setEmailError] = useState<string>();

    const list = useQuery({ queryKey: ["staff", slug, "members", page], queryFn: () => clinicsApi.members(slug, { page, pageSize: 25 }), placeholderData: keepPreviousData });
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["staff", slug, "members"] });
    const add = useMutation({
        mutationFn: () => clinicsApi.addMember(slug, { email: email.trim(), role }),
        onSuccess: () => {
            notify(t("team.added"));
            setAdding(false);
            setEmail("");
            invalidate();
        },
    });
    const update = useMutation({
        mutationFn: ({ member, changes }: { member: Member; changes: { role?: Role; status?: "ACTIVE" | "DISABLED" } }) => clinicsApi.updateMember(slug, member.id, changes),
        onSuccess: () => {
            notify(t("team.updated"));
            invalidate();
        },
        onError: (error) => notify(errorMessage(error), "error"),
    });

    if (!can("members:manage")) return <NotAllowed />;
    return (
        <div className="max-w-4xl">
            <PageHeader title={t("team.title")} actions={<Button variant="ink" icon={<Plus aria-hidden size={18} />} onClick={() => setAdding(true)}>{t("team.add")}</Button>} />
            {list.isPending ? (
                <SkeletonRows rows={3} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : (
                <>
                    <ul>
                        {list.data.items.map((m) => {
                            const self = m.id === clinic.memberId;
                            return (
                                <li key={m.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="font-medium">
                                            {m.user.name} {self && <span className="ms-1 text-sm text-graphite">({t("team.you")})</span>}
                                        </p>
                                        <p className="truncate text-sm text-graphite">{m.user.email}</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Select
                                            aria-label={`${t("team.changeRole")} — ${m.user.name}`}
                                            value={m.role}
                                            disabled={self || update.isPending}
                                            onChange={(e) => update.mutate({ member: m, changes: { role: e.target.value as Role } })}
                                            className="min-h-9 w-44 text-sm"
                                        >
                                            {roles.map((r) => (
                                                <option key={r} value={r}>
                                                    {t(`roles.${r}`)}
                                                </option>
                                            ))}
                                        </Select>
                                        <span className={m.status === "ACTIVE" ? "text-sm text-malachite-deep" : "text-sm text-carmine-deep"}>{t(`team.${m.status}`)}</span>
                                        {!self && (
                                            <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ member: m, changes: { status: m.status === "ACTIVE" ? "DISABLED" : "ACTIVE" } })}>
                                                {m.status === "ACTIVE" ? t("team.disable") : t("team.enable")}
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
                </>
            )}
            <Dialog
                open={adding}
                onClose={() => {
                    setAdding(false);
                    add.reset();
                }}
                title={t("team.add")}
                footer={
                    <>
                        <Button onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
                        <Button
                            variant="primary"
                            loading={add.isPending}
                            onClick={() => {
                                if (!emailPattern.test(email.trim())) return setEmailError(t("validation.email"));
                                setEmailError(undefined);
                                add.mutate();
                            }}
                        >
                            {t("common.add")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    {add.isError && <ErrorSummary message={errorMessage(add.error)} />}
                    <Field label={t("team.email")} error={emailError}>{(p) => <TextInput {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
                    <Field label={t("team.role")}>
                        {(p) => (
                            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                                {roles.map((r) => (
                                    <option key={r} value={r}>
                                        {t(`roles.${r}`)}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                </div>
            </Dialog>
        </div>
    );
}
