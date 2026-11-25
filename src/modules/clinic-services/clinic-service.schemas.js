const { z } = require("zod");
const { optionalText, requiredText, includeInactiveQuery } = require("../../lib/tenant-data");

// Every supported currency uses 2 minor-unit digits.
const supportedCurrencies = ["EGP", "USD", "EUR", "SAR", "AED"];
const maxPriceMinor = 100_000_000; // 1,000,000.00

// "350", "350.5", "350.50" or 350.5 → 35050 minor units, parsed from the decimal string so
// floating-point rounding can never change a price.
const price = z
    .union([z.string().trim(), z.number().nonnegative().finite()])
    .transform((value, ctx) => {
        const text = typeof value === "number" ? String(value) : value;
        const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
        if (!match) {
            ctx.addIssue({ code: "custom", message: "Use a price like 350 or 350.50." });
            return z.NEVER;
        }
        const minor = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
        if (minor > maxPriceMinor) {
            ctx.addIssue({ code: "custom", message: "Price is too high." });
            return z.NEVER;
        }
        return minor;
    });

const durationMinutes = z.number().int().min(5).max(480);

const createServiceSchema = z.strictObject({
    nameEn: requiredText(2, 150),
    nameAr: optionalText(150),
    descriptionEn: optionalText(2000),
    descriptionAr: optionalText(2000),
    durationMinutes,
    price,
    currency: z.enum(supportedCurrencies).default("EGP"),
});

const updateServiceSchema = z
    .strictObject({
        nameEn: requiredText(2, 150).optional(),
        nameAr: optionalText(150),
        descriptionEn: optionalText(2000),
        descriptionAr: optionalText(2000),
        durationMinutes: durationMinutes.optional(),
        price: price.optional(),
        currency: z.enum(supportedCurrencies).optional(),
        isActive: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

const listServicesQuery = z.strictObject({ includeInactive: includeInactiveQuery });

// API field `price` → DB column `priceMinor`.
function toServiceData(input) {
    const { price: priceMinor, ...rest } = input;
    return priceMinor === undefined ? rest : { ...rest, priceMinor };
}

module.exports = { createServiceSchema, updateServiceSchema, listServicesQuery, toServiceData, supportedCurrencies };
