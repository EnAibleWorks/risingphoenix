/**
 * Cloudflare Pages Function — POST /api/service-request
 *
 * Backend for the "Request Service" form on the Rising Phoenix Motorsports
 * homepage (index.html). Verifies the Cloudflare Turnstile token, re-validates
 * every required field server-side (never trust the client), then emails the
 * submission via Resend with the customer's own address set as Reply-To so
 * a technician can hit "Reply" and respond straight to the customer.
 *
 * Required Cloudflare Pages environment variables
 * (Pages project → Settings → Environment variables — set as *secrets*):
 *
 *   RESEND_API_KEY        Resend API key used to send the notification email.
 *   FORM_RECIPIENT_EMAIL  Inbox that receives submissions. During development
 *                         and testing this should be andy@enaibleworks.com.
 *   TURNSTILE_SECRET_KEY  Cloudflare Turnstile secret key (pairs with the
 *                         public site key set on the widget in index.html).
 */

const EMAIL_SUBJECT = 'New Rising Phoenix Service Request';

// Resend's shared sending address — works immediately, no domain verification
// required. Once a sending domain is verified in Resend, swap this for
// something like "Rising Phoenix Motorsports <requests@risingphoenixmotorsports.com>".
const FROM_ADDRESS = 'Rising Phoenix Motorsports <onboarding@resend.dev>';

export async function onRequestPost({ request, env }) {
  try {
    // ---- 1. Parse the JSON body sent by the fetch() call in index.html ----
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, message: 'Invalid request body.' });
    }

    const {
      name = '',
      phone = '',
      email = '',
      bikeYear = '',
      bikeMake = '',
      bikeModel = '',
      service = '',
      contactMethod = '',
      message = '',
      turnstileToken = ''
    } = body || {};

    // ---- 2. Server-side validation — mirrors the client-side checks, since
    //         the client can always be bypassed by a direct API call. ----
    const errors = [];
    if (!name.trim()) errors.push('Name is required.');
    if (!phone.trim() || !/^[0-9()+\-.\s]{7,}$/.test(phone.trim())) errors.push('A valid phone number is required.');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.push('A valid email address is required.');
    if (!service.trim()) errors.push('Please select the requested service.');
    if (!contactMethod.trim()) errors.push('Please select a preferred contact method.');
    if (!turnstileToken) errors.push('Missing verification token.');

    if (errors.length) {
      return jsonResponse(400, { success: false, message: errors.join(' ') });
    }

    // ---- 3. Verify the Turnstile token with Cloudflare before doing anything else ----
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const turnstileOk = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
    if (!turnstileOk) {
      return jsonResponse(400, { success: false, message: 'Verification failed. Please try again.' });
    }

    // ---- 4. Build the notification email ----
    const submittedAt = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const html = renderEmailHtml({
      name, phone, email, bikeYear, bikeMake, bikeModel,
      service, contactMethod, message, submittedAt, ip
    });

    // ---- 5. Send via Resend, with the customer's email as Reply-To so a
    //         technician can just hit "Reply" to respond to the customer ----
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [env.FORM_RECIPIENT_EMAIL],
        reply_to: email.trim(),
        subject: EMAIL_SUBJECT,
        html
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text().catch(() => '');
      console.error('Resend API error:', resendRes.status, errText);
      return jsonResponse(502, { success: false, message: 'Email delivery failed.' });
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error('service-request handler error:', err);
    return jsonResponse(500, { success: false, message: 'Unexpected server error.' });
  }
}

// Any non-POST request to this route (GET, PUT, etc.) falls through to
// Cloudflare Pages' default "405 Method Not Allowed" since no other
// onRequest<METHOD> export exists in this file.

/**
 * Verifies a Turnstile response token against Cloudflare's siteverify
 * endpoint. Uses the FormData shape from Cloudflare's own documented example.
 */
async function verifyTurnstile(token, secret, ip) {
  if (!secret) return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });
  if (!res.ok) return false;

  const data = await res.json();
  return data.success === true;
}

/** Escapes user-supplied text before it's interpolated into the HTML email. */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders the notification email as a simple, inline-styled HTML table. */
function renderEmailHtml(f) {
  const row = (label, value) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#5c626d;white-space:nowrap;vertical-align:top;">${label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;font-family:Arial,sans-serif;font-size:14px;color:#14161a;">${value || '&mdash;'}</td>
    </tr>`;

  return `
  <div style="background:#f6f7f9;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
      <div style="background:#14161a;padding:20px 24px;border-bottom:3px solid #ff6a15;">
        <span style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">Rising Phoenix Motorsports</span><br/>
        <span style="font-family:Arial,sans-serif;font-size:13px;color:#ff8a3d;letter-spacing:.05em;">NEW SERVICE REQUEST</span>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${row('Customer Name', escapeHtml(f.name))}
        ${row('Phone Number', escapeHtml(f.phone))}
        ${row('Email Address', escapeHtml(f.email))}
        ${row('Motorcycle Year', escapeHtml(f.bikeYear))}
        ${row('Motorcycle Make', escapeHtml(f.bikeMake))}
        ${row('Motorcycle Model', escapeHtml(f.bikeModel))}
        ${row('Requested Service', escapeHtml(f.service))}
        ${row('Preferred Contact Method', escapeHtml(f.contactMethod))}
        ${row('Customer Message', escapeHtml(f.message).replace(/\n/g, '<br/>'))}
        ${row('Date &amp; Time Submitted', escapeHtml(f.submittedAt))}
        ${row('IP Address', escapeHtml(f.ip))}
      </table>
      <div style="padding:16px 24px;font-family:Arial,sans-serif;font-size:12px;color:#9aa0ab;">
        Sent from the Request Service form at risingphoenixmotorsports.com. Reply to this email to respond directly to the customer.
      </div>
    </div>
  </div>`;
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
