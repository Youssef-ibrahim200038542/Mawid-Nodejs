// Plain-text account emails (English / Arabic). Links put the token in the URL fragment
// (#token=…): fragments are never sent to a server, so tokens stay out of access logs and
// Referer headers. These messages are built in memory and handed straight to the provider.
const { webAppUrl } = require("../../config/startup-checks");

const pick = (locale, en, ar) => (locale === "ar" ? ar : en);

function link(path, raw) {
    return `${webAppUrl()}${path}${raw ? `#token=${raw}` : ""}`;
}

const roleNames = {
    OWNER: ["Owner", "مالك"],
    DOCTOR: ["Doctor", "طبيب"],
    RECEPTIONIST: ["Receptionist", "موظف استقبال"],
};

function buildAuthEmail({ purpose, locale, name, raw }) {
    if (purpose === "EMAIL_VERIFY") {
        return {
            subject: pick(locale, "Confirm your email for Mawid", "أكّد بريدك الإلكتروني على موعد"),
            text: pick(
                locale,
                `Hello ${name},\n\nConfirm that this is your email address:\n${link("/verify-email", raw)}\n\nThe link works once and expires in 24 hours. If you didn't create a Mawid account, ignore this email.`,
                `مرحبًا ${name}،\n\nأكّد أن هذا هو بريدك الإلكتروني:\n${link("/verify-email", raw)}\n\nالرابط يعمل مرة واحدة وتنتهي صلاحيته خلال 24 ساعة. إذا لم تنشئ حسابًا على موعد، تجاهل هذه الرسالة.`
            ),
        };
    }
    if (purpose === "PASSWORD_RESET") {
        return {
            subject: pick(locale, "Reset your Mawid password", "إعادة تعيين كلمة مرور موعد"),
            text: pick(
                locale,
                `Hello ${name},\n\nChoose a new password:\n${link("/reset-password", raw)}\n\nThe link works once and expires in 60 minutes. Resetting signs you out everywhere. If you didn't ask for this, ignore this email; your password stays the same.`,
                `مرحبًا ${name}،\n\nاختر كلمة مرور جديدة:\n${link("/reset-password", raw)}\n\nالرابط يعمل مرة واحدة وتنتهي صلاحيته خلال 60 دقيقة. إعادة التعيين تسجّل خروجك من كل الأجهزة. إذا لم تطلب ذلك، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.`
            ),
        };
    }
    if (purpose === "ACCOUNT_NOTICE") {
        return {
            subject: pick(locale, "You already have a Mawid account", "لديك حساب على موعد بالفعل"),
            text: pick(
                locale,
                `Hello ${name},\n\nSomeone tried to sign up to Mawid with this email address, which already has an account. Nothing was changed.\n\nLog in: ${link("/login")}\nForgot your password? ${link("/forgot-password")}`,
                `مرحبًا ${name}،\n\nحاول أحدهم إنشاء حساب على موعد بهذا البريد الإلكتروني، وهو مسجّل بالفعل. لم يتغيّر أي شيء.\n\nتسجيل الدخول: ${link("/login")}\nنسيت كلمة المرور؟ ${link("/forgot-password")}`
            ),
        };
    }
    throw new Error(`Unknown account email purpose: ${purpose}`);
}

function buildInvitationEmail({ kind, locale, clinicName, role, raw }) {
    const [roleEn, roleAr] = roleNames[role] || [role, role];
    const url = link("/invitations/accept", raw);
    if (kind === "RECONFIRM") {
        return {
            subject: pick(locale, `Confirm your access to ${clinicName}`, `أكّد وصولك إلى ${clinicName}`),
            text: pick(
                locale,
                `Hello,\n\n${clinicName} asks you to confirm your existing ${roleEn} access on Mawid. Until you confirm, the clinic workspace stays closed for your account.\n\nReview and confirm: ${url}\n\nThe link expires in 7 days. If you don't recognise this clinic, decline or ignore this email.`,
                `مرحبًا،\n\nتطلب ${clinicName} منك تأكيد صلاحيتك الحالية (${roleAr}) على موعد. حتى تؤكّد، تبقى مساحة عمل العيادة مغلقة لحسابك.\n\nراجِع وأكّد: ${url}\n\nتنتهي صلاحية الرابط خلال 7 أيام. إذا لم تتعرّف على هذه العيادة، ارفض الطلب أو تجاهل الرسالة.`
            ),
        };
    }
    return {
        subject: pick(locale, `You're invited to join ${clinicName} on Mawid`, `دعوة للانضمام إلى ${clinicName} على موعد`),
        text: pick(
            locale,
            `Hello,\n\n${clinicName} invited you to join its team on Mawid as ${roleEn}.\n\nReview the invitation: ${url}\n\nYou'll need to log in (or sign up) with this email address and confirm it. The link expires in 7 days. If you weren't expecting this, ignore this email.`,
            `مرحبًا،\n\nدعتك ${clinicName} للانضمام إلى فريقها على موعد بدور ${roleAr}.\n\nراجِع الدعوة: ${url}\n\nستحتاج إلى تسجيل الدخول (أو إنشاء حساب) بهذا البريد الإلكتروني وتأكيده. تنتهي صلاحية الرابط خلال 7 أيام. إذا لم تكن تتوقع هذه الدعوة، تجاهل الرسالة.`
        ),
    };
}

module.exports = { buildAuthEmail, buildInvitationEmail };
