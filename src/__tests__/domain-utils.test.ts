import {
    extractDomain,
    isValidEmail,
    getVerificationEmailOptions,
    isPersonalEmail,
    isCorporateEmail,
    suggestOrganizationType,
    formatDomainForDisplay
} from "@/lib/domain-utils"

import { describe, it, expect, test } from "vitest"


/* ---------------------------
   extractDomain
---------------------------- */

describe("extractDomain", () => {

    it("extracts domain correctly", () => {
        expect(extractDomain("user@gmail.com")).toBe("gmail.com")
    })

    it("extracts domain with subdomain", () => {
        expect(extractDomain("user@mail.company.com")).toBe("mail.company.com")
    })

    it("returns null for invalid email", () => {
        expect(extractDomain("invalid")).toBeNull()
    })

    it("returns null for empty string", () => {
        expect(extractDomain("")).toBeNull()
    })
    it("returns domain for string `a@a`", () => {
        expect(extractDomain("a@a")).toBe("a")
    })
    it("returns domain for string `a@@`", () => {
        expect(extractDomain("a@@")).toBe(null)
    })
    it("returns domain for string `a@@@`", () => {
        expect(extractDomain("a@@@")).toBe(null)
    })
    it("returns domain for string `a@ `", () => {
        expect(extractDomain("a@ ")).toBe(" ")
    })
    it("returns domain for string `test@yourdomain@gmail.com`", () => {
        expect(extractDomain("test@yourdomain@gmail.com")).toBe("gmail.com")
    })

})


/* ---------------------------
   isValidEmail
---------------------------- */

describe("isValidEmail", () => {

    test("returns true for valid email", () => {
        expect(isValidEmail("j0yYX@example.com")).toBe(true)
    })

    test("returns false for invalid email", () => {
        expect(isValidEmail("invalid-email")).toBe(false)
    })

    test("returns false for incomplete email", () => {
        expect(isValidEmail("abc@")).toBe(false)
    })

    test("returns false for double @", () => {
        expect(isValidEmail("abc@@")).toBe(false)
    })
    test("returns false for double @", () => {
        expect(isValidEmail("a@@")).toBe(false)
    })
    test("returns false for double @", () => {
        expect(isValidEmail("a@@ ")).toBe(false)
    })
    test("returns false for double @", () => {
        expect(isValidEmail("test@yourdomain@gmail.com ")).toBe(false)
    })

})


/* ---------------------------
   isPersonalEmail
---------------------------- */

describe("isPersonalEmail", () => {

    it("returns true for gmail", () => {
        expect(isPersonalEmail("user@gmail.com")).toBe(true)
    })

    it("returns true for yahoo", () => {
        expect(isPersonalEmail("user@yahoo.com")).toBe(true)
    })

    it("returns false for corporate domain", () => {
        expect(isPersonalEmail("user@company.com")).toBe(false)
    })

    it("returns true for invalid email", () => {
        expect(isPersonalEmail("invalid")).toBe(true)
    })

    it("returns false for email not in the set", () => {
        expect(isPersonalEmail("a@psa.com")).toBe(false)
    })

    it("returns false for invalid email", () => {
        expect(isPersonalEmail("a@a")).toBe(false)
    })
    it("returns true for invalid email", () => {
        expect(isPersonalEmail("a@@")).toBe(true)
    })
    it("returns true for invalid email", () => {
        expect(isPersonalEmail("a@@@")).toBe(true)
    })
    it("returns true for invalid email", () => {
        expect(isPersonalEmail("a@@@")).toBe(true)
    })
    it("returns false for invalid email", () => {
        expect(isPersonalEmail("a@ ")).toBe(false)
    })

})


/* ---------------------------
   isCorporateEmail
---------------------------- */

describe("isCorporateEmail", () => {

    it("returns true for corporate email", () => {
        expect(isCorporateEmail("user@company.com")).toBe(true)
    })

    it("returns false for gmail", () => {
        expect(isCorporateEmail("user@gmail.com")).toBe(false)
    })

})


/* ---------------------------
   suggestOrganizationType
---------------------------- */

describe("suggestOrganizationType", () => {

    it("returns workspace for personal email", () => {
        expect(suggestOrganizationType("user@gmail.com")).toBe("workspace")
    })

    it("returns organization for corporate email", () => {
        expect(suggestOrganizationType("user@company.com")).toBe("organization")
    })

})


/* ---------------------------
   formatDomainForDisplay
---------------------------- */

describe("formatDomainForDisplay", () => {

    it("capitalizes domain name", () => {
        expect(formatDomainForDisplay("google.com")).toBe("Google")
    })

    it("works with subdomains", () => {
        expect(formatDomainForDisplay("mail.company.com")).toBe("Mail")
    })

    it("returns empty string for empty domain", () => {
        expect(formatDomainForDisplay("")).toBe("")
    })

})


/* ---------------------------
   getVerificationEmailOptions
---------------------------- */

describe("getVerificationEmailOptions", () => {

    it("returns empty array if domain is empty", () => {
        expect(getVerificationEmailOptions("")).toEqual([])
    })

    it("returns admin and webmaster emails", () => {
        expect(getVerificationEmailOptions("example.com")).toEqual([
            "admin@example.com",
            "webmaster@example.com"
        ])
    })

    it("works with subdomains", () => {
        expect(getVerificationEmailOptions("sub.example.com")).toEqual([
            "admin@sub.example.com",
            "webmaster@sub.example.com"
        ])
    })

})