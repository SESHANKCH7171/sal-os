import nodemailer, { type SendMailOptions } from "nodemailer";
import { incrementQuota } from "@/lib/enrichment/quota-tracker";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[] | null;
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Creates a singleton Nodemailer SMTP transporter using Hostinger SSL/TLS settings
 */
export function getHostingerSmtpTransporter() {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER || "seshank@seshankailabs.com";
  const pass = process.env.SMTP_PASS;

  if (!pass || pass === "your_hostinger_email_password") {
    throw new Error("SMTP_PASS is not configured with valid Hostinger credentials in .env.local");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // SSL for 465
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: true,
    },
  });
}

/**
 * Dispatches an email via Hostinger SMTP, enforcing headers and quota tracking
 */
export async function sendOutreachEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const fromUser = process.env.SMTP_USER || "seshank@seshankailabs.com";
  const transporter = getHostingerSmtpTransporter();

  const mailOptions: SendMailOptions = {
    from: `"Seshank Chinnapotula" <${fromUser}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
  };

  if (options.inReplyTo) {
    mailOptions.inReplyTo = options.inReplyTo;
  }

  if (options.references && options.references.length > 0) {
    mailOptions.references = options.references.join(" ");
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    await incrementQuota("hostinger_smtp");

    return {
      messageId: info.messageId,
      accepted: (info.accepted as string[]) || [options.to],
      rejected: (info.rejected as string[]) || [],
    };
  } catch (err: any) {
    const errCode = err?.responseCode || err?.code;
    console.error(`Hostinger SMTP send error [${errCode}]:`, err.message);

    // Tag SMTP temporary failure codes (421, 450, 451, etc.)
    if (errCode === 421 || errCode === 450 || errCode === 451) {
      const circuitBreakerErr = new Error(`SMTP temporary failure [${errCode}]: ${err.message}`);
      (circuitBreakerErr as any).isSmtpTemporaryError = true;
      (circuitBreakerErr as any).responseCode = errCode;
      throw circuitBreakerErr;
    }

    throw err;
  }
}
