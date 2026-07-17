/**
 * Cloudflare Pages Function — POST /api/service-request
 *
 * Backend for the "Request Service" form on the Rising Phoenix Motorsports
 * homepage (index.html). Re-validates every required field server-side
 * (never trust the client), then emails the submission via Resend with the
 * customer's own address set as Reply-To so a technician can hit "Reply"
 * and respond straight to the customer.
 *
 * Required Cloudflare Pages environment variables
 * (Pages project → Settings → Environment variables):
 *
 *   RESEND_API_KEY        Resend API key used to send the notification email (secret).
 *   FORM_RECIPIENT_EMAIL  Inbox that receives submissions (andy@enaibleworks.com during testing).
 *   FROM_EMAIL            The "from" address Resend sends as. Must be either
 *                         Resend's shared onboarding@resend.dev test address,
 *                         or an address on a domain you've verified in Resend.
 */

const EMAIL_SUBJECT = 'New Rising Phoenix Service Request';

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
      message = ''
    } = body || {};

    // ---- 2. Server-side validation — mirrors the client-side checks, since
    //         the client can always be bypassed by a direct API call. ----
    const errors = [];
    if (!name.trim()) errors.push('Name is required.');
    if (!phone.trim() || !/^[0-9()+\-.\s]{7,}$/.test(phone.trim())) errors.push('A valid phone number is required.');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.push('A valid email address is required.');
    if (!service.trim()) errors.push('Please select the requested service.');
    if (!contactMethod.trim()) errors.push('Please select a preferred contact method.');

    if (errors.length) {
      return jsonResponse(400, { success: false, message: errors.join(' ') });
    }

    // ---- 3. Build the notification email ----
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const submittedAt = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const html = renderEmailHtml({
      name, phone, email, bikeYear, bikeMake, bikeModel,
      service, contactMethod, message, submittedAt, ip
    });

    // ---- 4. Send via Resend, with the customer's email as Reply-To so a
    //         technician can just hit "Reply" to respond to the customer ----
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: formatFromAddress(env.FROM_EMAIL),
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
 * Resend's "from" field accepts either a bare address or a "Name <address>"
 * pair. FROM_EMAIL is configured as a bare address, so add the shop's display
 * name here unless someone's already set FROM_EMAIL to the full "Name <addr>" form.
 */
function formatFromAddress(fromEmail) {
  const value = (fromEmail || '').trim();
  if (!value) return 'Rising Phoenix Motorsports <onboarding@resend.dev>';
  return value.includes('<') ? value : `Rising Phoenix Motorsports <${value}>`;
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
