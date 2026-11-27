import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { safeNext } from "@/auth/guards";
import { Button, ErrorSummary, Field, TextInput } from "@/components/ui/primitives";

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { inputRef?: React.Ref<HTMLInputElement> }) {
    const { t } = useI18n();
    const [visible, setVisible] = useState(false);
    const { inputRef, ...rest } = props;
    return (
        <div className="relative">
            <TextInput ref={inputRef} {...rest} type={visible ? "text" : "password"} className="pe-12" />
            <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                className="absolute inset-y-0 end-0 inline-flex w-11 items-center justify-center text-graphite hover:text-ink"
                aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
                aria-pressed={visible}
            >
                {visible ? <EyeSlash aria-hidden size={20} /> : <Eye aria-hidden size={20} />}
            </button>
        </div>
    );
}

export function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
    return (
        <div className="mx-auto max-w-md px-4 py-12 md:py-20">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <div className="mt-8">{children}</div>
            <p className="mt-8 text-sm text-graphite">{footer}</p>
        </div>
    );
}

export default function LoginPage() {
    const { t, errorMessage } = useI18n();
    const { me, login } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const next = safeNext(params.get("next"), "/");
    const [serverError, setServerError] = useState<unknown>(null);

    const schema = z.object({
        email: z.string().trim().min(1, t("validation.required")).email(t("validation.email")),
        password: z.string().min(1, t("validation.required")),
    });
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
    const { errors, isSubmitting } = form.formState;

    if (me) return <Navigate to={next} replace />;

    const onSubmit = form.handleSubmit(async (values) => {
        setServerError(null);
        try {
            const result = await login(values.email, values.password);
            navigate(next === "/" && result.clinics.length > 0 ? "/workspace" : next, { replace: true });
        } catch (error) {
            setServerError(error);
        }
    });

    return (
        <AuthCard
            title={t("auth.loginTitle")}
            footer={
                <>
                    {t("auth.noAccount")}{" "}
                    <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-malachite-deep hover:underline">
                        {t("nav.signup")}
                    </Link>
                </>
            }
        >
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                {serverError !== null && <ErrorSummary message={errorMessage(serverError)} />}
                <Field label={t("auth.email")} error={errors.email?.message}>
                    {(p) => <TextInput {...p} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />}
                </Field>
                <Field label={t("auth.password")} error={errors.password?.message}>
                    {(p) => {
                        const { ref, ...reg } = form.register("password");
                        return <PasswordInput {...p} autoComplete="current-password" inputRef={ref} {...reg} />;
                    }}
                </Field>
                <Button type="submit" variant="primary" loading={isSubmitting}>
                    {isSubmitting ? t("auth.loggingIn") : t("auth.loginButton")}
                </Button>
                <Link to="/forgot-password" className="text-sm font-medium text-malachite-deep hover:underline">
                    {t("account.forgotLink")}
                </Link>
            </form>
        </AuthCard>
    );
}
