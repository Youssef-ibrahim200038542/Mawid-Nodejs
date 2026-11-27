import { useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { authApi } from "@/api/endpoints";
import { setCsrfToken } from "@/api/client";
import { meQueryKey } from "@/auth/AuthProvider";
import { Button, ButtonLink, ErrorSummary, Field } from "@/components/ui/primitives";
import { useFragmentToken } from "@/lib/fragment-token";
import { AuthCard, PasswordInput } from "./LoginPage";

export default function ResetPasswordPage() {
    const { t, errorMessage } = useI18n();
    const queryClient = useQueryClient();
    const token = useFragmentToken();
    const [done, setDone] = useState(false);
    const [serverError, setServerError] = useState<unknown>(null);
    const schema = z.object({
        password: z
            .string()
            .min(8, t("validation.passwordMin"))
            .refine((value) => new TextEncoder().encode(value).length <= 72, t("validation.passwordMin")),
    });
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: "" } });
    const { errors, isSubmitting } = form.formState;

    const onSubmit = form.handleSubmit(async ({ password }) => {
        if (!token) return;
        setServerError(null);
        try {
            await authApi.resetPassword(token, password);
            // Every session (this one too) was invalidated on the server.
            setCsrfToken(null);
            queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
            queryClient.setQueryData(meQueryKey, null);
            setDone(true);
        } catch (error) {
            setServerError(error);
        }
    });

    return (
        <AuthCard
            title={t("account.resetTitle")}
            footer={
                <Link to="/login" className="font-medium text-malachite-deep hover:underline">
                    {t("account.backToLogin")}
                </Link>
            }
        >
            {done ? (
                <div role="status" className="flex flex-col gap-4">
                    <p className="rounded-control bg-malachite-tint px-4 py-3">{t("account.resetDone")}</p>
                    <ButtonLink to="/login" variant="primary">
                        {t("account.continueToLogin")}
                    </ButtonLink>
                </div>
            ) : !token ? (
                <div role="alert" className="flex flex-col gap-4">
                    <p className="font-medium text-carmine-deep">{t("account.tokenMissing")}</p>
                    <ButtonLink to="/forgot-password">{t("account.forgotButton")}</ButtonLink>
                </div>
            ) : (
                <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                    {serverError !== null && <ErrorSummary message={errorMessage(serverError)} />}
                    <Field label={t("account.newPassword")} help={t("auth.passwordHelp")} error={errors.password?.message}>
                        {(p) => {
                            const { ref, ...reg } = form.register("password");
                            return <PasswordInput {...p} autoComplete="new-password" inputRef={ref} {...reg} />;
                        }}
                    </Field>
                    <Button type="submit" variant="primary" loading={isSubmitting}>
                        {t("account.resetButton")}
                    </Button>
                </form>
            )}
        </AuthCard>
    );
}
