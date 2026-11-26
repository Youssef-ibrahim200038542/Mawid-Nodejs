import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, ArrowRight } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { publicApi } from "@/api/endpoints";
import { Button, ButtonLink, ErrorPanel, Field, Skeleton, TextInput } from "@/components/ui/primitives";
import { ClinicCard } from "@/components/public/ClinicCard";

// Decorative only (aria-hidden): the ruled hours of an appointment book — no names, no data.
function LedgerMotif() {
    const rows = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"];
    const inked = new Set(["09:30", "10:00", "11:30"]);
    return (
        <div aria-hidden className="relative select-none">
            {rows.map((time) => (
                <div key={time} className="ledger-rule flex h-12 items-center gap-4">
                    <span className="tabular w-14 text-lg font-semibold text-graphite">{time}</span>
                    {inked.has(time) ? (
                        <span className="h-6 flex-1 rounded-[3px] bg-malachite/85" />
                    ) : (
                        <span className="h-px flex-1 border-t border-dashed border-rule-strong" />
                    )}
                </div>
            ))}
            <div className="ledger-rule" />
        </div>
    );
}

export default function HomePage() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [q, setQ] = useState("");
    const [city, setCity] = useState("");
    const clinics = useQuery({ queryKey: ["public", "clinics", "home"], queryFn: () => publicApi.clinics({ pageSize: 6 }) });

    const onSearch = (event: FormEvent) => {
        event.preventDefault();
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (city.trim()) params.set("city", city.trim());
        navigate(`/clinics${params.size ? `?${params}` : ""}`);
    };

    const steps = [
        [t("home.step1Title"), t("home.step1")],
        [t("home.step2Title"), t("home.step2")],
        [t("home.step3Title"), t("home.step3")],
    ];

    return (
        <>
            <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-12 md:grid-cols-[1.15fr_0.85fr] md:px-6 md:pt-20">
                <div>
                    <h1 className="max-w-[16ch] text-4xl font-bold leading-[1.08] tracking-tight md:text-5xl">{t("home.title")}</h1>
                    <p className="mt-5 max-w-[52ch] text-lg text-graphite">{t("home.lead")}</p>
                    <form onSubmit={onSearch} className="mt-8 grid gap-3 rounded-sheet bg-surface p-4 ring-1 ring-rule sm:grid-cols-[1fr_0.7fr_auto] sm:items-end">
                        <Field label={t("home.searchLabel")}>
                            {(props) => <TextInput {...props} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.searchPlaceholder")} />}
                        </Field>
                        <Field label={t("home.cityLabel")}>
                            {(props) => <TextInput {...props} value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("home.cityPlaceholder")} />}
                        </Field>
                        <Button type="submit" variant="primary" icon={<MagnifyingGlass aria-hidden size={18} />}>
                            {t("home.searchButton")}
                        </Button>
                    </form>
                </div>
                <div className="hidden md:block">
                    <LedgerMotif />
                </div>
            </section>

            <section aria-labelledby="how" className="border-y border-rule bg-surface">
                <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
                    <h2 id="how" className="text-2xl font-semibold">
                        {t("home.howTitle")}
                    </h2>
                    {/* A real sequence, so numbered. */}
                    <ol className="mt-8 grid gap-8 md:grid-cols-3">
                        {steps.map(([title, body], index) => (
                            <li key={title} className="ledger-rule pt-5">
                                <span className="tabular text-3xl font-semibold text-malachite">{index + 1}</span>
                                <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                                <p className="mt-1 text-graphite">{body}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section aria-labelledby="clinics" className="mx-auto max-w-6xl px-4 py-14 md:px-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <h2 id="clinics" className="text-2xl font-semibold">
                        {t("home.clinicsTitle")}
                    </h2>
                    <Link to="/clinics" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-malachite-deep hover:underline">
                        {t("nav.clinics")} <ArrowRight aria-hidden size={16} className="flip-rtl" />
                    </Link>
                </div>
                <div className="mt-6">
                    {clinics.isPending ? (
                        <div className="grid gap-4 md:grid-cols-3">
                            {[0, 1, 2].map((i) => (
                                <Skeleton key={i} className="h-32" />
                            ))}
                        </div>
                    ) : clinics.isError ? (
                        <ErrorPanel error={clinics.error} onRetry={() => clinics.refetch()} />
                    ) : clinics.data.items.length === 0 ? (
                        <p className="text-graphite">{t("home.clinicsEmpty")}</p>
                    ) : (
                        <ul className="grid gap-4 md:grid-cols-3">
                            {clinics.data.items.map((clinic) => (
                                <li key={clinic.slug}>
                                    <ClinicCard clinic={clinic} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            <section aria-labelledby="for-clinics" className="bg-ink text-paper">
                <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-14 md:flex-row md:items-end md:justify-between md:px-6">
                    <div>
                        <h2 id="for-clinics" className="text-2xl font-semibold">
                            {t("home.forClinicsTitle")}
                        </h2>
                        <p className="mt-2 max-w-[60ch] text-paper/80">{t("home.forClinicsBody")}</p>
                    </div>
                    <ButtonLink to="/workspace" variant="primary">
                        {t("home.forClinicsCta")}
                    </ButtonLink>
                </div>
            </section>
        </>
    );
}
