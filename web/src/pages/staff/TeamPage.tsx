import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EnvelopeSimple, Plus, SealCheck, Warning } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { clinicsApi, invitationsApi } from "@/api/endpoints";
import type { Delivery, Invitation, Member, Role } from "@/api/types";
import { Button, Dialog, ErrorPanel, ErrorSummary, Field, PageHeader, Pagination, Section, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { formatDate } from "@/lib/format";
import { cx } from "@/lib/cx";
import { NotAllowed } from "./StaffIndex";

const roles: Role[] = ["OWNER", "DOCTOR", "RECEPTIONIST"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DeliveryNote({ delivery }: { delivery: Delivery }) {
    const { t } = useI18n();
    const bad = delivery === "failed" || delivery === "unknown";
    return <span className={cx("text-xs", bad ? "font-medium text-carmine-deep" : "text-graphite")}>{t(`team.delivery_${delivery}`)}</span>;
}

function TrustBadge({ member }: { member: Member }) {
    const { t } = useI18n();
    if (member.trustState === "TRUSTED") {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-malachite-deep">
                <SealCheck aria-hidden size={14} weight="bold" /> {t("team.trusted")}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-control bg-saffron-tint px-2 py-0.5 text-xs font-medium ring-1 ring-saffron/50">
            <Warning aria-hidden size={14} weight="bold" /> {t("team.legacy")}
        </span>
    );
}

export default function TeamPage() {
    const { t, errorMessage, locale } = useI18n();
    const { slug, can, clinic, zone } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [inviting, setInviting] = useState(false);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<Role>("RECEPTIONIST");
    const [emailError, setEmailError] = useState<string>();

    const list = useQuery({ queryKey: ["staff", slug, "members", page], queryFn: () => clinicsApi.members(slug, { page, pageSize: 25 }), placeholderData: keepPreviousData });
    const invitations = useQuery({ queryKey: ["staff", slug, "invitations"], queryFn: () => invitationsApi.list(slug) });
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "members"] });
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "invitations"] });
    };
    const announce = (delivery: Delivery, success: string) => notify(delivery === "failed" ? t("team.delivery_failed") : `${success} · ${t(`team.delivery_${delivery}`)}`, delivery === "failed" ? "error" : undefined);

    const invite = useMutation({
        mutationFn: () => invitationsApi.create(slug, { email: email.trim(), role }),
        onSuccess: ({ delivery }) => {
            announce(delivery, t("team.invited"));
            setInviting(false);
            setEmail("");
            invalidate();
        },
    });
    const resend = useMutation({
        mutationFn: (invitation: Invitation) => invitationsApi.resend(slug, invitation.id),
        onSuccess: ({ delivery }) => {
            announce(delivery, t("team.invited"));
            invalidate();
        },
        onError: (error) => notify(errorMessage(error), "error"),
    });
    const revoke = useMutation({
        mutationFn: (invitation: Invitation) => invitationsApi.revoke(slug, invitation.id),
        onSuccess: () => {
            notify(t("team.revoked"));
            invalidate();
        },
        onError: (error) => notify(errorMessage(error), "error"),
    });
    const reconfirm = useMutation({
        mutationFn: (member: Member) => clinicsApi.requestReconfirmation(slug, member.id),
        onSuccess: ({ delivery }) => {
            announce(delivery, t("team.reconfirmSent"));
            invalidate();
        },
        onError: (error) => notify(errorMessage(error), "error"),
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
    const hasLegacy = list.data?.items.some((m) => m.trustState === "LEGACY_UNREVIEWED");
    return (
        <div className="max-w-4xl">
            <PageHeader title={t("team.title")} actions={<Button variant="ink" icon={<Plus aria-hidden size={18} />} onClick={() => setInviting(true)}>{t("team.invite")}</Button>} />
            {list.isPending ? (
                <SkeletonRows rows={3} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : (
                <>
                    {hasLegacy && <p className="mb-4 rounded-control bg-saffron-tint px-3 py-2 text-sm ring-1 ring-saffron/50">{t("team.legacyNote")}</p>}
                    <ul>
                        {list.data.items.map((m) => {
                            const self = m.id === clinic.memberId;
                            const legacy = m.trustState === "LEGACY_UNREVIEWED";
                            return (
                                <li key={m.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="font-medium">
                                            {m.user.name} {self && <span className="ms-1 text-sm text-graphite">({t("team.you")})</span>}
                                        </p>
                                        <p className="truncate text-sm text-graphite" dir="ltr">{m.user.email}</p>
                                        <p className="mt-1 flex flex-wrap items-center gap-2">
                                            <TrustBadge member={m} />
                                            {legacy && m.pendingReconfirmation && (
                                                <span className="text-xs text-graphite">{t("team.reconfirmPending", { date: formatDate(m.pendingReconfirmation.expiresAt, zone, locale, "short") })}</span>
                                            )}
                                        </p>
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
                                        {legacy && m.status === "ACTIVE" && !self && (
                                            <Button size="sm" variant="secondary" icon={<EnvelopeSimple aria-hidden size={16} />} disabled={reconfirm.isPending} onClick={() => reconfirm.mutate(m)}>
                                                {t("team.requestReconfirm")}
                                            </Button>
                                        )}
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

            <Section title={t("team.pendingTitle")} className="mt-10">
                {invitations.isPending ? (
                    <SkeletonRows rows={2} />
                ) : invitations.isError ? (
                    <ErrorPanel error={invitations.error} onRetry={() => invitations.refetch()} />
                ) : invitations.data.items.length === 0 ? (
                    <p className="text-sm text-graphite">{t("team.noPending")}</p>
                ) : (
                    <ul>
                        {invitations.data.items.map((inv) => (
                            <li key={inv.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="truncate font-medium" dir="ltr">{inv.email}</p>
                                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
                                        <span>{inv.kind === "RECONFIRM" ? t("team.kindReconfirm") : t("team.kindNew")}</span>
                                        <span>{t(`roles.${inv.role}`)}</span>
                                        {inv.expired ? (
                                            <span className="font-medium text-carmine-deep">{t("team.expiredBadge")}</span>
                                        ) : (
                                            <span>{t("team.expiresOn", { date: formatDate(inv.expiresAt, zone, locale, "short") })}</span>
                                        )}
                                        <DeliveryNote delivery={inv.delivery} />
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" disabled={resend.isPending} onClick={() => resend.mutate(inv)}>
                                        {t("team.resend")}
                                    </Button>
                                    <Button size="sm" variant="dangerGhost" disabled={revoke.isPending} onClick={() => revoke.mutate(inv)}>
                                        {t("team.revoke")}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Dialog
                open={inviting}
                onClose={() => {
                    setInviting(false);
                    invite.reset();
                }}
                title={t("team.inviteTitle")}
                footer={
                    <>
                        <Button onClick={() => setInviting(false)}>{t("common.cancel")}</Button>
                        <Button
                            variant="primary"
                            loading={invite.isPending}
                            onClick={() => {
                                if (!emailPattern.test(email.trim())) return setEmailError(t("validation.email"));
                                setEmailError(undefined);
                                invite.mutate();
                            }}
                        >
                            {t("team.sendInvite")}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-graphite">{t("team.inviteHelp")}</p>
                    {invite.isError && <ErrorSummary message={errorMessage(invite.error)} />}
                    <Field label={t("auth.email")} error={emailError}>{(p) => <TextInput {...p} type="email" dir="ltr" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
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
