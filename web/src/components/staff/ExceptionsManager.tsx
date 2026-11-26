import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash, CalendarX } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { scheduleApi, type ExceptionInput } from "@/api/endpoints";
import type { ExceptionKind } from "@/api/types";
import { Button, Checkbox, Dialog, EmptyState, ErrorPanel, ErrorSummary, Field, Select, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useStaff } from "@/layouts/StaffLayout";
import { addDays, formatDate, formatTime, todayIn } from "@/lib/format";

const kinds: ExceptionKind[] = ["HOLIDAY", "LEAVE", "UNAVAILABLE"];

/**
 * Closures for the next 12 months. `doctorId` filters to one doctor (clinic-wide closures are
 * included, as they apply to that doctor too). `scopes` lists what new closures may target.
 */
export function ExceptionsManager({
    doctorId,
    scopes,
    canDelete,
}: {
    doctorId?: number;
    scopes: { value: number | null; label: string }[];
    canDelete: (exceptionDoctorId: number | null) => boolean;
}) {
    const { t, locale, errorMessage } = useI18n();
    const { slug, zone } = useStaff();
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const from = todayIn(zone);
    const to = addDays(from, 365, zone);
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<number | null>(null);
    const [form, setForm] = useState({ kind: "HOLIDAY" as ExceptionKind, scope: String(scopes[0]?.value ?? ""), allDay: true, startDate: from, endDate: from, startsAt: `${from}T09:00`, endsAt: `${from}T17:00`, reason: "" });

    const key = ["staff", slug, "exceptions", doctorId ?? "all"];
    const list = useQuery({ queryKey: [...key, from], queryFn: () => scheduleApi.exceptions(slug, { from, to, doctorId }) });
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "exceptions"] });
        queryClient.invalidateQueries({ queryKey: ["staff", slug, "availability"] });
    };

    const create = useMutation({
        mutationFn: () => {
            const scopeDoctor = form.scope === "" ? null : Number(form.scope);
            const body: ExceptionInput = form.allDay
                ? { kind: form.kind, reason: form.reason.trim() || null, doctorId: scopeDoctor, allDay: true, startDate: form.startDate, endDate: form.endDate }
                : { kind: form.kind, reason: form.reason.trim() || null, doctorId: scopeDoctor, startsAt: form.startsAt, endsAt: form.endsAt };
            return scheduleApi.createException(slug, body);
        },
        onSuccess: () => {
            notify(t("hours.added"));
            setAdding(false);
            invalidate();
        },
    });
    const remove = useMutation({
        mutationFn: (id: number) => scheduleApi.deleteException(slug, id),
        onSuccess: () => {
            notify(t("hours.removed"));
            setRemoving(null);
            invalidate();
        },
    });

    const scopeLabel = (id: number | null) => scopes.find((s) => s.value === id)?.label ?? (id === null ? t("hours.wholeClinic") : `#${id}`);

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-graphite">{t("hours.timezone", { tz: zone })}</p>
                {scopes.length > 0 && (
                    <Button size="sm" variant="ink" icon={<Plus aria-hidden size={16} />} onClick={() => setAdding(true)}>
                        {t("hours.addException")}
                    </Button>
                )}
            </div>
            {list.isPending ? (
                <SkeletonRows rows={2} />
            ) : list.isError ? (
                <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.items.length === 0 ? (
                <EmptyState icon={<CalendarX size={24} aria-hidden />} title={t("hours.exceptionsEmpty")} />
            ) : (
                <ul>
                    {list.data.items.map((e) => (
                        <li key={e.id} className="ledger-rule flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                            <div>
                                <p className="font-medium">
                                    {t(`hours.${e.kind}`)} · {scopeLabel(e.doctorId)}
                                </p>
                                <p className="tabular text-graphite">
                                    {formatDate(e.startsAt, zone, locale, "short")} {formatTime(e.startsAt, zone, locale)} → {formatDate(e.endsAt, zone, locale, "short")} {formatTime(e.endsAt, zone, locale)}
                                </p>
                                {e.reason && <p className="text-graphite">{e.reason}</p>}
                            </div>
                            {canDelete(e.doctorId) && (
                                <Button size="sm" variant="dangerGhost" icon={<Trash aria-hidden size={16} />} onClick={() => setRemoving(e.id)}>
                                    {t("common.remove")}
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <Dialog
                open={adding}
                onClose={() => {
                    setAdding(false);
                    create.reset();
                }}
                title={t("hours.addException")}
                footer={
                    <>
                        <Button onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
                        <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                            {t("common.add")}
                        </Button>
                    </>
                }
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    {create.isError && (
                        <div className="sm:col-span-2">
                            <ErrorSummary message={errorMessage(create.error)} />
                        </div>
                    )}
                    <Field label={t("hours.kind")}>
                        {(p) => (
                            <Select {...p} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ExceptionKind })}>
                                {kinds.map((k) => (
                                    <option key={k} value={k}>
                                        {t(`hours.${k}`)}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field label={t("hours.scope")}>
                        {(p) => (
                            <Select {...p} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                                {scopes.map((s) => (
                                    <option key={String(s.value)} value={s.value === null ? "" : s.value}>
                                        {s.label}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <div className="sm:col-span-2">
                        <Checkbox label={t("hours.allDay")} checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
                    </div>
                    {form.allDay ? (
                        <>
                            <Field label={t("hours.startDate")}>{(p) => <TextInput {...p} type="date" value={form.startDate} min={from} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate < e.target.value ? e.target.value : form.endDate })} />}</Field>
                            <Field label={t("hours.endDate")}>{(p) => <TextInput {...p} type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />}</Field>
                        </>
                    ) : (
                        <>
                            <Field label={t("hours.startsAt")}>{(p) => <TextInput {...p} type="datetime-local" step={300} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />}</Field>
                            <Field label={t("hours.endsAt")}>{(p) => <TextInput {...p} type="datetime-local" step={300} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />}</Field>
                        </>
                    )}
                    <Field label={t("hours.reason")} optional className="sm:col-span-2">
                        {(p) => <TextInput {...p} maxLength={255} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
                    </Field>
                    <p className="text-xs text-graphite sm:col-span-2">{t("hours.timezone", { tz: zone })}</p>
                </div>
            </Dialog>

            <Dialog
                open={removing !== null}
                onClose={() => setRemoving(null)}
                title={t("hours.removeConfirm")}
                footer={
                    <>
                        <Button onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
                        <Button variant="danger" loading={remove.isPending} onClick={() => removing !== null && remove.mutate(removing)}>
                            {t("common.remove")}
                        </Button>
                    </>
                }
            >
                {remove.isError ? <ErrorSummary message={errorMessage(remove.error)} /> : <p className="text-sm text-graphite">{t("hours.removeConfirm")}</p>}
            </Dialog>
        </div>
    );
}
