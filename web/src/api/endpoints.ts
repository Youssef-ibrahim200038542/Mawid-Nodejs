// One function per real backend route (see `grep router.<verb>` in src/modules).
import { del, get, patch, post, put } from "./client";
import type * as T from "./types";

const enc = encodeURIComponent;
const clinicPath = (slug: string) => `/clinics/${enc(slug)}`;

export const authApi = {
    me: () => get<T.MePayload>("/auth/me"),
    login: (body: { email: string; password: string }) => post<T.AuthPayload>("/auth/login", body),
    signup: (body: { name: string; email: string; password: string; locale?: T.Locale }) => post<T.AcceptedPayload>("/auth/signup", body),
    logout: () => post<void>("/auth/logout", {}),
    verifyEmail: (token: string) => post<{ verified: true }>("/auth/verify-email", { token }),
    resendVerification: () => post<{ delivery: T.Delivery }>("/auth/verify-email/resend", {}),
    forgotPassword: (email: string) => post<T.AcceptedPayload>("/auth/password/forgot", { email }),
    resetPassword: (token: string, password: string) => post<void>("/auth/password/reset", { token, password }),
    updateMe: (body: { name?: string; locale?: T.Locale }) => patch<{ user: T.User }>("/auth/me", body),
};

export const publicApi = {
    clinics: (query: { q?: string; city?: string; page?: number; pageSize?: number }) => get<T.Paged<T.PublicClinicListItem>>("/public/clinics", query),
    clinic: (slug: string) => get<T.PublicClinic>(`/public/clinics/${enc(slug)}`),
    availability: (slug: string, query: { serviceId: number; doctorId?: number; from?: string; to?: string }) =>
        get<T.Availability>(`/public/clinics/${enc(slug)}/availability`, query),
    book: (slug: string, body: { doctorId: number; serviceId: number; startsAt: string; phone?: string | null; note?: string | null }) =>
        post<{ appointment: T.Appointment }>(`/public/clinics/${enc(slug)}/appointments`, body),
};

export const meApi = {
    appointments: (query: { scope: "upcoming" | "past"; page?: number; pageSize?: number }) => get<T.Paged<T.Appointment>>("/me/appointments", query),
    cancel: (id: number, reason?: string | null) => post<{ appointment: T.Appointment }>(`/me/appointments/${id}/cancel`, { reason: reason || undefined }),
    reschedule: (id: number, body: { startsAt: string; doctorId?: number }) => post<{ appointment: T.Appointment }>(`/me/appointments/${id}/reschedule`, body),
    notifications: (query: { unreadOnly?: boolean; page?: number; pageSize?: number }) => get<T.NotificationList>("/me/notifications", query),
    readNotification: (id: number) => post<void>(`/me/notifications/${id}/read`, {}),
    readAllNotifications: () => post<{ updated: number }>("/me/notifications/read-all", {}),
};

export const clinicsApi = {
    mine: () => get<{ clinics: T.MyClinic[] }>("/clinics"),
    create: (body: { name: string; slug: string; timezone?: string; defaultLocale?: T.Locale; phone?: string; email?: string; address?: string; city?: string }) =>
        post<{ clinic: T.Clinic }>("/clinics", body),
    get: (slug: string) => get<{ clinic: T.Clinic }>(clinicPath(slug)),
    update: (slug: string, body: Partial<Pick<T.Clinic, "name" | "timezone" | "defaultLocale" | "phone" | "email" | "address" | "city">>) =>
        patch<{ clinic: T.Clinic }>(clinicPath(slug), body),
    members: (slug: string, query: { page?: number; pageSize?: number }) => get<T.Paged<T.Member>>(`${clinicPath(slug)}/members`, query),
    requestReconfirmation: (slug: string, memberId: number) => post<T.InvitationResult>(`${clinicPath(slug)}/members/${memberId}/reconfirmations`, {}),
    updateMember: (slug: string, memberId: number, body: { role?: T.Role; status?: T.MemberStatus }) =>
        patch<{ member: T.Member }>(`${clinicPath(slug)}/members/${memberId}`, body),
};

