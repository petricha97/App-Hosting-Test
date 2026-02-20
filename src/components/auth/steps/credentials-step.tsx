"use client";

import * as React from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
} from "@/components/ui/form";
import { credentialsStepSchema, type CredentialsStepValues } from "@/lib/validation";

export interface CredentialsData {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
}

export interface CredentialsStepProps {
    onComplete: (data: CredentialsData) => void;
    onGoogleSignIn: () => void;
    loading?: boolean;
    inviteCode?: string;
}

export function CredentialsStep({
    onComplete,
    onGoogleSignIn,
    loading = false,
    inviteCode,
}: CredentialsStepProps) {
    const form = useForm<CredentialsStepValues>({
        resolver: zodResolver(credentialsStepSchema),
        mode: "onChange",
        defaultValues: {
            name: "",
            email: "",
            password: "",
            confirmPassword: "",
        },
    });

    const { control, handleSubmit } = form;
    const { isSubmitting, isValid } = form.formState;

    const onSubmit: SubmitHandler<CredentialsStepValues> = async (values) => {
        onComplete({
            name: values.name || "",
            email: values.email,
            password: values.password,
            confirmPassword: values.confirmPassword,
        });
    };

    return (
        <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <FormField
                    control={control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name (optional)</FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="Jane Doe"
                                    {...field}
                                    disabled={isSubmitting || loading}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input
                                    type="email"
                                    placeholder="you@company.com"
                                    autoComplete="email"
                                    {...field}
                                    disabled={isSubmitting || loading}
                                />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                                Use your work email to create an organization, or personal email for a workspace.
                            </p>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={control}
                    name="password"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                                <Input
                                    type="password"
                                    autoComplete="new-password"
                                    {...field}
                                    disabled={isSubmitting || loading}
                                />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                                8+ characters with a letter and number.
                            </p>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={control}
                    name="confirmPassword"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Confirm password</FormLabel>
                            <FormControl>
                                <Input
                                    type="password"
                                    autoComplete="new-password"
                                    {...field}
                                    disabled={isSubmitting || loading}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="space-y-3 pt-2">
                    <Button
                        type="submit"
                        className="w-full"
                        disabled={!isValid || isSubmitting || loading}
                    >
                        {loading ? "Please wait..." : "Continue"}
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">Or</span>
                        </div>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={onGoogleSignIn}
                        disabled={isSubmitting || loading}
                    >
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Continue with Google
                    </Button>
                </div>

                <div className="text-center text-sm pt-2">
                    Already have an account?{" "}
                    <Link href="/login" className="underline underline-offset-4">
                        Log in
                    </Link>
                </div>

                {inviteCode && (
                    <p className="text-xs text-muted-foreground text-center">
                        You&apos;ll join the organization after creating your account.
                    </p>
                )}
            </form>
        </Form>
    );
}
