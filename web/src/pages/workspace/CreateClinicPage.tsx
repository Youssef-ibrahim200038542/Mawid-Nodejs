import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { clinicsApi } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import { Button, ErrorSummary, Field, PageHeader, Section, Select, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { ResendVerification } from "@/components/shell/VerifyEmailBanner";

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const timezones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Africa/Cairo"];

export function slugify(value: string) {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

export default function CreateClinicPage() {
    const { t, errorMessage } = useI18n();
    const { refresh, me } = useAuth();
    const { notify } = useToast();
    const navigate = useNavigate();

    const schema = z.object({
        name: z.string().trim().min(2, t("validation.nameMin")).max(150),
        slug: z.string().trim().min(3, t("validation.slug")).max(80).regex(slugPattern, t("validation.slug")),
        timezone: z.string().min(1),
        defaultLocale: z.enum(["en", "ar"]),
        city: z.string().trim().max(100),
        address: z.string().trim().max(255),
        phone: z.string().trim().max(30),
        email: z.union([z.literal(""), z.string().trim().email(t("validation.email"))]),
    });
    type Values = z.infer<typeof schema>;
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { name: "", slug: "", timezone: "Africa/Cairo", defaultLocale: "en", city: "", address: "", phone: "", email: "" },
    });
    const { errors } = form.formState;
    const slug = form.watch("slug");

    const create = useMutation({
        mutationFn: (values: Values) => clinicsApi.create(values),
        onSuccess: async ({ clinic }) => {
            await refresh();
            notify(clinic.name);
            navigate(`/c/${clinic.slug}`);
        },
        onError: (error) => {
            if (error instanceof ApiError && error.code === "CLINIC_SLUG_TAKEN") form.setError("slug", { message: t("errors.CLINIC_SLUG_TAKEN") });
        },
    });

    // The API refuses unverified creators (403 EMAIL_NOT_VERIFIED); explain it before the form.
    if (me && !me.user.emailVerified) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-10 md:px-6">
                <PageHeader title={t("workspace.createTitle")} />
                <Section>
                    <p className="mb-4 font-medium">{t("workspace.verifyToCreate")}</p>
                    <ResendVerification />
                </Section>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-10 md:px-6">
            <PageHeader title={t("workspace.createTitle")} />
            <Section>
                <form noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))} className="grid gap-5 sm:grid-cols-2">
                    {create.isError && (
                        <div className="sm:col-span-2">
                            <ErrorSummary message={errorMessage(create.error)} />
                        </div>
                    )}
                    <Field label={t("workspace.clinicName")} error={errors.name?.message} className="sm:col-span-2">
                        {(p) => (
                            <TextInput
                                {...p}
                                {...form.register("name", {
                                    onChange: (e) => {
                                        if (!form.formState.dirtyFields.slug) form.setValue("slug", slugify(e.target.value));
                                    },
                                })}
                            />
                        )}
                    </Field>
                    <Field label={t("workspace.slug")} help={t("workspace.slugHelp", { slug: slug || "…" })} error={errors.slug?.message} className="sm:col-span-2">
                        {(p) => <TextInput {...p} dir="ltr" autoCapitalize="none" spellCheck={false} {...form.register("slug")} />}
                    </Field>
                    <Field label={t("workspace.timezone")}>
                        {(p) => (
                            <Select {...p} {...form.register("timezone")}>
                                {timezones.map((zone) => (
                                    <option key={zone} value={zone}>
                                        {zone}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field label={t("workspace.defaultLocale")}>
                        {(p) => (
                            <Select {...p} {...form.register("defaultLocale")}>
                                <option value="en">English</option>
                                <option value="ar">العربية</option>
                            </Select>
                        )}
                    </Field>
                    <Field label={t("workspace.city")} optional>
                        {(p) => <TextInput {...p} {...form.register("city")} />}
                    </Field>
                    <Field label={t("workspace.phone")} optional>
                        {(p) => <TextInput {...p} type="tel" dir="ltr" {...form.register("phone")} />}
                    </Field>
                    <Field label={t("workspace.address")} optional className="sm:col-span-2">
                        {(p) => <TextInput {...p} {...form.register("address")} />}
                    </Field>
                    <Field label={t("workspace.email")} optional error={errors.email?.message} className="sm:col-span-2">
                        {(p) => <TextInput {...p} type="email" dir="ltr" {...form.register("email")} />}
                    </Field>
                    <div className="sm:col-span-2">
                        <Button type="submit" variant="primary" loading={create.isPending}>
                            {create.isPending ? t("workspace.creating") : t("workspace.create")}
                        </Button>
                    </div>
                </form>
            </Section>
        </div>
    );
}
