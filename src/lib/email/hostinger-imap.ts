import { ImapFlow } from "imapflow";

export interface LinkedInAlertDetected {
  alertType: "accepted" | "message";
  from: string;
  subject: string;
  date: Date;
  snippet: string;
  rawText: string;
}

export interface ImapSyncResult {
  repliesDetected: Array<{
    from: string;
    subject: string;
    inReplyTo?: string;
    references?: string[];
    date: Date;
    snippet: string;
  }>;
  bouncesDetected: Array<{
    from: string;
    subject: string;
    failedRecipient?: string;
    date: Date;
    reason: string;
  }>;
  linkedinAlerts: LinkedInAlertDetected[];
}

export interface SentEmailRecord {
  uid: number;
  to: string;
  subject: string;
  date: string;
  messageId?: string;
  snippet: string;
}

function createImapClient() {
  const host = process.env.IMAP_HOST || "imap.hostinger.com";
  const port = parseInt(process.env.IMAP_PORT || "993", 10);
  const user = process.env.SMTP_USER || "seshank@seshankailabs.com";
  const pass = process.env.SMTP_PASS;

  if (!pass || pass === "your_hostinger_email_password") {
    throw new Error("SMTP_PASS / IMAP password is not configured in .env.local");
  }

  return new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function extractReadableSnippet(sourceBuf?: Buffer): string {
  if (!sourceBuf) return "";
  const raw = sourceBuf.toString("utf8");
  const bodyIdx = raw.indexOf("\r\n\r\n");
  const body = bodyIdx !== -1 ? raw.slice(bodyIdx + 4) : raw;
  const stripped = body
    .replace(/<[^>]+>/g, " ")
    .replace(/=\r?\n/g, "");
  return decodeHtmlEntities(stripped)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

/**
 * Connects to Hostinger IMAP (imap.hostinger.com:993) to detect:
 * 1. Prospect replies via In-Reply-To / References / From address
 * 2. Delivery status notifications (bounces) from MAILER-DAEMON / Postmaster
 * 3. Forwarded/direct LinkedIn notifications (connection acceptances & messages)
 */
export async function syncHostingerImap(lookbackHours = 48): Promise<ImapSyncResult> {
  const client = createImapClient();

  const repliesDetected: ImapSyncResult["repliesDetected"] = [];
  const bouncesDetected: ImapSyncResult["bouncesDetected"] = [];
  const linkedinAlerts: LinkedInAlertDetected[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const sinceDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

      const messages = client.fetch(
        { since: sinceDate },
        {
          envelope: true,
          headers: ["in-reply-to", "references", "x-failed-recipients"],
          source: true,
          size: true,
        }
      );

      for await (const message of messages) {
        const env = message.envelope;
        if (!env) continue;

        const fromAddress = env.from?.[0]?.address?.toLowerCase() || "";
        const subject = env.subject || "";
        const date = env.date ? new Date(env.date) : new Date();
        const snippet = extractReadableSnippet(message.source);
        const combinedText = `${subject} ${snippet}`;

        const headersStr = message.headers ? message.headers.toString() : "";
        const inReplyToMatch = headersStr.match(/in-reply-to:\s*(.+)/i);
        const inReplyTo = inReplyToMatch ? inReplyToMatch[1].trim() : undefined;

        const referencesMatch = headersStr.match(/references:\s*(.+)/i);
        const rawReferences = referencesMatch ? referencesMatch[1].trim() : "";
        const references = rawReferences ? rawReferences.split(/\s+/).filter(Boolean) : [];

        // 1. Check for DSN / Bounce notifications
        const isBounceSender =
          fromAddress.includes("mailer-daemon") ||
          fromAddress.includes("postmaster") ||
          fromAddress.includes("mail-daemon");

        const isBounceSubject =
          /delivery status notification|undelivered mail|failure notice|returned to sender|mail delivery failed/i.test(
            subject
          );

        if (isBounceSender || isBounceSubject) {
          const failedRecipMatch = headersStr.match(/x-failed-recipients:\s*(.+)/i);
          const failedRecipientHeader = failedRecipMatch ? failedRecipMatch[1].trim() : undefined;
          bouncesDetected.push({
            from: fromAddress,
            subject,
            failedRecipient: failedRecipientHeader || undefined,
            date,
            reason: `Bounce detected from ${fromAddress}: ${subject}`,
          });
          continue;
        }

        // 2. Check for LinkedIn Notification Bridge (direct @linkedin.com or forwarded from seshankch9999/seshankch7171)
        const isLinkedInSource =
          fromAddress.includes("@linkedin.com") ||
          fromAddress.includes("seshankch9999@gmail.com") ||
          fromAddress.includes("seshankch7171@gmail.com") ||
          /linkedin/i.test(subject);

        if (isLinkedInSource) {
          if (/accepted your invitation/i.test(combinedText)) {
            linkedinAlerts.push({
              alertType: "accepted",
              from: fromAddress,
              subject,
              date,
              snippet: snippet.slice(0, 300),
              rawText: combinedText,
            });
            continue;
          }
          if (/sent you a message|replied to your message|new message from/i.test(combinedText)) {
            linkedinAlerts.push({
              alertType: "message",
              from: fromAddress,
              subject,
              date,
              snippet: snippet.slice(0, 300),
              rawText: combinedText,
            });
            continue;
          }
        }

        // 3. Check for prospect email reply (must not be from self)
        if (fromAddress && !fromAddress.includes("seshankailabs.com")) {
          repliesDetected.push({
            from: fromAddress,
            subject,
            inReplyTo,
            references,
            date,
            snippet: snippet || subject,
          });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err: any) {
    console.error("Hostinger IMAP sync error:", err.message);
    try {
      await client.logout();
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }

  return { repliesDetected, bouncesDetected, linkedinAlerts };
}

/**
 * Fetches the latest N messages from Hostinger's Sent mailbox via IMAP.
 */
export async function fetchHostingerSentEmails(limit = 25): Promise<SentEmailRecord[]> {
  const client = createImapClient();
  const sentRecords: SentEmailRecord[] = [];

  try {
    await client.connect();

    const candidateFolders = ["Sent", "INBOX.Sent", "Sent Items", "Sent Messages"];
    let lock: any = null;

    for (const folder of candidateFolders) {
      try {
        lock = await client.getMailboxLock(folder);
        break;
      } catch {
        // try next
      }
    }

    if (!lock) {
      await client.logout();
      return [];
    }

    try {
      const mailboxStatus = client.mailbox;
      const total = mailboxStatus && typeof mailboxStatus === "object" ? mailboxStatus.exists || 0 : 0;
      if (total > 0) {
        const startSeq = Math.max(1, total - limit + 1);
        const range = `${startSeq}:${total}`;

        const messages = client.fetch(range, {
          envelope: true,
          source: true,
          uid: true,
        });

        for await (const msg of messages) {
          const env = msg.envelope;
          if (!env) continue;
          const toAddr =
            env.to?.map((t: any) => t.address || t.name).filter(Boolean).join(", ") || "Unknown";

          sentRecords.push({
            uid: msg.uid,
            to: toAddr,
            subject: env.subject || "(No Subject)",
            date: env.date ? new Date(env.date).toISOString() : new Date().toISOString(),
            messageId: env.messageId || undefined,
            snippet: extractReadableSnippet(msg.source).slice(0, 260),
          });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err: any) {
    console.error("Hostinger Sent IMAP error:", err.message);
    try {
      await client.logout();
    } catch {
      // ignore
    }
    throw err;
  }

  return sentRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
