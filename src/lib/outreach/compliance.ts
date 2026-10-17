// Deterministic outreach compliance gate. Conservative by design:
//  - AI voice calls are blocked unless the operator enabled them after legal review (env flags)
//    AND the specific contact gave documented prior express consent (TCPA / NY law), AND an admin approves.
//  - Human calls respect do-not-contact and recipient-local calling hours (8am–9pm).
//  - Recording requires the contact's consent to be captured on the call record.
//  - Negotiation / representation is routed to licensed brokers (see brokerage handoff approvals).
import { env } from "../env";

export type Channel = "email" | "phone_human" | "phone_ai_voice";
export type ContactLike = { email: string | null; phone: string | null; do_not_contact: boolean; consent_ai_voice: boolean };

export function complianceCheck(channel: Channel, c: ContactLike | null, now = new Date()) {
  const reasons: string[] = [];
  let allowed = true;
  if (!c) return { allowed: false, requiresApproval: true, reasons: ["No contact on file"] };
  if (c.do_not_contact) { allowed = false; reasons.push("Contact is marked do-not-contact"); }
  if (channel === "email" && !c.email) { allowed = false; reasons.push("No email address"); }
  if (channel !== "email" && !c.phone) { allowed = false; reasons.push("No phone number"); }
  if (channel === "phone_ai_voice") {
    if (!env.aiVoiceEnabled) { allowed = false; reasons.push("Automated AI voice calling is disabled platform-wide pending legal/compliance sign-off"); }
    if (!c.consent_ai_voice) { allowed = false; reasons.push("No documented prior express consent for automated/AI calls from this contact"); }
  }
  if (channel !== "email") {
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(now));
    if (hour < 8 || hour >= 21) reasons.push("Outside 8am–9pm recipient-local calling window — schedule for later");
    reasons.push("Ask for and record consent before recording the call");
  }
  if (channel === "email") reasons.push("Human sends from their mailbox after approval; include sender identity and opt-out line");
  return { allowed, requiresApproval: channel !== "phone_human", reasons };
}
