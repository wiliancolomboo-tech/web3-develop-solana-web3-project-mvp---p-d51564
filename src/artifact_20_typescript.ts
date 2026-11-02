import { Resend } from "resend";
import { CONFIG } from "../config";

const resend = CONFIG.RESEND_API_KEY ? new Resend(CONFIG.RESEND_API_KEY) : null;

export async function sendEmailNotification(subject: string, htmlContent: string) {
  if (!resend || !CONFIG.RESEND_API_KEY) {
    console.log("[Resend skipped: No RESEND_API_KEY configured]");
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `UniStream Grants <${CONFIG.FROM_EMAIL}>`,
      to: [CONFIG.ALERT_EMAIL_RECIPIENT],
      subject: `[KUBG Vibeathon] ${subject}`,
      html: htmlContent,
    });

    if (error) {
      console.error(`Resend API Error:`, error);
    } else {
      console.log(`Audit email dispatched via Resend. ID: ${data?.id}`);
    }
  } catch (err: any) {
    console.error(`Failed sending email via Resend: ${err.message}`);
  }
}