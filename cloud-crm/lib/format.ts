import { loadBusinessProfile } from "@/lib/business-config";

const displayTimezone = loadBusinessProfile().operations.timezone;

export function formatDate(value?: string | Date | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: displayTimezone,
    month: "short",
    day: "numeric",
    year: options?.year ?? "numeric",
    ...options,
  }).format(new Date(value));
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: displayTimezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function phoneDisplay(phone?: string | null) {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "").replace(/^1/, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function classForStatus(status?: string | null) {
  const value = (status ?? "").toLowerCase();
  if (value.includes("meeting") || value.includes("interested") || value.includes("connected")) return "success";
  if (value.includes("dnc") || value.includes("wrong") || value.includes("failed") || value.includes("disqualified")) return "danger";
  if (value.includes("callback") || value.includes("follow") || value.includes("voicemail")) return "warning";
  if (value.includes("scheduled") || value.includes("qualified")) return "info";
  return "neutral";
}
