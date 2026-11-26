import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { clinicsApi } from "@/api/endpoints";
import type { Clinic, Locale } from "@/api/types";
import { Button, ErrorPanel, ErrorSummary, Field, PageHeader, Section, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { timezones } from "@/pages/workspace/CreateClinicPage";
import { NotAllowed } from "./StaffIndex";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Form({ clinic }: { clinic: Clinic }) {
    const { t, errorMessage } = useI18n();
    const { slug } = useStaff();
    const { refresh } = useAuth();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [v, setV] = useState({ name: clinic.name, timezone: clinic.timezone, defaultLocale: clinic.defaultLocale, city: clinic.city ?? "", address: clinic.address ?? "", phone: clinic.phone ?? "", email: clinic.email ?? "" });
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => setErrors({}), [clinic]);
    const save = useMutation({
        mutationFn: () => clinicsApi.update(slug, { ...v, name: v.name.trim(), city: v.city.trim() || null, address: v.address.trim() || null, phone: v.phone.trim() || null, email: v.email.trim() || null }),
        onSuccess: async ({ clinic: updated }) => {
            queryClient.setQueryData(["staff", slug, "clinic"], { clinic: updated });
            await refresh(); // timezone/name appear across the workspace
            notify(t("settings.saved"));
        },
    });
    return (
        <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
                event.preventDefault();
                const next: Record<string, string> = {};
                if (v.name.trim().length < 2) next.name = t("validation.nameMin");
                if (v.email.trim() && !emailPattern.test(v.email.trim())) next.email = t("validation.email");
                setErrors(next);
                if (!Object.keys(next).length) save.mutate();
            }}
        >
            {save.isError && <div className="sm:col-span-2"><ErrorSummary message={errorMessage(save.error)} /></div>}
            <Field label={t("workspace.clinicName")} error={errors.name} className="sm:col-span-2">{(p) => <TextInput {...p} value={v.name} maxLength={150} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
            <Field label={t("workspace.timezone")}>
                {(p) => (
                    <Select {...p} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
                        {timezones.map((z) => <option key={z}>{z}</option>)}
                    </Select>
                )}
            </Field>
            <Field label={t("workspace.defaultLocale")}>
                {(p) => (
                    <Select {...p} value={v.defaultLocale} onChange={(e) => setV({ ...v, defaultLocale: e.target.value as Locale })}>
                        <option value="en">English</option>
                        <option value="ar">العربية</option>
                    </Select>
                )}
            </Field>
            <Field label={t("workspace.city")} optional>{(p) => <TextInput {...p} value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />}</Field>
            <Field label={t("workspace.phone")} optional>{(p) => <TextInput {...p} type="tel" dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
            <Field label={t("workspace.address")} optional className="sm:col-span-2">{(p) => <TextInput {...p} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />}</Field>
            <Field label={t("workspace.email")} optional error={errors.email} className="sm:col-span-2">{(p) => <TextInput {...p} type="email" dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
            <p className="text-sm text-graphite sm:col-span-2">{t("workspace.slugHelp", { slug: clinic.slug })}</p>
            <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={save.isPending}>{t("common.save")}</Button></div>
        </form>
    );
}

export default function SettingsPage() {
    const { t } = useI18n();
    const { slug, can } = useStaff();
    const query = useQuery({ queryKey: ["staff", slug, "clinic"], queryFn: () => clinicsApi.get(slug) });
    if (!can("clinic:update")) return <NotAllowed />;
    return (
        <div className="max-w-3xl">
            <PageHeader title={t("settings.title")} />
            <Section>{query.isPending ? <SkeletonRows rows={4} /> : query.isError ? <ErrorPanel error={query.error} onRetry={() => query.refetch()} /> : <Form key={query.data.clinic.name + query.data.clinic.timezone} clinic={query.data.clinic} />}</Section>
        </div>
    );
}
