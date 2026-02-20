"use client";

import * as React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail, Clock, CheckCircle2, Loader2 } from "lucide-react";

export interface VerificationData {
    method?: "email" | "dns_txt";
    skipVerification?: boolean;
}

export interface VerificationStepProps {
    onComplete: (data: VerificationData) => void;
    onBack: () => void;
    onSkip: () => void;
    loading?: boolean;
    email: string;
    organizationName: string;
}

export function VerificationStep({
    onComplete,
    onBack,
    onSkip,
    loading = false,
    email,
    organizationName,
}: VerificationStepProps) {
    const [verificationSent, setVerificationSent] = useState(false);
    const [sending, setSending] = useState(false);

    const handleSendVerification = async () => {
        setSending(true);
        // Simulate sending — in production this calls a Cloud Function
        await new Promise(resolve => setTimeout(resolve, 1500));
        setVerificationSent(true);
        setSending(false);
    };

    const handleConfirmReceived = () => {
        onComplete({ method: "email" });
    };

    if (verificationSent) {
        return (
            <div className="space-y-6">
                <div className="rounded-lg border p-4 bg-blue-50/50">
                    <div className="flex items-start gap-3">
                        <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div>
                            <p className="font-medium">Verification email sent!</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                We sent a verification link to{" "}
                                <span className="font-medium">{email}</span>.
                                Click the link in the email to verify your domain.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                        <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div>
                            <p className="font-medium">Haven&apos;t received the email?</p>
                            <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                                <li>• Check your spam folder</li>
                                <li>• Make sure {email} is correct</li>
                                <li>• Wait a few minutes and try again</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="space-y-3 pt-2">
                    <Button className="w-full" onClick={handleConfirmReceived} disabled={loading}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Please wait...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                I&apos;ve verified my domain
                            </>
                        )}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={onSkip} disabled={loading}>
                        Skip for now, verify later
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-lg border p-4 bg-amber-50/50">
                <p className="text-sm">
                    To verify your domain, we&apos;ll send a verification link to{" "}
                    <span className="font-medium">{email}</span>.
                </p>
            </div>

            <div className="space-y-3 pt-2">
                <Button className="w-full" onClick={handleSendVerification} disabled={sending || loading}>
                    {sending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Mail className="mr-2 h-4 w-4" />
                            Send verification email
                        </>
                    )}
                </Button>

                <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={onBack} disabled={sending || loading}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button variant="ghost" className="flex-1" onClick={onSkip} disabled={sending || loading}>
                        Skip for now
                    </Button>
                </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
                You can verify your domain later from organization settings.
            </p>
        </div>
    );
}
