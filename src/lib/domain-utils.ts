const PERSONAL_DOMAINS = new Set([
    // Google
    "gmail.com",
    "googlemail.com",
    // Microsoft
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "hotmail.co.uk",
    "hotmail.fr",
    "outlook.co.uk",
    // Yahoo
    "yahoo.com",
    "yahoo.co.uk",
    "yahoo.fr",
    "yahoo.de",
    "yahoo.ca",
    "ymail.com",
    "rocketmail.com",
    // Apple
    "icloud.com",
    "me.com",
    "mac.com",
    // Proton
    "protonmail.com",
    "protonmail.ch",
    "proton.me",
    "pm.me",
    // AOL
    "aol.com",
    "aim.com",
    // Other common
    "zoho.com",
    "mail.com",
    "gmx.com",
    "gmx.net",
    "yandex.com",
    "yandex.ru",
    "qq.com",
    "163.com",
    "126.com",
    "sina.com",
    "tutanota.com",
    "tutanota.de",
    "fastmail.com",
    "fastmail.fm",
]);

export function isPersonalEmail(email: string): boolean {
    const domain = extractDomain(email);
    if (!domain) return true;
    return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

export function isCorporateEmail(email: string): boolean {
    return !isPersonalEmail(email);
}

export function extractDomain(email: string): string | null {
    if (!email || !email.includes("@")) return null;
    const parts = email.split("@");
    return parts[1]?.toLowerCase() || null;
}

export function suggestOrganizationType(email: string): "organization" | "workspace" {
    return isPersonalEmail(email) ? "workspace" : "organization";
}

export function formatDomainForDisplay(domain: string): string {
    if (!domain) return "";
    const parts = domain.split(".");
    const name = parts[0] || domain;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function getVerificationEmailOptions(domain: string): string[] {
    if (!domain) return [];
    return [
        `admin@${domain}`,
        `webmaster@${domain}`,
    ];
}
