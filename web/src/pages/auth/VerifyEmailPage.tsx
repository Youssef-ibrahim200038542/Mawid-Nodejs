import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth, meQueryKey } from "@/auth/AuthProvider";
import { authApi } from "@/api/endpoints";
import { ButtonLink, Spinner } from "@/components/ui/primitives";
import { useFragmentToken } from "@/lib/fragment-token";
import { AuthCard } from "./LoginPage";
import { ResendVerification } from "@/components/shell/VerifyEmailBanner";

type State = { kind: "working" } | { kind: "done" } | { kind: "error"; error: unknown } | { kind: "missing" };

export default function VerifyEmailPage() {
    const { t, errorMessage } = useI18n();
    const { me } = useAuth();
    const queryClient = useQueryClient();
    const token = useFragmentToken();
    const [state, setState] = useState<State>(token ? { kind: "working" } : { kind: "missing" });
    const started = useRef(false);

    useEffect(() => {
        if (!token || started.current) return;
        started.current = true;
        authApi
            .verifyEmail(token)
            .then(() => {
                setState({ kind: "done" });
                queryClient.invalidateQueries({ queryKey: meQueryKey });
            })
            .catch((error) => setState({ kind: "error", error }));
    }, [token, queryClient]);

    return (
        <AuthCard title={t("account.verifyTitle")} footer={null}>
            {state.kind === "working" && <Spinner label={t("account.verifying")} />}
            {state.kind === "done" && (
                <div role="status" className="flex flex-col gap-4">
                    <p className="flex items-start gap-2 text-lg font-medium text-malachite-deep">
                        <CheckCircle aria-hidden size={24} weight="fill" className="mt-0.5 shrink-0" /> {t("account.verified")}
                    </p>
                    <p className="text-graphite">{t("account.verifiedBody")}</p>
                    <ButtonLink to={me ? "/workspace" : "/login"} variant="primary">
                        {me ? t("invite.openWorkspace") : t("account.continueToLogin")}
                    </ButtonLink>
                </div>
            )}
            {(state.kind === "error" || state.kind === "missing") && (
                <div role="alert" className="flex flex-col gap-4">
                    <p className="flex items-start gap-2 font-medium text-carmine-deep">
                        <WarningCircle aria-hidden size={22} weight="fill" className="mt-0.5 shrink-0" />
                        {state.kind === "missing" ? t("account.tokenMissing") : errorMessage(state.error)}
                    </p>
                    {me && !me.user.emailVerified ? <ResendVerification /> : <ButtonLink to="/login">{t("account.backToLogin")}</ButtonLink>}
                </div>
            )}
        </AuthCard>
    );
}
