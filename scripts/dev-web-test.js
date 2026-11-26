// Starts the Vite dev server for web/ with its /api proxy pointed at the mawid_test API
// (scripts/dev-test-server.js, port 3100).
const { spawn } = require("node:child_process");
const path = require("node:path");

const child = spawn("npx vite", {
    cwd: path.join(__dirname, "..", "web"),
    stdio: "inherit",
    shell: true,
    env: { ...process.env, MAWID_API_URL: process.env.MAWID_API_URL || "http://127.0.0.1:3100" },
});
child.on("exit", (code) => process.exit(code ?? 0));
