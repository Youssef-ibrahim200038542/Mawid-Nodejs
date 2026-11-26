import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Availability } from "@/api/types";
import { addDays, todayIn } from "@/lib/format";
import { countByDate, mergeSlots } from "./SlotPicker";

/**
 * Loads real availability for a window of days and derives the ledger for one selected date.
 * `fetcher` is either the public or the staff availability endpoint.
 */
export function useLedger({
    key,
    zone,
    serviceId,
    doctorId,
    days,
    date,
    onDefaultDate,
    fetcher,
    enabled = true,
}: {
    key: unknown[];
    zone: string | undefined;
    serviceId: number | undefined;
    doctorId: number | undefined;
    days: number;
    date: string | null;
    onDefaultDate: (date: string) => void;
    fetcher: (query: { serviceId: number; from: string; to: string }) => Promise<Availability>;
    enabled?: boolean;
}) {
    const from = zone ? todayIn(zone) : "";
    const to = zone ? addDays(from, days - 1, zone) : "";
    const query = useQuery({
        // doctorId is part of the key: the staff endpoint is fetched per doctor.
        queryKey: [...key, "availability", serviceId, doctorId ?? "any", from, to],
        queryFn: () => fetcher({ serviceId: serviceId!, from, to }),
        enabled: enabled && Boolean(zone && serviceId),
        staleTime: 15_000,
        refetchInterval: 60_000, // slots are live: other people book too
    });

    const counts = useMemo(() => (query.data && zone ? countByDate(query.data.doctors, zone, doctorId) : {}), [query.data, zone, doctorId]);

    // Default to the first day that has an open time.
    useEffect(() => {
        if (!query.data || date) return;
        const first = Object.keys(counts).sort()[0];
        onDefaultDate(first ?? from);
    }, [query.data, counts, date, from, onDefaultDate]);

    const slots = useMemo(() => (query.data && zone && date ? mergeSlots(query.data.doctors, date, zone, doctorId) : []), [query.data, zone, date, doctorId]);
    return { query, from, counts, slots };
}
