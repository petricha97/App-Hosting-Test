"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Building2, Users, ArrowRight, Clock } from "lucide-react";

export interface CompleteStepProps {
    onComplete: () => void;
    organizationName: string;
    organizationType: "organization" | "workspace";
    requiresDomainVerification: boolean;
    isJoining: boolean;
}

export function CompleteStep({
    onComplete,
    organizationName,
    organizationType,
    requiresDomainVerification,
    isJoining,
}: CompleteStepProps) {
    const Icon = organizationType === "organization" ? Building2 : Users;

    return (
        <div className="space-y-6 text-center">
            <div className="flex justify-center">
                <div className="rounded-full bg-green-100 p-3">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
            </div>

            <div>
                <h3 className="text-lg font-semibold">
                    {isJoining ? "You've joined" : "You've created"}{" "}
                    {organizationName || "your organization"}!
                </h3>
                <p className="text-muted-foreground mt-1">
                    {isJoining
                        ? "You're now a member of this organization."
                        : `Your ${organizationType} has been set up successfully.`}
                </p>
            </div>

            <div className="rounded-lg border p-4">
                <div className="flex items-center justify-center gap-3">
                    <div className="rounded-full bg-muted p-2">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                        <p className="font-medium">{organizationName}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary">
                                {organizationType === "organization" ? "Organization" : "Workspace"}
                            </Badge>
                            {!isJoining && (
                                <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
                                    <Clock className="mr-1 h-3 w-3" />
                                    {requiresDomainVerification ? "Pending verification" : "Under review"}
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {!isJoining && (
                <div className="text-left rounded-lg border p-4 bg-muted/50">
                    <p className="text-sm font-medium mb-2">Next steps:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                        {requiresDomainVerification && (
                            <li>• Complete domain verification from settings</li>
                        )}
                        <li>• Invite team members to your {organizationType}</li>
                        <li>• Explore the dashboard</li>
                    </ul>
                </div>
            )}

            <Button className="w-full" onClick={onComplete}>
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
        </div>
    );
}
