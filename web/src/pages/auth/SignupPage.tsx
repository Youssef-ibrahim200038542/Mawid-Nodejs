import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { safeNext } from "@/auth/guards";
import { Button, ButtonLink, ErrorSummary, Field, TextInput } from "@/components/ui/primitives";
import { AuthCard, PasswordInput } from "./LoginPage";

export default function SignupPage() {
    const { t, errorMessage } = useI18n();
    const { me, signup } = useAuth();
    const [params] = useSearchParams();
    const [sent, setSent] = useState(false);
    const next = safeNext(params.get("next"), "/");
    const [serverError, setServerError] = useState<unknown>(null);

    const schema = z.object({
        name: z.string().trim().min(2, t("validation.nameMin")).max(100),
        email: z.string().trim().min(1, t("validation.required")).email(t("validation.email")),
        // Mirrors the API: 8+ characters, at most 72 bytes (bcrypt).
        password: z
            .string()
            .min(8, t("validation.passwordMin"))
            .refine((value) => new TextEncoder().encode(value).length <= 72, t("validation.passwordMin")),
    });
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "" } });
    const { errors, isSubmitting } = form.formState;

    if (me) return <Navigate to={next} replace />;

    const onSubmit = form.handleSubmit(async (values) => {
        setServerError(null);
        try {
            // Never logs in: the same answer comes back whether or not the address has an account.
            await signup(values.name, values.email, values.password);
            setSent(true);
        } catch (error) {
            setServerError(error);
        }
    });

    const loginLink = `/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`;
    if (sent) {
        return (
            <AuthCard title={t("account.checkEmailTitle")} footer={t("account.checkEmailHint")}>
                <div role="status" className="flex flex-col gap-5">
                    <p className="flex items-start gap-3 text-lg">
                        <EnvelopeSimple aria-hidden size={26} className="mt-0.5 shrink-0 text-malachite-deep" /> {t("account.checkEmailBody")}
                    </p>
                    <ButtonLink to={loginLink} variant="primary">
                        {t("account.continueToLogin")}
                    </ButtonLink>
                </div>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            title={t("auth.signupTitle")}
            footer={
                <>
                    {t("auth.haveAccount")}{" "}
                    <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-malachite-deep hover:underline">
                        {t("nav.login")}
                    </Link>
                </>
            }
        >
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                {serverError !== null && <ErrorSummary message={errorMessage(serverError)} />}
                <Field label={t("auth.name")} error={errors.name?.message}>
                    {(p) => <TextInput {...p} autoComplete="name" {...form.register("name")} />}
                </Field>
                <Field label={t("auth.email")} error={errors.email?.message}>
                    {(p) => <TextInput {...p} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />}
                </Field>
                <Field label={t("auth.password")} help={t("auth.passwordHelp")} error={errors.password?.message}>
                    {(p) => {
                        const { ref, ...reg } = form.register("password");
                        return <PasswordInput {...p} autoComplete="new-password" inputRef={ref} {...reg} />;
                    }}
                </Field>
                <Button type="submit" variant="primary" loading={isSubmitting}>
                    {isSubmitting ? t("auth.creating") : t("auth.signupButton")}
                </Button>
            </form>
        </AuthCard>
    );
}
