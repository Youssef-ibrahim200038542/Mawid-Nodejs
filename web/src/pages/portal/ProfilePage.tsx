import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { meQueryKey, useAuth } from "@/auth/AuthProvider";
import { authApi } from "@/api/endpoints";
import type { Locale, MePayload } from "@/api/types";
import { Button, ErrorSummary, Field, PageHeader, Section, Select, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

export default function ProfilePage() {
    const { t, errorMessage, setLocale } = useI18n();
    const { me } = useAuth();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [name, setName] = useState(me?.user.name ?? "");
    const [locale, setLocaleValue] = useState<Locale>(me?.user.locale ?? "en");
    const [nameError, setNameError] = useState<string>();

    const save = useMutation({
        mutationFn: () => authApi.updateMe({ name: name.trim(), locale }),
        onSuccess: ({ user }) => {
            queryClient.setQueryData<MePayload | null>(meQueryKey, (old) => (old ? { ...old, user } : old));
            setLocale(user.locale);
            notify(t("portal.profileSaved"));
        },
    });

    if (!me) return null;
    return (
        <div className="mx-auto max-w-2xl px-4 py-10 md:px-6">
            <PageHeader title={t("portal.profileTitle")} description={me.user.email} />
            <Section>
                <form
                    noValidate
                    className="flex flex-col gap-5"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (name.trim().length < 2) {
                            setNameError(t("validation.nameMin"));
                            return;
                        }
                        setNameError(undefined);
                        save.mutate();
                    }}
                >
                    {save.isError && <ErrorSummary message={errorMessage(save.error)} />}
                    <Field label={t("auth.name")} error={nameError}>
                        {(p) => <TextInput {...p} autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
                    </Field>
                    <Field label={t("portal.languagePref")}>
                        {(p) => (
                            <Select {...p} value={locale} onChange={(e) => setLocaleValue(e.target.value as Locale)}>
                                <option value="en">English</option>
                                <option value="ar">العربية</option>
                            </Select>
                        )}
                    </Field>
                    <div>
                        <Button type="submit" variant="primary" loading={save.isPending}>
                            {t("common.save")}
                        </Button>
                    </div>
                </form>
            </Section>
        </div>
    );
}
