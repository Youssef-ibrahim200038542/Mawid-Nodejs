import { Navigate } from "react-router";
import { useStaff } from "@/layouts/StaffLayout";
import { useI18n } from "@/i18n";
import { ErrorPanel } from "@/components/ui/primitives";
import { ApiError } from "@/api/client";

// Everyone lands on today's ledger; it adapts to the role (doctors see their own column).
export default function StaffIndex() {
    const { slug } = useStaff();
    return <Navigate to={`/c/${slug}/today`} replace />;
}

/** Shown when a role opens a page it can't use (the API would refuse it anyway). */
export function NotAllowed() {
    const { t } = useI18n();
    return <ErrorPanel error={new ApiError(403, "FORBIDDEN", t("errors.FORBIDDEN"))} />;
}
