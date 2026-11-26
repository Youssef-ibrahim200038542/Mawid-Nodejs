import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { authApi } from "@/api/endpoints";
import type { Delivery } from "@/api/types";
import { Button } from "@/components/ui/primitives";

// "Send the link again" with the honest delivery result from the server.
export function ResendVerification() {
    const { t, errorMessage } = useI18n();
    const [result, setResult] = useState<Delivery | null>(null);
    const resend = useMutation({
        mutationFn: () => authApi.resendVerification(),
        onSuccess: ({ delivery }) => setResult(delivery),
    });
    const resultText = result === "unknown" ? t("account.pending") : result ? t(`account.${result}`) : null;
    return (
        <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" icon={<EnvelopeSimple aria-hidden size={16} />} loading={resend.isPending} onClick={() => resend.mutate()}>
                {resend.isPending ? t("account.resending") : t("account.resend")}
            </Button>
            <span aria-live="polite" className="text-sm">
                {resend.isError ? <span className="text-carmine-deep">{errorMessage(resend.error)}</span> : resultText}
            </span>
        </div>
    );
}

// Shown to a logged-in account whose email address is not confirmed yet.
export function VerifyEmailBanner() {
    const { t } = useI18n();
    const { me } = useAuth();
    if (!me || me.user.emailVerified) return null;
    return (
        <div className="border-b border-saffron/50 bg-saffron-tint">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm md:px-6">
                <p className="font-medium">{t("account.bannerText")}</p>
                <ResendVerification />
            </div>
        </div>
    );
}
