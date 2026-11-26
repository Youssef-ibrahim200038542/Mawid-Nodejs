import { useI18n } from "@/i18n";
import { ButtonLink } from "@/components/ui/primitives";

export default function NotFoundPage({ message }: { message?: string }) {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-xl px-4 py-20">
            <p className="tabular text-5xl font-semibold text-graphite">404</p>
            <h1 className="mt-3 text-2xl font-semibold">{t("notFound.title")}</h1>
            <p className="mt-2 text-graphite">{message ?? t("notFound.body")}</p>
            <ButtonLink to="/" variant="ink" className="mt-6">
                {t("notFound.home")}
            </ButtonLink>
        </div>
    );
}
