import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The SPA talks to the Express API through a same-origin proxy, so the session cookie
// (SameSite=Lax, HttpOnly) and the CSRF flow work exactly as in production. No CORS needed.
const apiTarget = process.env.MAWID_API_URL || "http://127.0.0.1:3000";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
        port: 5173,
        strictPort: true,
        // The dev email outbox (../var/mail-outbox) holds live account links. It is outside the
        // Vite root already; deny it explicitly too, keeping Vite's default deny list.
        fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/var/mail-outbox/**"] },
        proxy: {
            "/api": { target: apiTarget, changeOrigin: false },
        },
    },
    preview: {
        port: 4173,
        proxy: {
            "/api": { target: apiTarget, changeOrigin: false },
        },
    },
    build: {
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) return undefined;
                    if (/node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return "react";
                    // Shared by public pages and the staff calendar: keep separate so patients
                    // never download FullCalendar just to get Luxon.
                    if (/node_modules[\\/]luxon[\\/]/.test(id)) return "luxon";
                    if (/node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return "forms";
                    if (id.includes("@fullcalendar")) return "calendar";
                    if (/node_modules[\\/](recharts|d3-|victory-vendor)/.test(id)) return "charts";
                    return undefined;
                },
            },
        },
    },
});
