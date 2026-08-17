// Real email/SMS delivery. Both providers are optional — if their API keys aren't
// set in .env, this falls back to logging the message to the server console instead
// of throwing an error, so the app still works while you're getting keys set up.

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM = process.env.SENDGRID_FROM_EMAIL;

const AT_USERNAME = process.env.AFRICASTALKING_USERNAME;
const AT_API_KEY = process.env.AFRICASTALKING_API_KEY;
const AT_SENDER_ID = process.env.AFRICASTALKING_SENDER_ID; // optional

export async function sendEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: "No recipient email." };
  if (!SENDGRID_KEY || !SENDGRID_FROM) {
    console.log(`[EMAIL — not configured, logging instead]\nTo: ${to}\nSubject: ${subject}\n${text}`);
    return { sent: false, reason: "SendGrid not configured (see .env.example)." };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM, name: "Wosha" },
      subject,
      content: [
        { type: "text/plain", value: text || "" },
        ...(html ? [{ type: "text/html", value: html }] : []),
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("SendGrid error:", errText);
    return { sent: false, reason: "Email provider rejected the request." };
  }
  return { sent: true };
}

export async function sendSms({ to, message }) {
  if (!to) return { sent: false, reason: "No recipient phone number." };
  if (!AT_USERNAME || !AT_API_KEY) {
    console.log(`[SMS — not configured, logging instead]\nTo: ${to}\n${message}`);
    return { sent: false, reason: "Africa's Talking not configured (see .env.example)." };
  }
  const body = new URLSearchParams({
    username: AT_USERNAME,
    to,
    message,
    ...(AT_SENDER_ID ? { from: AT_SENDER_ID } : {}),
  });
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey: AT_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Africa's Talking error:", errText);
    return { sent: false, reason: "SMS provider rejected the request." };
  }
  return { sent: true };
}
