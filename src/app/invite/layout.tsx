// Top-level, non-dashboard layout (mirrors src/app/(auth)/layout.tsx exactly)
// — the invitee is not yet a member of the target org, so this route stays
// visually consistent with signup/login rather than the dashboard chrome.
export default function InviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      {children}
    </div>
  );
}
