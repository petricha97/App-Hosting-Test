import { nanoid } from "nanoid";

const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
    }
    return code;
}

export function generateInviteToken(): string {
    return nanoid(32);
}

export function generateVerificationToken(): string {
    return nanoid(64);
}

export function isValidInviteCode(code: string): boolean {
    if (!code) return false;
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return cleaned.length >= 6 && cleaned.length <= 8;
}

export function normalizeInviteCode(code: string): string {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatInviteCode(code: string): string {
    const normalized = normalizeInviteCode(code);
    if (normalized.length <= 4) return normalized;
    return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function generateInviteLink(token: string, baseUrl?: string): string {
    const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}/join/${token}`;
}

export function extractTokenFromLink(link: string): string | null {
    try {
        const url = new URL(link);
        const pathParts = url.pathname.split("/");
        const joinIndex = pathParts.indexOf("join");
        if (joinIndex !== -1 && pathParts[joinIndex + 1]) {
            return pathParts[joinIndex + 1];
        }
        return null;
    } catch {
        if (link.length === 32 && /^[a-zA-Z0-9_-]+$/.test(link)) {
            return link;
        }
        return null;
    }
}

export function getExpiryDate(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
}

export function isExpired(expiryDate: Date | { toDate: () => Date } | null | undefined): boolean {
    if (!expiryDate) return false;
    const date = "toDate" in expiryDate ? expiryDate.toDate() : expiryDate;
    return date < new Date();
}