export const invitationsApi = {
    list: (slug: string) => get<{ items: T.Invitation[] }>(`${clinicPath(slug)}/invitations`),
    create: (slug: string, body: { email: string; role: T.Role }) => post<T.InvitationResult>(`${clinicPath(slug)}/invitations`, body),
    resend: (slug: string, id: number) => post<T.InvitationResult>(`${clinicPath(slug)}/invitations/${id}/resend`, {}),
    revoke: (slug: string, id: number) => post<{ invitation: T.Invitation }>(`${clinicPath(slug)}/invitations/${id}/revoke`, {}),
    // The token is sent in the body only, never in a URL.
    preview: (token: string) => post<T.InvitationPreview>("/invitations/preview", { token }),
    accept: (token: string) => post<{ clinic: { slug: string; name: string }; role: T.Role; kind: T.InvitationKind }>("/invitations/accept", { token }),
    decline: (token: string) => post<void>("/invitations/decline", { token }),
};

type Bilingual = { nameEn: string; nameAr?: string | null };

export const specialtiesApi = {
    list: (slug: string, includeInactive = false) => get<{ specialties: T.Specialty[] }>(`${clinicPath(slug)}/specialties`, { includeInactive }),
    create: (slug: string, body: Bilingual) => post<{ specialty: T.Specialty }>(`${clinicPath(slug)}/specialties`, body),
    update: (slug: string, id: number, body: Partial<Bilingual & { isActive: boolean }>) => patch<{ specialty: T.Specialty }>(`${clinicPath(slug)}/specialties/${id}`, body),
};

export interface ServiceInput {
    nameEn: string;
    nameAr?: string | null;
    descriptionEn?: string | null;
    descriptionAr?: string | null;
    durationMinutes: number;
    price: string;
    currency: string;
}
export const servicesApi = {
    list: (slug: string, includeInactive = false) => get<{ services: T.Service[] }>(`${clinicPath(slug)}/services`, { includeInactive }),
    get: (slug: string, id: number) => get<{ service: T.Service }>(`${clinicPath(slug)}/services/${id}`),
    create: (slug: string, body: ServiceInput) => post<{ service: T.Service }>(`${clinicPath(slug)}/services`, body),
    update: (slug: string, id: number, body: Partial<ServiceInput & { isActive: boolean }>) => patch<{ service: T.Service }>(`${clinicPath(slug)}/services/${id}`, body),
};

export interface DoctorProfileInput {
    displayNameEn: string;
    displayNameAr?: string | null;
    titleEn?: string | null;
    titleAr?: string | null;
    bioEn?: string | null;
    bioAr?: string | null;
    yearsOfExperience?: number | null;
    licenseNumber?: string | null;
}
export const doctorsApi = {
    list: (slug: string, query: { includeInactive?: boolean; specialtyId?: number; serviceId?: number; page?: number; pageSize?: number }) =>
        get<T.Paged<T.Doctor>>(`${clinicPath(slug)}/doctors`, query),
    get: (slug: string, id: number) => get<{ doctor: T.Doctor }>(`${clinicPath(slug)}/doctors/${id}`),
    create: (slug: string, body: DoctorProfileInput & { memberId: number; specialtyIds?: number[]; serviceIds?: number[] }) =>
        post<{ doctor: T.Doctor }>(`${clinicPath(slug)}/doctors`, body),
    update: (slug: string, id: number, body: Partial<DoctorProfileInput & { isActive: boolean }>) => patch<{ doctor: T.Doctor }>(`${clinicPath(slug)}/doctors/${id}`, body),
    setSpecialties: (slug: string, id: number, specialtyIds: number[]) => put<{ doctor: T.Doctor }>(`${clinicPath(slug)}/doctors/${id}/specialties`, { specialtyIds }),
    setServices: (slug: string, id: number, serviceIds: number[]) => put<{ doctor: T.Doctor }>(`${clinicPath(slug)}/doctors/${id}/services`, { serviceIds }),
};

export type ExceptionInput =
    | { kind: T.ExceptionKind; reason?: string | null; doctorId?: number | null; allDay: true; startDate: string; endDate: string }
    | { kind: T.ExceptionKind; reason?: string | null; doctorId?: number | null; allDay?: false; startsAt: string; endsAt: string };

export const scheduleApi = {
    clinicHours: (slug: string) => get<T.WeeklyHours>(`${clinicPath(slug)}/working-hours`),
    setClinicHours: (slug: string, intervals: T.WeeklyInterval[]) => put<T.WeeklyHours>(`${clinicPath(slug)}/working-hours`, { intervals }),
    doctorHours: (slug: string, doctorId: number) => get<T.WeeklyHours>(`${clinicPath(slug)}/doctors/${doctorId}/working-hours`),
    setDoctorHours: (slug: string, doctorId: number, intervals: T.WeeklyInterval[]) =>
        put<T.WeeklyHours>(`${clinicPath(slug)}/doctors/${doctorId}/working-hours`, { intervals }),
    exceptions: (slug: string, query: { from?: string; to?: string; doctorId?: number }) => get<T.ExceptionList>(`${clinicPath(slug)}/schedule-exceptions`, query),
    createException: (slug: string, body: ExceptionInput) => post<{ exception: T.ScheduleException }>(`${clinicPath(slug)}/schedule-exceptions`, body),
    deleteException: (slug: string, id: number) => del<void>(`${clinicPath(slug)}/schedule-exceptions/${id}`),
};

