import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { PublicLayout } from "@/layouts/PublicLayout";
import { RequireAuth, RequireSuperAdmin } from "@/auth/guards";
import { Spinner } from "@/components/ui/primitives";
import HomePage from "@/pages/public/HomePage";
import NotFoundPage from "@/pages/NotFoundPage";
import RouteError from "@/pages/RouteError";

// Everything except the home page is code-split; patients never download the staff/admin areas.
const DiscoveryPage = lazy(() => import("@/pages/public/DiscoveryPage"));
const ClinicPage = lazy(() => import("@/pages/public/ClinicPage"));
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const SignupPage = lazy(() => import("@/pages/auth/SignupPage"));
const MyAppointmentsPage = lazy(() => import("@/pages/portal/MyAppointmentsPage"));
const NotificationsPage = lazy(() => import("@/pages/portal/NotificationsPage"));
const ProfilePage = lazy(() => import("@/pages/portal/ProfilePage"));
const WorkspaceHome = lazy(() => import("@/pages/workspace/WorkspaceHome"));
const CreateClinicPage = lazy(() => import("@/pages/workspace/CreateClinicPage"));
const StaffLayout = lazy(() => import("@/layouts/StaffLayout"));
const StaffIndex = lazy(() => import("@/pages/staff/StaffIndex"));
const TodayPage = lazy(() => import("@/pages/staff/TodayPage"));
const CalendarPage = lazy(() => import("@/pages/staff/CalendarPage"));
const AppointmentsPage = lazy(() => import("@/pages/staff/AppointmentsPage"));
const NewBookingPage = lazy(() => import("@/pages/staff/NewBookingPage"));
const PatientsPage = lazy(() => import("@/pages/staff/PatientsPage"));
const PatientDetailPage = lazy(() => import("@/pages/staff/PatientDetailPage"));
const DoctorsPage = lazy(() => import("@/pages/staff/DoctorsPage"));
const DoctorDetailPage = lazy(() => import("@/pages/staff/DoctorDetailPage"));
const ServicesPage = lazy(() => import("@/pages/staff/ServicesPage"));
const SpecialtiesPage = lazy(() => import("@/pages/staff/SpecialtiesPage"));
const HoursPage = lazy(() => import("@/pages/staff/HoursPage"));
const TeamPage = lazy(() => import("@/pages/staff/TeamPage"));
const AnalyticsPage = lazy(() => import("@/pages/staff/AnalyticsPage"));
const AuditPage = lazy(() => import("@/pages/staff/AuditPage"));
const SettingsPage = lazy(() => import("@/pages/staff/SettingsPage"));
const MySchedulePage = lazy(() => import("@/pages/staff/MySchedulePage"));
const AdminLayout = lazy(() => import("@/layouts/AdminLayout"));
const AdminOverviewPage = lazy(() => import("@/pages/admin/AdminOverviewPage"));
const AdminClinicsPage = lazy(() => import("@/pages/admin/AdminClinicsPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage"));
const AdminAuditPage = lazy(() => import("@/pages/admin/AdminAuditPage"));

const page = (node: ReactNode) => (
    <Suspense
        fallback={
            <div className="p-8">
                <Spinner />
            </div>
        }
    >
        {node}
    </Suspense>
);

export const router = createBrowserRouter([
    {
        element: <PublicLayout />,
        errorElement: <RouteError />,
        children: [
            { index: true, element: <HomePage /> },
            { path: "clinics", element: page(<DiscoveryPage />) },
            { path: "clinics/:slug", element: page(<ClinicPage />) },
            { path: "login", element: page(<LoginPage />) },
            { path: "signup", element: page(<SignupPage />) },
            { path: "me/appointments", element: <RequireAuth>{page(<MyAppointmentsPage />)}</RequireAuth> },
            { path: "notifications", element: <RequireAuth>{page(<NotificationsPage />)}</RequireAuth> },
            { path: "profile", element: <RequireAuth>{page(<ProfilePage />)}</RequireAuth> },
            { path: "workspace", element: <RequireAuth>{page(<WorkspaceHome />)}</RequireAuth> },
            { path: "workspace/new", element: <RequireAuth>{page(<CreateClinicPage />)}</RequireAuth> },
            { path: "*", element: <NotFoundPage /> },
        ],
    },
    {
        path: "c/:slug",
        errorElement: <RouteError />,
        element: <RequireAuth>{page(<StaffLayout />)}</RequireAuth>,
        children: [
            { index: true, element: page(<StaffIndex />) },
            { path: "today", element: page(<TodayPage />) },
            { path: "calendar", element: page(<CalendarPage />) },
            { path: "appointments", element: page(<AppointmentsPage />) },
            { path: "appointments/new", element: page(<NewBookingPage />) },
            { path: "patients", element: page(<PatientsPage />) },
            { path: "patients/:patientId", element: page(<PatientDetailPage />) },
            { path: "doctors", element: page(<DoctorsPage />) },
            { path: "doctors/:doctorId", element: page(<DoctorDetailPage />) },
            { path: "services", element: page(<ServicesPage />) },
            { path: "specialties", element: page(<SpecialtiesPage />) },
            { path: "hours", element: page(<HoursPage />) },
            { path: "team", element: page(<TeamPage />) },
            { path: "analytics", element: page(<AnalyticsPage />) },
            { path: "audit", element: page(<AuditPage />) },
            { path: "settings", element: page(<SettingsPage />) },
            { path: "my-schedule", element: page(<MySchedulePage />) },
            { path: "*", element: <Navigate to=".." relative="path" replace /> },
        ],
    },
    {
        path: "admin",
        errorElement: <RouteError />,
        element: (
            <RequireAuth>
                <RequireSuperAdmin>{page(<AdminLayout />)}</RequireSuperAdmin>
            </RequireAuth>
        ),
        children: [
            { index: true, element: page(<AdminOverviewPage />) },
            { path: "clinics", element: page(<AdminClinicsPage />) },
            { path: "users", element: page(<AdminUsersPage />) },
            { path: "audit", element: page(<AdminAuditPage />) },
        ],
    },
]);
