import { isRouteErrorResponse, useRouteError } from "react-router";
import { WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { Button, ButtonLink } from "@/components/ui/primitives";
import NotFoundPage from "./NotFoundPage";

// Last-resort boundary for unexpected render errors: a calm, translated message instead of a stack trace.
export default function RouteError() {
    const error = useRouteError();
    const { t } = useI18n();
    if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
    if (import.meta.env.DEV) console.error(error);
    return (
        <div role="alert" className="mx-auto max-w-xl px-4 py-20">
            <WarningCircle aria-hidden size={40} weight="fill" className="text-carmine" />
            <h1 className="mt-4 text-2xl font-semibold">{t("errors.generic")}</h1>
            <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="ink" onClick={() => window.location.reload()}>
                    {t("common.retry")}
                </Button>
                <ButtonLink to="/">{t("notFound.home")}</ButtonLink>
            </div>
        </div>
    );
}