export interface StaffBookingInput {
    doctorId: number;
    serviceId: number;
    startsAt: string;
    patientId?: number;
    patient?: { fullName: string; phone?: string | null; email?: string | null };
    note?: string | null;
    status?: "PENDING" | "CONFIRMED";
}
export const appointmentsApi = {
    availability: (slug: string, query: { serviceId: number; doctorId?: number; from?: string; to?: string }) =>
        get<T.Availability>(`${clinicPath(slug)}/availability`, query),
    list: (slug: string, query: { from?: string; to?: string; doctorId?: number; patientId?: number; status?: T.AppointmentStatus; page?: number; pageSize?: number }) =>
        get<T.Paged<T.Appointment>>(`${clinicPath(slug)}/appointments`, query),
    get: (slug: string, id: number) => get<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments/${id}`),
    create: (slug: string, body: StaffBookingInput) => post<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments`, body),
    confirm: (slug: string, id: number) => post<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments/${id}/confirm`, {}),
    complete: (slug: string, id: number) => post<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments/${id}/complete`, {}),
    noShow: (slug: string, id: number) => post<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments/${id}/no-show`, {}),
    cancel: (slug: string, id: number, reason?: string | null) => post<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments/${id}/cancel`, { reason: reason || undefined }),
    reschedule: (slug: string, id: number, body: { startsAt: string; doctorId?: number }) =>
        post<{ appointment: T.Appointment }>(`${clinicPath(slug)}/appointments/${id}/reschedule`, body),
};

export const patientsApi = {
    list: (slug: string, query: { q?: string; page?: number; pageSize?: number }) => get<T.Paged<T.Patient>>(`${clinicPath(slug)}/patients`, query),
    get: (slug: string, id: number) => get<{ patient: T.Patient }>(`${clinicPath(slug)}/patients/${id}`),
    create: (slug: string, body: { fullName: string; phone?: string | null; email?: string | null }) => post<{ patient: T.Patient }>(`${clinicPath(slug)}/patients`, body),
    update: (slug: string, id: number, body: { fullName?: string; phone?: string | null; email?: string | null }) => patch<{ patient: T.Patient }>(`${clinicPath(slug)}/patients/${id}`, body),
};

export const insightsApi = {
    overview: (slug: string, query: { from?: string; to?: string }) => get<T.AnalyticsOverview>(`${clinicPath(slug)}/analytics/overview`, query),
    auditLogs: (slug: string, query: { action?: string; page?: number; pageSize?: number }) => get<T.Paged<T.AuditEntry>>(`${clinicPath(slug)}/audit-logs`, query),
};

export const adminApi = {
    overview: () => get<T.AdminOverview>("/admin/overview"),
    clinics: (query: { q?: string; status?: T.ClinicStatus; page?: number; pageSize?: number }) => get<T.Paged<T.AdminClinic>>("/admin/clinics", query),
    setClinicStatus: (id: number, body: { status: T.ClinicStatus; reason?: string }) => patch<{ clinic: Pick<T.AdminClinic, "id" | "slug" | "name" | "status"> }>(`/admin/clinics/${id}`, body),
    users: (query: { q?: string; page?: number; pageSize?: number }) => get<T.Paged<T.AdminUser>>("/admin/users", query),
    setUserRole: (id: number, platformRole: T.PlatformRole) => patch<{ user: Pick<T.AdminUser, "id" | "name" | "email" | "platformRole"> }>(`/admin/users/${id}`, { platformRole }),
    auditLogs: (query: { clinicId?: number; action?: string; page?: number; pageSize?: number }) => get<T.Paged<T.AuditEntry>>("/admin/audit-logs", query),
    clinicOwners: (id: number) => get<{ items: T.AdminClinicOwner[] }>(`/admin/clinics/${id}/owners`),
    requestOwnerReconfirmation: (id: number, memberId: number) => post<T.InvitationResult>(`/admin/clinics/${id}/owner-reconfirmations`, { memberId }),
};
