export function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

export function isValidOrgName(name: string): boolean {
    if (!name) return false;
    const trimmed = name.trim();
    return trimmed.length >= 2 && trimmed.length <= 100;
}

export function isValidSlug(slug: string): boolean {
    if (!slug) return false;
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    return slugRegex.test(slug) && slug.length >= 2 && slug.length <= 100;
}

export function getOrgTypeLabel(type: "organization" | "workspace"): string {
    return type === "organization" ? "Organization" : "Workspace";
}

export function getOrgStatusLabel(status: "pending" | "verified" | "suspended"): string {
    switch (status) {
        case "pending":   return "Pending Verification";
        case "verified":  return "Verified";
        case "suspended": return "Suspended";
        default:          return status;
    }
}

export function getOrgStatusColor(status: "pending" | "verified" | "suspended"): string {
    switch (status) {
        case "pending":   return "bg-yellow-100 text-yellow-800";
        case "verified":  return "bg-green-100 text-green-800";
        case "suspended": return "bg-red-100 text-red-800";
        default:          return "bg-gray-100 text-gray-800";
    }
}

export function getRoleLabel(role: "owner" | "admin" | "member"): string {
    switch (role) {
        case "owner":  return "Owner";
        case "admin":  return "Admin";
        case "member": return "Member";
        default:       return role;
    }
}

export function isAdminRole(role: "owner" | "admin" | "member"): boolean {
    return role === "owner" || role === "admin";
}

export function isOwnerRole(role: "owner" | "admin" | "member"): boolean {
    return role === "owner";
}

export function generateOrgNameFromDomain(domain: string): string {
    if (!domain) return "";
    const parts = domain.split(".");
    const name = parts[0] || domain;
    return name
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export function sanitizeOrgName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
}
