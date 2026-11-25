// Creates 24-hour appointment reminders. Idempotent; run it hourly (e.g. from a cron job or
// Windows Task Scheduler). Uses the app's database config and guards like the server does.
const prisma = require("../src/config/database");
const logger = require("../src/lib/logger");
const { sendDueReminders, deliverPendingEmails } = require("../src/modules/notifications/notification.service");

(async () => {
    const result = await sendDueReminders();
    await deliverPendingEmails({ limit: 500 });
    logger.info(result, "Reminder run finished");
    await prisma.$disconnect();
    process.exit(0);
})().catch(async (error) => {
    logger.error({ err: error }, "Reminder run failed");
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
});
