// Client-safe check-in settings metadata (M5-T4, design §3). The persisted
// shape lives in src/lib/db/adminCheckinConfig.ts (server-only); this module
// mirrors ONLY the toggle keys + display copy so client components never
// import the DAL. Order matches the prototype (defaults Off/Off/On/On/On).

export interface CheckinSettings {
  signatureCollection: boolean;
  photoCapture: boolean;
  photoIdVerification: boolean;
  selfPrintBadges: boolean;
  walletPasses: boolean;
}

export type CheckinSettingKey = keyof CheckinSettings;

export interface CheckinSettingRow {
  key: CheckinSettingKey;
  label: string;
  description: string;
}

export const CHECKIN_SETTING_ROWS: readonly CheckinSettingRow[] = [
  {
    key: "signatureCollection",
    label: "Signature collection",
    description: "Capture a signature at the desk during check-in.",
  },
  {
    key: "photoCapture",
    label: "Photo capture",
    description: "Take an arrival photo of each attendee at the door.",
  },
  {
    key: "photoIdVerification",
    label: "Photo ID verification",
    description: "Staff match a government ID before issuing a badge.",
  },
  {
    key: "selfPrintBadges",
    label: "Self-print badges",
    description: "Let attendees print their own badge at a kiosk.",
  },
  {
    key: "walletPasses",
    label: "Wallet passes",
    description:
      "Stores the preference now — Apple/Google passes ship in a later milestone.",
  },
] as const;
