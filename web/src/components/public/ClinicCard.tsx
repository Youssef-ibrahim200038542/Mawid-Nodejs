import { Link } from "react-router";
import { MapPin } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import type { PublicClinicListItem } from "@/api/types";
import { joinParts } from "@/lib/format";

export function ClinicCard({ clinic }: { clinic: PublicClinicListItem }) {
    const { t, pick, locale } = useI18n();
    return (
        <Link
            to={`/clinics/${clinic.slug}`}
            className="group flex h-full flex-col gap-2 rounded-sheet bg-surface p-5 ring-1 ring-rule transition-shadow hover:shadow-float hover:ring-rule-strong"
        >
            <span className="text-lg font-semibold group-hover:text-malachite-deep">{clinic.name}</span>
            {(clinic.city || clinic.address) && (
                <span className="flex items-center gap-1.5 text-sm text-graphite">
                    <MapPin aria-hidden size={16} />
                    {joinParts([clinic.address, clinic.city], locale)}
                </span>
            )}
            {clinic.specialties.length > 0 && (
                <span className="mt-auto pt-2 text-sm text-ink">{clinic.specialties.map((s) => pick(s.nameEn, s.nameAr)).join(" · ")}</span>
            )}
            <span className="sr-only">{t("discovery.open")}</span>
        </Link>
    );
}
