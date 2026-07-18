"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function EventOverviewRetry({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className={className}
      onClick={() => router.refresh()}
    >
      Retry
    </Button>
  );
}
