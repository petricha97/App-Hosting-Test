"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ArrowRight } from "lucide-react";

import { useSignupStore } from "@/features/signup/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function CompleteForm() {
    const router = useRouter();
    const { action, organizationName, reset } = useSignupStore();
    const completing = useRef(false);

    // Guard: redirect if landed here without completing a previous step
    useEffect(() => {
        if (!completing.current && !action) router.push("/signup/credentials");
    }, [action, router]);

    const isJoining = action === "join" || action === "auto-join";

    const onContinue = () => {
        completing.current = true;
        reset();
        router.push("/dashboard");
    };

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                    <div className="rounded-full bg-green-100 p-3">
                        <CheckCircle2 className="h-8 w-8 text-green-600" />
                    </div>
                </div>
                <CardTitle>Welcome!</CardTitle>
                <CardDescription>You&apos;re all set to start using the platform.</CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-6">
                <p>
                    {isJoining ? "You've joined" : "You've created"}{" "}
                    <span className="font-semibold">{organizationName || "your organization"}</span>!
                </p>
                <Button className="w-full" onClick={onContinue}>
                    Go to Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </CardContent>
        </Card>
    );
}
