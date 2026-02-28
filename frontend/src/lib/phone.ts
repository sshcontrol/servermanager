/** Common country calling codes (E.164). Used for phone input with country code. */
export const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: "+1", label: "US/Canada +1" },
  { code: "+44", label: "UK +44" },
  { code: "+91", label: "India +91" },
  { code: "+49", label: "Germany +49" },
  { code: "+33", label: "France +33" },
  { code: "+81", label: "Japan +81" },
  { code: "+86", label: "China +86" },
  { code: "+61", label: "Australia +61" },
  { code: "+971", label: "UAE +971" },
  { code: "+966", label: "Saudi Arabia +966" },
  { code: "+31", label: "Netherlands +31" },
  { code: "+32", label: "Belgium +32" },
  { code: "+41", label: "Switzerland +41" },
  { code: "+43", label: "Austria +43" },
  { code: "+39", label: "Italy +39" },
  { code: "+34", label: "Spain +34" },
  { code: "+46", label: "Sweden +46" },
  { code: "+47", label: "Norway +47" },
  { code: "+48", label: "Poland +48" },
  { code: "+7", label: "Russia/Kazakhstan +7" },
  { code: "+55", label: "Brazil +55" },
  { code: "+52", label: "Mexico +52" },
  { code: "+54", label: "Argentina +54" },
  { code: "+27", label: "South Africa +27" },
  { code: "+234", label: "Nigeria +234" },
  { code: "+254", label: "Kenya +254" },
  { code: "+20", label: "Egypt +20" },
  { code: "+90", label: "Turkey +90" },
  { code: "+82", label: "South Korea +82" },
  { code: "+65", label: "Singapore +65" },
  { code: "+60", label: "Malaysia +60" },
  { code: "+63", label: "Philippines +63" },
  { code: "+62", label: "Indonesia +62" },
  { code: "+84", label: "Vietnam +84" },
  { code: "+66", label: "Thailand +66" },
  { code: "+353", label: "Ireland +353" },
  { code: "+358", label: "Finland +358" },
  { code: "+45", label: "Denmark +45" },
  { code: "+420", label: "Czech Republic +420" },
  { code: "+30", label: "Greece +30" },
  { code: "+351", label: "Portugal +351" },
  { code: "+31", label: "Netherlands +31" },
  { code: "+64", label: "New Zealand +64" },
  { code: "+972", label: "Israel +972" },
  { code: "+98", label: "Iran +98" },
  { code: "+92", label: "Pakistan +92" },
  { code: "+880", label: "Bangladesh +880" },
  { code: "+94", label: "Sri Lanka +94" },
].filter((v, i, a) => a.findIndex((x) => x.code === v.code) === i);

/** Build E.164 phone from country code and national number (digits only). */
export function toE164(countryCode: string, nationalNumber: string): string {
  const digits = (countryCode.replace(/\D/g, "") + nationalNumber.replace(/\D/g, "")).replace(/^0+/, "");
  return digits ? `+${digits}` : "";
}

/** Parse E.164 phone into country code and national number (best effort). */
export function fromE164(phone: string | null | undefined): { countryCode: string; nationalNumber: string } {
  if (!phone || !phone.startsWith("+")) return { countryCode: "+1", nationalNumber: "" };
  const digits = phone.slice(1).replace(/\D/g, "");
  for (let len = 4; len >= 1; len--) {
    const code = "+" + digits.slice(0, len);
    if (COUNTRY_CODES.some((c) => c.code === code)) {
      return { countryCode: code, nationalNumber: digits.slice(len) };
    }
  }
  return { countryCode: "+" + digits.slice(0, 1), nationalNumber: digits.slice(1) };
}

/** Validate E.164: + followed by 9–15 digits. */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{8,14}$/.test(phone.replace(/\s/g, ""));
}

/** Normalize user input to E.164. Accepts "+32123456789" or "32123456789". */
export function normalizeToE164(input: string): string {
  const digits = input.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `+${digits}` : "";
}
