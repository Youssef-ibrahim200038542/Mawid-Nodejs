import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { doctorsApi, scheduleApi, servicesApi, specialtiesApi, type DoctorProfileInput } from "@/api/endpoints";
import type { Doctor, WeeklyInterval } from "@/api/types";
import { Button, Checkbox, ErrorPanel, ErrorSummary, Field, PageHeader, Section, SkeletonRows, TextArea, TextInput } from "@/components/ui/primitives";
import { WeeklyHoursEditor } from "@/components/staff/WeeklyHoursEditor";
import { ExceptionsManager } from "@/components/staff/ExceptionsManager";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { NotAllowed } from "./StaffIndex";

function ProfileForm({ doctor }: { doctor: Doctor }) {
    const { t, errorMessage } = useI18n();
    const { slug } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const [v, setV] = useState({
        displayNameEn: doctor.displayNameEn,
        displayNameAr: doctor.displayNameAr ?? "",
        titleEn: doctor.titleEn ?? "",
        titleAr: doctor.titleAr ?? "",
        bioEn: doctor.bioEn ?? "",
        bioAr: doctor.bioAr ?? "",
        yearsOfExperience: doctor.yearsOfExperience?.toString() ?? "",
        licenseNumber: doctor.licenseNumber ?? "",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const save = useMutation({
        mutationFn: (body: Partial<DoctorProfileInput & { isActive: boolean }>) => doctorsApi.update(slug, doctor.id, body),
        onSuccess: ({ doctor: updated }) => {
            queryClient.setQueryData(["staff", slug, "doctors", "one", doctor.id], { doctor: updated });
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "doctors"] });
            notify(t("doctors.saved"));
        },
    });
    const text = (value: string) => value.trim() || null;
    const field = (key: keyof typeof v, label: string, opts: { area?: boolean; ar?: boolean; optional?: boolean } = {}) => (
        <Field label={label} optional={opts.optional} error={errors[key]}>
            {(p) =>
                opts.area ? (
                    <TextArea {...p} dir={opts.ar ? "rtl" : undefined} lang={opts.ar ? "ar" : undefined} maxLength={4000} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
                ) : (
                    <TextInput {...p} dir={opts.ar ? "rtl" : undefined} lang={opts.ar ? "ar" : undefined} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
                )
            }
        </Field>
    );
    return (
        <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
                event.preventDefault();
                const next: Record<string, string> = {};
                if (v.displayNameEn.trim().length < 2) next.displayNameEn = t("validation.nameMin");
                const years = v.yearsOfExperience.trim();
                if (years && (!/^\d{1,2}$/.test(years) || Number(years) > 80)) next.yearsOfExperience = t("validation.required");
                setErrors(next);
                if (Object.keys(next).length) return;
                save.mutate({
                    displayNameEn: v.displayNameEn.trim(),
                    displayNameAr: text(v.displayNameAr),
                    titleEn: text(v.titleEn),
                    titleAr: text(v.titleAr),
                    bioEn: text(v.bioEn),
                    bioAr: text(v.bioAr),
                    yearsOfExperience: years ? Number(years) : null,
                    licenseNumber: text(v.licenseNumber),
                });
            }}
        >
            {save.isError && (
                <div className="sm:col-span-2">
                    <ErrorSummary message={errorMessage(save.error)} />
                </div>
            )}
            {field("displayNameEn", t("doctors.displayNameEn"))}
            {field("displayNameAr", t("doctors.displayNameAr"), { ar: true, optional: true })}
            {field("titleEn", t("doctors.titleEn"), { optional: true })}
            {field("titleAr", t("doctors.titleAr"), { ar: true, optional: true })}
            {field("bioEn", t("doctors.bioEn"), { area: true, optional: true })}
            {field("bioAr", t("doctors.bioAr"), { area: true, ar: true, optional: true })}
            {field("yearsOfExperience", t("doctors.years"), { optional: true })}
            {field("licenseNumber", t("doctors.license"), { optional: true })}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" variant="primary" loading={save.isPending && save.variables?.isActive === undefined}>
                    {t("common.save")}
                </Button>
                <Button onClick={() => save.mutate({ isActive: !doctor.isActive })} loading={save.isPending && save.variables?.isActive !== undefined}>
                    {doctor.isActive ? t("doctors.deactivate") : t("doctors.activate")}
                </Button>
            </div>
        </form>
    );
}

