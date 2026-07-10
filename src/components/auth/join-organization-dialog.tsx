"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { auth } from "@/lib/firebase";
// Joining is SERVER-SIDE (SEC M2): the invite code is validated and the
// membership written by /api/organizations/* — the client never reads invite
// secrets or writes roster/permissions/memberCount (firestore.rules denies it).
import {
    joinOrganization,
    lookupOrganizationByInviteCode,
} from "@/lib/org-join-client";
import type { OrganizationPreview } from "@/lib/org-preview";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
} from "@/components/ui/form";
import { Loader2, Building2, Users, CheckCircle2 } from "lucide-react";

import { joinByCodeSchema, type JoinByCodeValues } from "@/lib/validation";
import { normalizeInviteCode } from "@/lib/invite-utils";

interface JoinOrganizationDialogProps {
    children?: React.ReactNode;
    onSuccess?: () => void;
}

type DialogState = "input" | "preview" | "joining" | "success";

export function JoinOrganizationDialog({ children, onSuccess }: JoinOrganizationDialogProps) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<DialogState>("input");
    const [error, setError] = useState<string | null>(null);
    const [foundOrg, setFoundOrg] = useState<OrganizationPreview | null>(null);
    const [validating, setValidating] = useState(false);

    const form = useForm<JoinByCodeValues>({
        resolver: zodResolver(joinByCodeSchema),
        mode: "onChange",
        defaultValues: { code: "" },
    });

    const { control, handleSubmit, watch, reset } = form;
    const { isSubmitting } = form.formState;
    const codeValue = watch("code");

    useEffect(() => {
        if (!open) {
            setState("input");
            setError(null);
            setFoundOrg(null);
            reset();
        }
    }, [open, reset]);

    useEffect(() => {
        const validateCode = async () => {
            if (!codeValue || codeValue.length < 6) {
                setFoundOrg(null);
                setError(null);
                return;
            }

            setValidating(true);
            setError(null);

            try {
                const found = await lookupOrganizationByInviteCode(
                    normalizeInviteCode(codeValue),
                );
                setFoundOrg(found);
                if (!found) setError("Invalid invite code");
            } catch {
                setError("Error validating code");
                setFoundOrg(null);
            } finally {
                setValidating(false);
            }
        };

        const timeout = setTimeout(validateCode, 500);
        return () => clearTimeout(timeout);
    }, [codeValue]);

    const onSubmit: SubmitHandler<JoinByCodeValues> = async () => {
        if (!foundOrg) return;

        const user = auth.currentUser;
        if (!user || !user.email) {
            router.push(`/signup?code=${normalizeInviteCode(codeValue)}`);
            setOpen(false);
            return;
        }

        setState("joining");
        setError(null);

        try {
            const idToken = await user.getIdToken();
            const result = await joinOrganization(idToken, {
                joinMethod: "invite_code",
                code: normalizeInviteCode(codeValue),
                displayName: user.displayName ?? undefined,
            });

            if (result.status === "already-member") {
                setError("You're already a member of this organization");
                setState("input");
                return;
            }

            setState("success");
            onSuccess?.();
        } catch {
            setError("Failed to join organization. Please try again.");
            setState("input");
        }
    };

    const Icon = foundOrg?.type === "organization" ? Building2 : Users;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children || (
                    <Button variant="link" className="p-0 h-auto">
                        Have an invite code?
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                {state === "success" ? (
                    <>
                        <DialogHeader className="text-center">
                            <div className="flex justify-center mb-4">
                                <div className="rounded-full bg-green-100 p-3">
                                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                                </div>
                            </div>
                            <DialogTitle>Welcome!</DialogTitle>
                            <DialogDescription>
                                You&apos;ve successfully joined {foundOrg?.name}.
                            </DialogDescription>
                        </DialogHeader>
                        <Button
                            className="w-full"
                            onClick={() => {
                                setOpen(false);
                                router.push("/dashboard");
                            }}
                        >
                            Go to Dashboard
                        </Button>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>Join with invite code</DialogTitle>
                            <DialogDescription>
                                Enter the invite code you received to join an organization.
                            </DialogDescription>
                        </DialogHeader>

                        <Form {...form}>
                            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                                {error && (
                                    <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md">
                                        {error}
                                    </div>
                                )}

                                <FormField
                                    control={control}
                                    name="code"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Invite code</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Input
                                                        placeholder="ABCD-1234"
                                                        {...field}
                                                        onChange={(e) => {
                                                            field.onChange(e.target.value.toUpperCase());
                                                        }}
                                                        disabled={isSubmitting || state === "joining"}
                                                        className="uppercase"
                                                    />
                                                    {validating && (
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {foundOrg && (
                                    <div className="rounded-lg border p-4 bg-muted/50">
                                        <div className="flex items-center gap-3">
                                            <div className="rounded-full bg-background p-2">
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-medium">{foundOrg.name}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <Badge variant="secondary">
                                                        {foundOrg.type === "organization" ? "Organization" : "Workspace"}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {foundOrg.memberCount} member{foundOrg.memberCount !== 1 ? "s" : ""}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={!foundOrg || isSubmitting || state === "joining"}
                                >
                                    {state === "joining" ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Joining...
                                        </>
                                    ) : foundOrg ? (
                                        `Join ${foundOrg.name}`
                                    ) : (
                                        "Enter invite code"
                                    )}
                                </Button>
                            </form>
                        </Form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
