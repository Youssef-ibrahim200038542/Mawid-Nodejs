import { useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/i18n";
import { authApi } from "@/api/endpoints";
import { Button, ErrorSummary, Field, TextInput } from "@/components/ui/primitives";
import { AuthCard } from "./LoginPage";

export default function ForgotPasswordPage() {
    const { t, errorMessage } = useI18n();
    const [sent, setSent] = useState(false);
    const [serverError, setServerError] = useState<unknown>(null);
    const schema = z.object({ email: z.string().trim().min(1, t("validation.required")).email(t("validation.email")) });
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
    const { errors, isSubmitting } = form.formState;

    const onSubmit = form.handleSubmit(async ({ email }) => {
        setServerError(null);
        try {
            // Same answer whether or not the address has an account.
            await authApi.forgotPassword(email);
            setSent(true);
        } catch (error) {
            setServerError(error);
        }
    });

    return (
        <AuthCard
            title={t("account.forgotTitle")}
            footer={
                <Link to="/login" className="font-medium text-malachite-deep hover:underline">
                    {t("account.backToLogin")}
                </Link>
            }
        >
            {sent ? (
                <p role="status" className="rounded-control bg-malachite-tint px-4 py-3">
                    {t("account.forgotSent")}
                </p>
            ) : (
                <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                    <p className="text-graphite">{t("account.forgotBody")}</p>
                    {serverError !== null && <ErrorSummary message={errorMessage(serverError)} />}
                    <Field label={t("auth.email")} error={errors.email?.message}>
                        {(p) => <TextInput {...p} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />}
                    </Field>
                    <Button type="submit" variant="primary" loading={isSubmitting}>
                        {t("account.forgotButton")}
                    </Button>
                </form>
            )}
        </AuthCard>
    );
}
