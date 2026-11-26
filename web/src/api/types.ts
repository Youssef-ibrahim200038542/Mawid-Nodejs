// Response shapes of the Mawid REST API (/api/v1). Mirrors the backend presenters/selects:
//   src/modules/*/(*.service|*.presenter|*.routes).js — keep in sync when the API changes.

export type Locale = "en" | "ar";
export type Role = "OWNER" | "DOCTOR" | "RECEPTIONIST";
export type PlatformRole = "USER" | "SUPER_ADMIN";
export type AppointmentStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
export type AppointmentSource = "ONLINE" | "STAFF";
export type ExceptionKind = "HOLIDAY" | "LEAVE" | "UNAVAILABLE";
export type MemberStatus = "ACTIVE" | "DISABLED";
export type ClinicStatus = "ACTIVE" | "SUSPENDED";
export type TrustState = "LEGACY_UNREVIEWED" | "TRUSTED";
export type TrustSource = "CLINIC_CREATOR" | "INVITATION" | "RECONFIRMATION";
export type InvitationKind = "NEW_MEMBER" | "RECONFIRM";
export type Delivery = "sent" | "skipped" | "failed" | "pending" | "unknown";

export interface ApiErrorBody {
    error: { status: number; code: string; message: string; details?: { path: string; code: string; message: string }[] | { retryAfterSeconds?: number } };
}

export interface Paged<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
}

// ---- auth (/auth/*)
export interface User {
    id: number;
    name: string;
    email: string;
    platformRole: PlatformRole;
    locale: Locale;
    emailVerified: boolean;
}
export interface MyClinic {
    id: number;
    slug: string;
    name: string;
    timezone: string;
    defaultLocale: Locale;
    role: Role;
    trustState: TrustState;
    memberId: number;
    doctorProfileId: number | null;
}
export interface MePayload {
    user: User;
    clinics: MyClinic[];
}
export interface AuthPayload extends MePayload {
    csrfToken: string;
}
export interface AcceptedPayload {
    status: "check_email";
    message: string;
}

// ---- invitations
export interface Invitation {
    id: number;
    kind: InvitationKind;
    email: string;
    role: Role;
    status: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
    memberId: number | null;
    expiresAt: string;
    expired: boolean;
    lastSentAt: string;
    sendCount: number;
    delivery: Delivery;
    createdAt: string;
    invitedBy: { id: number; name: string } | null;
}
export interface InvitationPreview {
    clinic: { name: string };
    kind: InvitationKind;
    role: Role;
    expiresAt: string;
    emailHint: string;
    viewer: { matchesInvitation: boolean; emailVerified: boolean } | null;
}
export interface InvitationResult {
    invitation: Invitation;
    delivery: Delivery;
}

// ---- clinics (/clinics, /clinics/:slug)
export interface Clinic {
    id: number;
    slug: string;
    name: string;
    timezone: string;
    defaultLocale: Locale;
    status: ClinicStatus;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    createdAt: string;
    role: Role;
}
export interface Member {
    id: number;
    role: Role;
    status: MemberStatus;
    trustState: TrustState;
    trustSource: TrustSource | null;
    trustedAt: string | null;
    createdAt: string;
    user: { id: number; name: string; email: string };
    pendingReconfirmation: { invitationId: number; expiresAt: string } | null;
}

