import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRecaptcha } from "../_shared/recaptcha.ts";
import {
  fillMembershipPdfForm,
  MEMBERSHIP_FEES,
  MEMBERSHIP_TYPES,
  type MembershipApplication,
  type MembershipType,
  PDF_FORM_URL,
} from "./pdf.ts";

/**
 * What the site sent before the youth membership existed: two checkboxes instead of one
 * type. Still accepted so a page loaded before the release can submit; drop it once that
 * release has been out for a while.
 */
interface LegacyMembershipFlags {
  membership_active?: boolean;
  membership_support?: boolean;
}

const TYPE_LABELS: Record<MembershipType, string> = {
  adult: "Erwachsene (ab 16)",
  youth: "Jugend (unter 16)",
  support: "Fördermitglied",
};

interface EmailData {
  application: MembershipApplication & LegacyMembershipFlags;
}

serve(async (req) => {
  // Per request: the allowed origin is echoed back only for known origins.
  const corsHeaders = getCorsHeaders(req);

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const { application } = await req.json() as EmailData;
    application.membership_type ??= application.membership_support ? "support" : "adult";
    if (!MEMBERSHIP_TYPES.includes(application.membership_type)) {
      return new Response(
        JSON.stringify({ error: "Invalid membership type" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!application.recaptchaToken) {
      return new Response(
        JSON.stringify({ error: "Missing reCAPTCHA token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const isValid = await verifyRecaptcha(application.recaptchaToken);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid reCAPTCHA token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const NOTIFICATION_EMAILS = Deno.env.get("NOTIFICATION_EMAILS");
    if (!RESEND_API_KEY || !NOTIFICATION_EMAILS) {
      throw new Error("Missing required environment variables");
    }
    const notificationEmails = NOTIFICATION_EMAILS.split(",").map((email) =>
      email.trim()
    );

    // === Download the blank PDF form ===
    const formPdfRes = await fetch(PDF_FORM_URL);
    if (!formPdfRes.ok) throw new Error("Failed to fetch PDF form template");
    const formPdfBytes = new Uint8Array(await formPdfRes.arrayBuffer());

    // === Fill PDF form fields using pdf-lib ===
    const filledPdfBytes = await fillMembershipPdfForm(
      formPdfBytes,
      application,
    ).catch((err) => {
      console.error("Error filling PDF form:", err);
      throw err; // re-throw to catch above
    });

    // Convert Uint8Array to base64 in chunks to avoid call stack size exceeded
    const chunks = [];
    const chunkSize = 0x8000; // 32K chunks
    for (let i = 0; i < filledPdfBytes.length; i += chunkSize) {
      const chunk = filledPdfBytes.subarray(i, i + chunkSize);
      chunks.push(String.fromCharCode(...Array.from(chunk)));
    }
    const base64Pdf = btoa(chunks.join(''));

    // Everything typed into the form goes into the mail's HTML, so it is escaped first.
    const e = Object.fromEntries(
      Object.entries(application).map(([key, value]) => [key, escapeHtml(String(value ?? ""))]),
    ) as Record<keyof MembershipApplication, string>;

    // === Send the email with the filled PDF as attachment ===
    const emailPromises = notificationEmails.map(async (to) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "info@nuernberg-renegades.de",
          to,
          subject:
            `New Membership Application - ${application.name} ${application.firstname}`,
          html: `
            <h2>New Membership Application</h2>
            <p><strong>Membership Type:</strong> ${TYPE_LABELS[application.membership_type]} (${MEMBERSHIP_FEES[application.membership_type]} € / Monat)</p>
            <p><strong>Name:</strong> ${e.name} ${e.firstname}</p>
            <p><strong>Birth Date:</strong> ${e.birthday}</p>
            <p><strong>Birth Place:</strong> ${e.birthplace}</p>
            <p><strong>Profession:</strong> ${e.profession}</p>
            <p><strong>Nationality:</strong> ${e.nationality}</p>
            <p><strong>Address:</strong> ${e.street}, ${e.plz_town}</p>
            <p><strong>Contact:</strong><br>
               Tel: ${e.tel}<br>
               Fax: ${e.fax}<br>
               Mobile: ${e.mobile}<br>
               Email: ${e.email}</p>
            <p><strong>Join Date:</strong> ${e.joindate_month}/${e.joindate_year}</p>
            <p><strong>SEPA Information:</strong><br>
               Account Holder: ${e.sepa_account_holder_firstname} ${e.sepa_account_holder_name}<br>
               IBAN: ${e.sepa_iban}<br>
               BIC: ${e.sepa_bic}<br>
               Bank: ${e.sepa_bank}</p>
            <hr>
            <p>PDF is attached.</p>
          `,
          attachments: [
            {
              filename:
                `membership-application-${application.name}-${application.firstname}.pdf`,
              content: base64Pdf,
              content_type: "application/pdf",
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(`Failed to send email to ${to}: ${data.message}`);
      }
      return data;
    });

    await Promise.all(emailPromises);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in membership function:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
