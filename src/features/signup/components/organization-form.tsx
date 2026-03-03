"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "firebase/auth";
import { FirebaseError } from "firebase/app";

import { auth } from "@/lib/firebase";
import { signupJoinOrg, signupCreateOrgAndUser, getOrganizationByDomain, getOrganizationByInviteCode } from "@/lib/db";
import { extractDomain, isPersonalEmail, formatDomainForDisplay } from "@/lib/domain-utils";
import { normalizeInviteCode } from "@/lib/invite-utils";
import { useSignupStore } from "@/features/signup/store";
import { organizationSchema, type OrganizationValues } from "@/features/signup/schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, ArrowLeft, Loader2 } from "lucide-react";

export function OrganizationForm() {
    const router = useRouter();
    const store = useSignupStore();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [existingOrg, setExistingOrg] = useState<{ id: string; name: string } | null>(null);
    const [codeValidating, setCodeValidating] = useState(false);
    const [codeError, setCodeError] = useState<string | null>(null);
    const [foundOrg, setFoundOrg] = useState<{ id: string; name: string } | null>(null);

    const email = store.email ?? "";
    const domain = extractDomain(email);
    const isPersonal = isPersonalEmail(email);

    // Guard: redirect to step 1 if no email
    useEffect(() => {
        if (!email) router.push("/signup/credentials");
    }, [email, router]);

    // Check for existing org by email domain on mount
    useEffect(() => {
        if (!domain || isPersonal) return;
        getOrganizationByDomain(domain).then((found) => {
            if (found) setExistingOrg({ id: found.id, name: found.name });
        });
    }, [domain, isPersonal]);

    const form = useForm<OrganizationValues>({
        resolver: zodResolver(organizationSchema),
        defaultValues: {
            action: store.prefilledCode ? "join" : "create",
            organizationName: domain && !isPersonal ? formatDomainForDisplay(domain) : "",
            inviteCode: store.prefilledCode ?? "",
            existingOrgId: "",
        },
    });

    const action = form.watch("action");
    const inviteCodeValue = form.watch("inviteCode");
    const organizationName = form.watch("organizationName");

    // Validate invite code with debounce
    useEffect(() => {
        if (action !== "join" || !inviteCodeValue || inviteCodeValue.length < 6) {
            setFoundOrg(null);
            setCodeError(null);
            return;
        }
        setCodeValidating(true);
        const timeout = setTimeout(async () => {
            try {
                const found = await getOrganizationByInviteCode(normalizeInviteCode(inviteCodeValue));
                setFoundOrg(found ? { id: found.id, name: found.name } : null);
                setCodeError(found ? null : "Invalid invite code");
            } catch {
                setCodeError("Error validating code");
                setFoundOrg(null);
            } finally {
                setCodeValidating(false);
            }
        }, 500);
        return () => clearTimeout(timeout);
    }, [action, inviteCodeValue]);

    const canSubmit = () => {
        if (loading) return false;
        if (action === "create") return (organizationName ?? "").length >= 2;
        if (action === "join") return foundOrg !== null;
        if (action === "auto-join") return existingOrg !== null;
        return false;
    };

    const onSubmit = async (data: OrganizationValues) => {
        setLoading(true);
        setError(null);
        try {
            let firebaseUser = auth.currentUser;

            if (store.authMethod === "email") {
                const cred = await createUserWithEmailAndPassword(auth, email, store.password!);
                firebaseUser = cred.user;
                if (store.name) await updateProfile(firebaseUser, { displayName: store.name });
                await sendEmailVerification(firebaseUser);
            }

            if (!firebaseUser) throw new Error("No authenticated user");
            const displayName = store.name ?? firebaseUser.displayName ?? "";

            if (data.action === "join" && foundOrg) {
                await signupJoinOrg(firebaseUser, displayName, foundOrg.id, "invite_code");
                store.setData({ action: "join", organizationName: foundOrg.name });
            } else if (data.action === "auto-join" && existingOrg) {
                await signupJoinOrg(firebaseUser, displayName, existingOrg.id, "domain_auto_join");
                store.setData({ action: "auto-join", organizationName: existingOrg.name });
            } else {
                await signupCreateOrgAndUser(firebaseUser, displayName, data.organizationName!, domain, isPersonal);
                store.setData({ action: "create", organizationName: data.organizationName! });
            }

            router.push("/signup/complete");
        } catch (err) {
            if (err instanceof FirebaseError) {
                if (err.code === "auth/email-already-in-use") {
                    setError("This email is already registered. Please log in instead.");
                } else {
                    setError(`Could not complete signup: ${err.code}`);
                }
            } else {
                setError("An unexpected error occurred. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle>Set up your organization</CardTitle>
                <CardDescription>Choose how you want to organize your team.</CardDescription>
            </CardHeader>
            <CardContent>
                {error && (
                    <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md">{error}</div>
                )}

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">

                        {/* Auto-join banner */}
                        {existingOrg && (
                            <div className="rounded-lg border p-4 bg-blue-50/50">
                                <div className="flex items-start gap-3">
                                    <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
                                    <div className="flex-1">
                                        <p className="font-medium">Join {existingOrg.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            Your email domain matches this organization.
                                        </p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="mt-2"
                                            disabled={loading}
                                            onClick={() => {
                                                form.setValue("action", "auto-join");
                                                form.handleSubmit(onSubmit)();
                                            }}
                                        >
                                            Join {existingOrg.name}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Action radio */}
                        <FormField control={form.control} name="action" render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="space-y-3">
                                        <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50">
                                            <RadioGroupItem value="create" id="create" />
                                            <div>
                                                <Label htmlFor="create" className="cursor-pointer font-medium">
                                                    Create a new {isPersonal ? "workspace" : "organization"}
                                                </Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {isPersonal
                                                        ? "Start your own workspace."
                                                        : `Create an organization for ${domain}.`}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50">
                                            <RadioGroupItem value="join" id="join" />
                                            <div>
                                                <Label htmlFor="join" className="cursor-pointer font-medium">
                                                    Join with an invite code
                                                </Label>
                                                <p className="text-sm text-muted-foreground">
                                                    Enter a code to join an existing organization.
                                                </p>
                                            </div>
                                        </div>
                                    </RadioGroup>
                                </FormControl>
                            </FormItem>
                        )} />

                        {/* Org name */}
                        {action === "create" && (
                            <FormField control={form.control} name="organizationName" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{isPersonal ? "Workspace" : "Organization"} name</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder={isPersonal ? "My Workspace" : "Acme Inc"}
                                            {...field}
                                            disabled={loading}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        )}

                        {/* Invite code */}
                        {action === "join" && (
                            <FormField control={form.control} name="inviteCode" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Invite code</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                placeholder="ABCD-1234"
                                                {...field}
                                                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                                className="uppercase"
                                                disabled={loading}
                                            />
                                            {codeValidating && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                </div>
                                            )}
                                        </div>
                                    </FormControl>
                                    {codeError && <p className="text-sm text-destructive">{codeError}</p>}
                                    {foundOrg && (
                                        <div className="rounded-md bg-green-50 p-3 flex items-center gap-2">
                                            <Users className="h-4 w-4 text-green-600" />
                                            <span className="text-sm font-medium text-green-800">
                                                Join {foundOrg.name}
                                            </span>
                                        </div>
                                    )}
                                    <FormMessage />
                                </FormItem>
                            )} />
                        )}

                        <div className="flex gap-3 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => router.push("/signup/credentials")}
                                disabled={loading}
                            >
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back
                            </Button>
                            <Button type="submit" className="flex-1" disabled={!canSubmit()}>
                                {loading
                                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Please wait...</>
                                    : "Continue"
                                }
                            </Button>
                        </div>

                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
