import { Link } from "react-router";
import { Buildings, Plus, ArrowRight } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthProvider";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui/primitives";

export default function WorkspaceHome() {
    const { t } = useI18n();
    const { me } = useAuth();
    const clinics = me?.clinics ?? [];
    return (
        <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
            <PageHeader
                title={t("workspace.chooseClinic")}
                actions={
                    <ButtonLink to="/workspace/new" variant="ink">
                        <Plus aria-hidden size={18} /> {t("workspace.createClinic")}
                    </ButtonLink>
                }
            />
            {clinics.length === 0 ? (
                <EmptyState
                    icon={<Buildings size={28} aria-hidden />}
                    title={t("workspace.noClinics")}
                    body={t("workspace.noClinicsBody")}
                    action={
                        <ButtonLink to="/workspace/new" variant="primary">
                            {t("workspace.createClinic")}
                        </ButtonLink>
                    }
                />
            ) : (
                <ul>
                    {clinics.map((clinic) => (
                        <li key={clinic.slug} className="ledger-rule">
                            <Link to={`/c/${clinic.slug}`} className="group flex min-h-16 items-center justify-between gap-4 py-3">
                                <span>
                                    <span className="block text-lg font-semibold group-hover:text-malachite-deep">{clinic.name}</span>
                                    <span className="text-sm text-graphite">{t(`roles.${clinic.role}`)}</span>
                                </span>
                                <ArrowRight aria-hidden size={20} className="flip-rtl text-graphite group-hover:text-ink" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
