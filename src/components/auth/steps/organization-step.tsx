"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
    FormDescription,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, ArrowLeft, Loader2 } from "lucide-react";

import type { OrganizationDoc } from "@/types/collection";
import { normalizeInviteCode } from "@/lib/invite-utils";
import { formatDomainForDisplay } from "@/lib/domain-utils";

export interface OrganizationData {
    action: "create" | "join" | "auto-join";
    organizationName?: string;
    organizationType?: "organization" | "workspace";
    inviteCode?: string;
    existingOrgId?: string;
}

export interface OrganizationStepProps {
    onComplete: (data: OrganizationData) => void;
    onBack: () => void;
    loading?: boolean;
    email: string;
    emailDomain: string | null;
    isPersonalEmail: boolean;
    existingOrgForDomain: { org: OrganizationDoc; id: string } | null;
    inviteCode?: string;
}

const formSchema = z.object({
    action: z.enum(["create", "join", "auto-join"]),
    organizationName: z.string().min(2).max(100).optional(),
    inviteCode: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function OrganizationStep({
    onComplete,
    onBack,
    loading = false,
    email,
    emailDomain,
    isPersonalEmail,
    existingOrgForDomain,
    inviteCode: prefilledInviteCode,
}: OrganizationStepProps) {
    const [codeValidating, setCodeValidating] = useState(false);
    const [codeError, setCodeError] = useState<string | null>(null);
    const [foundOrg, setFoundOrg] = useState<{ org: OrganizationDoc; id: string } | null>(null);

    const defaultOrgName = emailDomain && !isPersonalEmail
        ? formatDomainForDisplay(emailDomain)
        : "";

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        mode: "onChange",
        defaultValues: {
            action: existingOrgForDomain ? "auto-join" : "create",
            organizationName: defaultOrgName,
            inviteCode: prefilledInviteCode || "",
        },
    });

    const { control, handleSubmit, watch, setValue } = form;
    const { isSubmitting } = form.formState;
    const action = watch("action");
    const inviteCodeValue = watch("inviteCode");

    useEffect(() => {
        const validateCode = async () => {
            if (action !== "join" || !inviteCodeValue || inviteCodeValue.length < 6) {
                setFoundOrg(null);
                setCodeError(null);
                return;
            }

            setCodeValidating(true);
            setCodeError(null);

            try {
                const normalized = normalizeInviteCode(inviteCodeValue);
                const orgQuery = query(
                    collection(db, "Organization"),
                    where("inviteCode", "==", normalized),
                    where("inviteCodeEnabled", "==", true)
                );
                const orgSnap = await getDocs(orgQuery);

                if (orgSnap.empty) {
                    setCodeError("Invalid invite code");
                    setFoundOrg(null);
                } else {
                    setFoundOrg({
                        org: orgSnap.docs[0].data() as OrganizationDoc,
                        id: orgSnap.docs[0].id,
                    });
                }
            } catch {
                setCodeError("Error validating code");
                setFoundOrg(null);
            } finally {
                setCodeValidating(false);
            }
        };

        const timeout = setTimeout(validateCode, 500);
        return () => clearTimeout(timeout);
    }, [action, inviteCodeValue]);

    const onSubmit: SubmitHandler<FormValues> = async (values) => {
        const data: OrganizationData = { action: values.action };

        if (values.action === "create") {
            data.organizationName = values.organizationName;
            data.organizationType = isPersonalEmail ? "workspace" : "organization";
        } else if (values.action === "join" && foundOrg) {
            data.existingOrgId = foundOrg.id;
            data.inviteCode = values.inviteCode;
        } else if (values.action === "auto-join" && existingOrgForDomain) {
            data.existingOrgId = existingOrgForDomain.id;
        }

        onComplete(data);
    };

    const canSubmit = () => {
        if (loading || isSubmitting) return false;
        if (action === "create") {
            const orgName = form.getValues("organizationName");
            return orgName && orgName.length >= 2;
        }
        if (action === "join") return foundOrg !== null;
        if (action === "auto-join") return existingOrgForDomain !== null;
        return false;
    };

    return (
        <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
                {existingOrgForDomain && (
                    <div className="rounded-lg border p-4 bg-blue-50/50">
                        <div className="flex items-start gap-3">
                            <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
                            <div className="flex-1">
                                <p className="font-medium">Join {existingOrgForDomain.org.name}</p>
                                <p className="text-sm text-muted-foreground">
                                    Your email domain matches this organization. You can join automatically.
                                </p>
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    className="mt-2"
                                    onClick={() => {
                                        setValue("action", "auto-join");
                                        onComplete({
                                            action: "auto-join",
                                            existingOrgId: existingOrgForDomain.id,
                                        });
                                    }}
                                    disabled={loading}
                                >
                                    Join {existingOrgForDomain.org.name}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <FormField
                    control={control}
                    name="action"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <RadioGroup
                                    onValueChange={field.onChange}
                                    defaultValue={field.value}
                                    className="space-y-3"
                                >
                                    <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50">
                                        <RadioGroupItem value="create" id="create" />
                                        <div className="flex-1">
                                            <Label htmlFor="create" className="cursor-pointer font-medium">
                                                Create a new {isPersonalEmail ? "workspace" : "organization"}
                                            </Label>
                                            <p className="text-sm text-muted-foreground">
                                                {isPersonalEmail
                                                    ? "Start your own workspace with a personal email."
                                                    : `Create an organization for ${emailDomain}.`}
                                            </p>
                                            {isPersonalEmail && (
                                                <Badge variant="secondary" className="mt-2">
                                                    Pending verification
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50">
                                        <RadioGroupItem value="join" id="join" />
                                        <div className="flex-1">
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
                    )}
                />

                {action === "create" && (
                    <FormField
                        control={control}
                        name="organizationName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {isPersonalEmail ? "Workspace" : "Organization"} name
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        placeholder={isPersonalEmail ? "My Workspace" : "Acme Inc"}
                                        {...field}
                                        disabled={isSubmitting || loading}
                                    />
                                </FormControl>
                                <FormDescription>
                                    {isPersonalEmail
                                        ? "Choose a name for your personal workspace."
                                        : "This will be your organization's display name."}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}

                {action === "join" && (
                    <FormField
                        control={control}
                        name="inviteCode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Invite code</FormLabel>
                                <FormControl>
                                    <div className="relative">
                                        <Input
                                            placeholder="ABCD-1234"
                                            {...field}
                                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                            disabled={isSubmitting || loading}
                                            className="uppercase"
                                        />
                                        {codeValidating && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                            </div>
                                        )}
                                    </div>
                                </FormControl>
                                {codeError && (
                                    <p className="text-sm text-red-600">{codeError}</p>
                                )}
                                {foundOrg && (
                                    <div className="rounded-md bg-green-50 p-3 mt-2">
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-green-600" />
                                            <span className="text-sm font-medium text-green-800">
                                                Join {foundOrg.org.name}
                                            </span>
                                        </div>
                                    </div>
                                )}
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}

                <div className="flex gap-3 pt-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onBack}
                        disabled={isSubmitting || loading}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button type="submit" className="flex-1" disabled={!canSubmit()}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Please wait...
                            </>
                        ) : "Continue"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
