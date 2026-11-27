// Sends ONE test message through the configured EMAIL_PROVIDER, to verify SMTP settings.
//
//   node scripts/send-test-email.js --env /etc/mawid/mawid.env --to you@your-own-domain.example
//
// Only send to an address you own. It contains no link and no token. The result (sent / failed +
// a short error code) is printed; the provider's full reply and the credentials are never printed.
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

function argValue(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : process.argv[index + 1] || null;
}

(async () => {
    const envArg = argValue("--env");
    const to = argValue("--to");
    if (!envArg || !to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        throw new Error("Usage: node scripts/send-test-email.js --env <env file> --to <an address you own>");
    }
    const envFile = path.resolve(process.cwd(), envArg);
    Object.assign(process.env, dotenv.parse(fs.readFileSync(envFile)));
    const { deliver, getEmailProvider } = require("../src/modules/notifications/email-provider");
    const provider = getEmailProvider();
    const outcome = await deliver({
        to,
        subject: "Mawid email test",
        text: "This is a test message from your Mawid server. If you received it, email delivery is configured.",
        purpose: "TEST",
    });
    console.log(`Provider: ${provider.name} → ${outcome.status}${outcome.code ? ` (${outcome.code})` : ""}`);
    if (outcome.status !== "SENT") process.exitCode = 1;
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