// ---- clinic operations
export interface Specialty {
    id: number;
    nameEn: string;
    nameAr: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface ServiceDoctorRef {
    id: number;
    displayNameEn: string;
    displayNameAr: string | null;
    isActive: boolean;
}
export interface Service {
    id: number;
    nameEn: string;
    nameAr: string | null;
    descriptionEn: string | null;
    descriptionAr: string | null;
    durationMinutes: number;
    priceMinor: number;
    price: string;
    currency: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    doctors?: ServiceDoctorRef[];
}
export interface Doctor {
    id: number;
    memberId: number;
    displayNameEn: string;
    displayNameAr: string | null;
    titleEn: string | null;
    titleAr: string | null;
    bioEn: string | null;
    bioAr: string | null;
    yearsOfExperience: number | null;
    licenseNumber: string | null;
    isActive: boolean;
    memberTrustState: TrustState;
    bookable: boolean;
    createdAt: string;
    updatedAt: string;
    specialties: { id: number; nameEn: string; nameAr: string | null; isActive: boolean }[];
    services: { id: number; nameEn: string; nameAr: string | null; durationMinutes: number; isActive: boolean }[];
}
export interface WeeklyInterval {
    weekday: number; // ISO 1 = Monday … 7 = Sunday
    start: string; // "HH:mm"
    end: string;
}
export interface WeeklyHours {
    timezone: string;
    intervals: WeeklyInterval[];
}
export interface ScheduleException {
    id: number;
    doctorId: number | null;
    kind: ExceptionKind;
    reason: string | null;
    startsAt: string;
    endsAt: string;
    startsAtLocal: string;
    endsAtLocal: string;
    timezone: string;
    createdAt: string;
}
export interface ExceptionList {
    from: string;
    to: string;
    timezone: string;
    items: ScheduleException[];
}

// ---- appointments
export interface PatientRef {
    id: number;
    fullName: string;
    phone: string | null;
    email: string | null;
    hasAccount: boolean;
}
export interface Appointment {
    id: number;
    status: AppointmentStatus;
    source: AppointmentSource;
    startsAt: string;
    endsAt: string;
    startsAtLocal: string;
    endsAtLocal: string;
    timezone: string;
    durationMinutes: number;
    price: string;
    priceMinor: number;
    currency: string;
    note: string | null;
    confirmedAt: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
    rescheduleCount: number;
    createdAt: string;
    doctor: { id: number; displayNameEn: string; displayNameAr: string | null };
    service: { id: number; nameEn: string; nameAr: string | null };
    patient?: PatientRef;
    clinic?: { slug: string; name: string };
}
export interface Slot {
    startsAt: string;
    endsAt: string;
    startsAtLocal: string;
}
export interface Availability {
    timezone: string;
    from: string;
    to: string;
    service: { id: number; durationMinutes: number };
    doctors: { id: number; displayNameEn: string; displayNameAr: string | null; slots: Slot[] }[];
}
export interface Patient extends PatientRef {
    createdAt: string;
    updatedAt: string;
    recentAppointments?: Appointment[];
}

// ---- public (/public/*)
export interface PublicClinicListItem {
    slug: string;
    name: string;
    city: string | null;
    address: string | null;
    defaultLocale: Locale;
    specialties: { id: number; nameEn: string; nameAr: string | null }[];
}
export interface PublicClinic {
    clinic: {
        slug: string;
        name: string;
        timezone: string;
        defaultLocale: Locale;
        phone: string | null;
        email: string | null;
        address: string | null;
        city: string | null;
    };
    specialties: { id: number; nameEn: string; nameAr: string | null }[];
    services: {
        id: number;
        nameEn: string;
        nameAr: string | null;
        descriptionEn: string | null;
        descriptionAr: string | null;
        durationMinutes: number;
        priceMinor: number;
        currency: string;
        price: string;
    }[];
    doctors: {
        id: number;
        displayNameEn: string;
        displayNameAr: string | null;
        titleEn: string | null;
        titleAr: string | null;
        bioEn: string | null;
        bioAr: string | null;
        yearsOfExperience: number | null;
        specialtyIds: number[];
        serviceIds: number[];
    }[];
    workingHours: WeeklyHours;
}

// ---- notifications (/me/notifications)
export type NotificationType =
    | "APPOINTMENT_BOOKED"
    | "APPOINTMENT_CONFIRMED"
    | "APPOINTMENT_CANCELLED"
    | "APPOINTMENT_RESCHEDULED"
    | "APPOINTMENT_REMINDER";
export interface AppNotification {
    id: number;
    type: NotificationType;
    appointmentId: number | null;
    readAt: string | null;
    createdAt: string;
    payload: {
        appointmentId: number;
        status: AppointmentStatus;
        startsAt: string;
        endsAt: string;
        timezone: string;
        clinic: { slug: string; name: string };
        doctor: { nameEn: string; nameAr: string | null };
        service: { nameEn: string; nameAr: string | null };
        audience: "staff" | "patient";
    };
}
export interface NotificationList extends Paged<AppNotification> {
    unread: number;
}

// ---- analytics (/clinics/:slug/analytics/overview)
export interface AnalyticsOverview {
    timezone: string;
    from: string;
    to: string;
    totals: {
        appointments: number;
        byStatus: Record<AppointmentStatus, number>;
        noShowRate: number | null;
        cancellationRate: number | null;
        newPatients: number;
        pendingUpcoming: number;
    };
    revenue: { currency: string; completedAppointments: number; amountMinor: number; amount: string }[];
    today: { date: string; total: number; active: number };
    daily: { date: string; total: number; completed: number; cancelled: number; noShow: number }[];
    byDoctor: { id: number; displayNameEn: string; displayNameAr: string | null; total: number; completed: number; cancelled: number; noShow: number }[];
    topServices: { id: number; nameEn?: string; nameAr?: string | null; count: number }[];
    truncated: boolean;
}

// ---- audit
export interface AuditEntry {
    id: number;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
    createdAt: string;
    actor: { id: number; name: string; email: string } | null;
    clinicId?: number | null;
    ipAddress?: string | null;
}

// ---- super admin (/admin/*)
export interface AdminOverview {
    clinics: Partial<Record<ClinicStatus, number>>;
    users: number;
    superAdmins: number;
    patients: number;
    appointments: { total: number; last30Days: number };
}
export interface AdminClinic {
    id: number;
    slug: string;
    name: string;
    city: string | null;
    status: ClinicStatus;
    timezone: string;
    createdAt: string;
    _count: { members: number; doctors: number; appointments: number; patients: number };
    trustedOwners: number;
}
export interface AdminClinicOwner {
    memberId: number;
    status: MemberStatus;
    trustState: TrustState;
    createdAt: string;
    user: { id: number; name: string; emailHint: string; emailVerified: boolean };
}
export interface AdminUser {
    id: number;
    name: string;
    email: string;
    platformRole: PlatformRole;
    locale: Locale;
    createdAt: string;
    emailVerified: boolean;
    _count: { memberships: number };
}
