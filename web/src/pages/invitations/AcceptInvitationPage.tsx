import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle, EnvelopeSimple, WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { invitationsApi } from "@/api/endpoints";
import { Button, ButtonLink, Dialog, ErrorSummary, Spinner } from "@/components/ui/primitives";
import { ResendVerification } from "@/components/shell/VerifyEmailBanner";
import { forgetToken, useFragmentToken } from "@/lib/fragment-token";
import { AuthCard } from "@/pages/auth/LoginPage";

const rememberKey = "invitation";
const here = "/invitations/accept";

export default function AcceptInvitationPage() {
    const { t, errorMessage, locale } = useI18n();
    const { me, refresh, logout } = useAuth();
    const token = useFragmentToken(rememberKey);
    const [declining, setDeclining] = useState(false);
    const [outcome, setOutcome] = useState<{ kind: "accepted" | "declined"; clinic?: { slug: string; name: string }; reconfirm?: boolean } | null>(null);

    const preview = useQuery({
        queryKey: ["invitation", "preview", token, me?.user.id ?? null, me?.user.emailVerified ?? null],
        queryFn: () => invitationsApi.preview(token as string),
        enabled: Boolean(token) && outcome === null,
        retry: false,
    });
    const accept = useMutation({
        mutationFn: () => invitationsApi.accept(token as string),
        onSuccess: async (result) => {
            forgetToken(rememberKey);
            await refresh();
            setOutcome({ kind: "accepted", clinic: result.clinic, reconfirm: result.kind === "RECONFIRM" });
        },
    });
    const decline = useMutation({
        mutationFn: () => invitationsApi.decline(token as string),
        onSuccess: () => {
            forgetToken(rememberKey);
            setDeclining(false);
            setOutcome({ kind: "declined" });
        },
    });

    const title = preview.data?.kind === "RECONFIRM" ? t("invite.reconfirmTitle") : t("invite.title");

    if (outcome) {
        return (
            <AuthCard title={title} footer={null}>
                <div role="status" className="flex flex-col gap-4">
                    <p className="flex items-start gap-2 text-lg font-medium text-malachite-deep">
                        <CheckCircle aria-hidden size={24} weight="fill" className="mt-0.5 shrink-0" />
                        {outcome.kind === "declined"
                            ? t("invite.declined")
                            : t(outcome.reconfirm ? "invite.reconfirmed" : "invite.accepted", { clinic: outcome.clinic?.name ?? "" })}
                    </p>
                    {outcome.clinic && (
                        <ButtonLink to={`/c/${outcome.clinic.slug}`} variant="primary">
                            {t("invite.openWorkspace")}
                        </ButtonLink>
                    )}
                </div>
            </AuthCard>
        );
    }

    if (!token) {
        return (
            <AuthCard title={t("invite.title")} footer={null}>
                <p role="alert" className="font-medium text-carmine-deep">
                    {t("account.tokenMissing")}
                </p>
            </AuthCard>
        );
    }

    if (preview.isPending) {
        return (
            <AuthCard title={t("invite.title")} footer={null}>
                <Spinner label={t("invite.loading")} />
            </AuthCard>
        );
    }

    if (preview.isError) {
        return (
            <AuthCard title={t("invite.title")} footer={null}>
                <p role="alert" className="flex items-start gap-2 font-medium text-carmine-deep">
                    <WarningCircle aria-hidden size={22} weight="fill" className="mt-0.5 shrink-0" /> {errorMessage(preview.error)}
                </p>
            </AuthCard>
        );
    }

    const invitation = preview.data;
    const roleName = t(`roles.${invitation.role}`);
    const next = encodeURIComponent(here);
    const actionError = accept.error ?? decline.error;

    return (
        <AuthCard title={title} footer={null}>
            <div className="flex flex-col gap-5">
                <p className="text-lg">
                    {t(invitation.kind === "RECONFIRM" ? "invite.reconfirmBody" : "invite.body", { clinic: invitation.clinic.name, role: roleName })}
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-graphite">
                    <span className="inline-flex items-center gap-1.5" dir="ltr">
                        <EnvelopeSimple aria-hidden size={16} /> {t("invite.sentTo", { email: invitation.emailHint })}
                    </span>
                    <span>{t("invite.expires", { date: new Date(invitation.expiresAt).toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB") })}</span>
                </p>

                {actionError && <ErrorSummary message={errorMessage(actionError)} />}

                {!me ? (
                    <div className="flex flex-col gap-3">
                        <p className="text-graphite">{t("invite.loginToAccept")}</p>
                        <ButtonLink to={`/login?next=${next}`} variant="primary">
                            {t("nav.login")}
                        </ButtonLink>
                        <Link to={`/signup?next=${next}`} className="text-sm font-medium text-malachite-deep hover:underline">
                            {t("invite.signupToAccept")}
                        </Link>
                    </div>
                ) : invitation.viewer && !invitation.viewer.matchesInvitation ? (
                    <div className="flex flex-col gap-3">
                        <p role="alert" className="font-medium text-carmine-deep">
                            {t("invite.mismatch")}
                        </p>
                        <Button onClick={() => logout()}>{t("nav.logout")}</Button>
                    </div>
                ) : invitation.viewer && !invitation.viewer.emailVerified ? (
                    <div className="flex flex-col gap-3">
                        <p role="alert" className="font-medium">
                            {t("invite.verifyFirst")}
                        </p>
                        <ResendVerification />
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-3">
                        <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
                            {t("invite.accept")}
                        </Button>
                        <Button variant="dangerGhost" disabled={accept.isPending} onClick={() => setDeclining(true)}>
                            {t("invite.decline")}
                        </Button>
                    </div>
                )}
            </div>

            <Dialog
                open={declining}
                onClose={() => setDeclining(false)}
                title={t("invite.declineConfirm")}
                footer={
                    <>
                        <Button onClick={() => setDeclining(false)}>{t("common.cancel")}</Button>
                        <Button variant="danger" loading={decline.isPending} onClick={() => decline.mutate()}>
                            {t("invite.decline")}
                        </Button>
                    </>
                }
            >
                <p>{t("invite.declineBody")}</p>
            </Dialog>
        </AuthCard>
    );
}
