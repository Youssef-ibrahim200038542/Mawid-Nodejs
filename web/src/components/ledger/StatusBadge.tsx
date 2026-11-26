import { CheckCircle, Clock, XCircle, Check, UserMinus } from "@phosphor-icons/react";
import type { AppointmentStatus } from "@/api/types";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/cx";

// Status = icon + label + color (never color alone).
const styles: Record<AppointmentStatus, { className: string; Icon: typeof Clock }> = {
    PENDING: { className: "bg-saffron-tint text-ink ring-saffron/50", Icon: Clock },
    CONFIRMED: { className: "bg-malachite-tint text-malachite-deep ring-malachite/30", Icon: CheckCircle },
    CANCELLED: { className: "bg-carmine-tint text-carmine-deep ring-carmine/30", Icon: XCircle },
    COMPLETED: { className: "bg-ink/[0.06] text-ink ring-ink/15", Icon: Check },
    NO_SHOW: { className: "bg-ink/[0.06] text-graphite ring-ink/15", Icon: UserMinus },
};

export function StatusBadge({ status, compact = false }: { status: AppointmentStatus; compact?: boolean }) {
    const { t } = useI18n();
    const { className, Icon } = styles[status];
    return (
        <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1", className)}>
            <Icon aria-hidden size={14} weight="bold" />
            <span className={compact ? "sr-only" : undefined}>{t(`status.${status}`)}</span>
        </span>
    );
}

export const statusAccent: Record<AppointmentStatus, string> = {
    PENDING: "border-saffron",
    CONFIRMED: "border-malachite",
    CANCELLED: "border-carmine",
    COMPLETED: "border-ink",
    NO_SHOW: "border-graphite",
};
