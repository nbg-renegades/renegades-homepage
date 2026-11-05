import { getCorsHeaders } from '../_shared/cors.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyRecaptcha } from "../_shared/recaptcha.ts";
import { type TryoutRequest, tryoutEmailHtml } from "./email.ts";

interface EmailData {
  request: TryoutRequest & { recaptchaToken: string };
}

serve(async (req) => {
  // Per request: the allowed origin is echoed back only for known origins.
  const corsHeaders = getCorsHeaders(req);

  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      })
    }
    const { request } = await req.json() as EmailData;

    if (!request.recaptchaToken) {
      return new Response(
        JSON.stringify({ error: "Missing reCAPTCHA token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify reCAPTCHA token
    const isValid = await verifyRecaptcha(request.recaptchaToken);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid reCAPTCHA token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get environment variables
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const NOTIFICATION_EMAILS = Deno.env.get("NOTIFICATION_EMAILS");

    if (!RESEND_API_KEY || !NOTIFICATION_EMAILS) {
      throw new Error("Missing required environment variables");
    }

    // Parse notification emails (comma-separated list)
    const notificationEmails = NOTIFICATION_EMAILS.split(",").map((email) =>
      email.trim()
    );

    // Send email to each recipient
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
          subject: `New Tryout Request`,
          html: tryoutEmailHtml(request),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(`Failed to send email to ${to}: ${data.message}`);
      }

      return data;
    });

    // Wait for all emails to be sent
    await Promise.all(emailPromises);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});