function LinkPicker({ doctor, kind }: { doctor: Doctor; kind: "services" | "specialties" }) {
    const { t, pick, errorMessage } = useI18n();
    const { slug } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const options = useQuery({
        // Own key: the Services/Specialties pages cache the raw `{ services }` response under "all".
        queryKey: ["staff", slug, kind, "link-options"],
        queryFn: async () =>
            kind === "services" ? (await servicesApi.list(slug, true)).services : (await specialtiesApi.list(slug, true)).specialties,
    });
    const current = (kind === "services" ? doctor.services : doctor.specialties).map((x) => x.id);
    const [chosen, setChosen] = useState<number[]>(current);
    useEffect(() => setChosen(current), [doctor.updatedAt, current.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = useMutation({
        mutationFn: () => (kind === "services" ? doctorsApi.setServices(slug, doctor.id, chosen) : doctorsApi.setSpecialties(slug, doctor.id, chosen)),
        onSuccess: ({ doctor: updated }) => {
            queryClient.setQueryData(["staff", slug, "doctors", "one", doctor.id], { doctor: updated });
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "doctors"] });
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
            notify(t("doctors.linksSaved"));
        },
    });

    if (options.isPending) return <SkeletonRows rows={2} />;
    if (options.isError) return <ErrorPanel error={options.error} onRetry={() => options.refetch()} />;
    if (options.data.length === 0) return <p className="text-sm text-graphite">{kind === "services" ? t("doctors.noServicesYet") : t("doctors.noSpecialtiesYet")}</p>;
    return (
        <fieldset>
            <legend className="sr-only">{kind === "services" ? t("doctors.services") : t("doctors.specialties")}</legend>
            {save.isError && <ErrorSummary message={errorMessage(save.error)} />}
            <div className="grid gap-x-6 sm:grid-cols-2">
                {options.data.map((o) => (
                    <Checkbox
                        key={o.id}
                        label={
                            <span>
                                {pick(o.nameEn, o.nameAr)}
                                {!o.isActive && <span className="ms-1.5 text-xs text-graphite">({t("common.inactive")})</span>}
                            </span>
                        }
                        checked={chosen.includes(o.id)}
                        onChange={(e) => setChosen((list) => (e.target.checked ? [...list, o.id] : list.filter((id) => id !== o.id)))}
                    />
                ))}
            </div>
            <Button className="mt-3" variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                {t("common.save")}
            </Button>
        </fieldset>
    );
}

export default function DoctorDetailPage() {
    const { doctorId } = useParams();
    const id = Number(doctorId);
    const { t, pick } = useI18n();
    const { slug, can } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const doctor = useQuery({ queryKey: ["staff", slug, "doctors", "one", id], queryFn: () => doctorsApi.get(slug, id), enabled: Number.isInteger(id) });
    const hoursKey = ["staff", slug, "hours", "doctor", id];
    const hours = useQuery({ queryKey: hoursKey, queryFn: () => scheduleApi.doctorHours(slug, id), enabled: Number.isInteger(id) });
    const saveHours = useMutation({
        mutationFn: (intervals: WeeklyInterval[]) => scheduleApi.setDoctorHours(slug, id, intervals),
        onSuccess: (data) => {
            queryClient.setQueryData(hoursKey, data);
            queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
            notify(t("hours.saved"));
        },
    });

    if (!can("doctors:manage")) return <NotAllowed />;
    if (doctor.isPending) return <SkeletonRows rows={4} />;
    if (doctor.isError) return <ErrorPanel error={doctor.error} onRetry={() => doctor.refetch()} />;
    const d = doctor.data.doctor;

    return (
        <div className="max-w-4xl">
            <p className="mb-2 text-sm">
                <Link to={`/c/${slug}/doctors`} className="text-malachite-deep hover:underline">
                    {t("doctors.title")}
                </Link>
            </p>
            <PageHeader title={pick(d.displayNameEn, d.displayNameAr)} description={d.isActive ? t("common.active") : t("common.inactive")} />
            <div className="flex flex-col gap-6">
                <Section title={t("doctors.profile")}>
                    <ProfileForm key={d.updatedAt} doctor={d} />
                </Section>
                <Section title={t("doctors.services")}>
                    <LinkPicker doctor={d} kind="services" />
                </Section>
                <Section title={t("doctors.specialties")}>
                    <LinkPicker doctor={d} kind="specialties" />
                </Section>
                <Section title={t("doctors.hours")}>
                    <p className="mb-3 text-sm text-graphite">{t("hours.doctorHoursHelp")}</p>
                    {hours.isPending ? <SkeletonRows rows={3} /> : hours.isError ? <ErrorPanel error={hours.error} /> : <WeeklyHoursEditor intervals={hours.data.intervals} onSave={(i) => saveHours.mutate(i)} saving={saveHours.isPending} error={saveHours.error} />}
                </Section>
                <Section title={t("doctors.exceptions")}>
                    <ExceptionsManager doctorId={d.id} scopes={[{ value: d.id, label: pick(d.displayNameEn, d.displayNameAr) }, { value: null, label: t("hours.wholeClinic") }]} canDelete={() => true} />
                </Section>
            </div>
        </div>
    );
}
