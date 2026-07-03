/**
 * utils/mailer.js
 * Email sending utility for AlexCloud using Nodemailer (Gmail SMTP / any SMTP)
 *
 * Env vars needed:
 *   SMTP_HOST      - e.g. smtp.gmail.com
 *   SMTP_PORT      - 587 (TLS) or 465 (SSL)
 *   SMTP_USER      - your Gmail address or SMTP username
 *   SMTP_PASS      - Gmail App Password (NOT your real password)
 *   SMTP_FROM      - Display name + address, e.g. "AlexCloud Store <noreply@alexcloud.my.id>"
 */

const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
    if (_transporter) return _transporter;

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
        console.warn('[MAILER] ⚠️  SMTP_USER atau SMTP_PASS tidak di-set. Email tidak akan terkirim.');
        return null;
    }

    _transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
    });

    return _transporter;
}

/**
 * Send a plain HTML email.
 * @param {string} to - recipient email address
 * @param {string} subject - email subject
 * @param {string} html - HTML body
 * @param {string} [text] - plain-text fallback
 * @returns {Promise<boolean>} true if sent, false on failure
 */
async function sendEmail(to, subject, html, text = '') {
    const transporter = getTransporter();
    if (!transporter) {
        console.warn(`[MAILER] Skipping email to ${to} — SMTP not configured.`);
        return false;
    }

    const from = process.env.SMTP_FROM || `"AlexCloud Store" <${process.env.SMTP_USER}>`;

    try {
        const info = await transporter.sendMail({ from, to, subject, html, text });
        console.log(`[MAILER] ✅ Email sent to ${to} | messageId: ${info.messageId}`);
        return true;
    } catch (err) {
        console.error(`[MAILER] ❌ Failed to send email to ${to}:`, err.message);
        return false;
    }
}

// ─── Email Templates ─────────────────────────────────────────────────────────

/**
 * Follow-up email for pending/expired order
 */
function pendingOrderFollowUpHtml({ userName, orderId, planName, price, paymentUrl, expiryHours }) {
    const formattedPrice = `Rp ${Number(price).toLocaleString('id-ID')}`;
    return `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pesanan Kamu Belum Selesai!</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">⚠️ Pesananmu Belum Selesai!</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">Jangan sampai ketinggalan, ${userName}!</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="color:#c0c0d0;font-size:16px;line-height:1.6;margin:0 0 24px;">
            Hai <strong style="color:#fff;">${userName}</strong>, kami melihat kamu belum menyelesaikan pembayaran untuk order berikut:
          </p>
          <!-- Order Card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 8px;color:#9090a0;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Detail Order</p>
              <p style="margin:0 0 6px;color:#fff;font-size:18px;font-weight:700;">📦 ${planName}</p>
              <p style="margin:0 0 6px;color:#a0d0ff;font-size:15px;">🆔 Order ID: <strong>#${orderId}</strong></p>
              <p style="margin:0;color:#7aef9e;font-size:20px;font-weight:800;">💰 ${formattedPrice}</p>
            </td></tr>
          </table>
          <p style="color:#ffb347;font-size:14px;margin:0 0 24px;">
            ⏰ Link pembayaran akan kedaluwarsa dalam <strong>${expiryHours} jam</strong>. Segera selesaikan sebelum terlambat!
          </p>
          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
            <a href="${paymentUrl}" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;padding:16px 40px;border-radius:50px;font-size:16px;font-weight:700;box-shadow:0 4px 20px rgba(102,126,234,0.5);">
              🚀 Selesaikan Pembayaran Sekarang
            </a>
          </td></tr></table>
          <p style="color:#707080;font-size:13px;text-align:center;margin:0;">
            Butuh bantuan? Hubungi kami di WhatsApp atau kunjungi <a href="https://alexcloud.my.id" style="color:#667eea;">alexcloud.my.id</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:rgba(0,0,0,0.3);padding:20px;text-align:center;">
          <p style="margin:0;color:#505060;font-size:12px;">© 2024 AlexCloud Store · Premium Cloud Gaming Service</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * FOMO Welcome email for new users
 */
function fomoWelcomeHtml({ userName, promoCode, discountAmount, expiryHours, websiteUrl }) {
    const formattedDiscount = `Rp ${Number(discountAmount).toLocaleString('id-ID')}`;
    return `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎁 Kode Promo Eksklusif Untukmu!</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#f093fb,#f5576c);padding:32px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">🎁</div>
          <h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;">Selamat Datang di AlexCloud!</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">Kode promo eksklusif untukmu, ${userName}!</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="color:#c0c0d0;font-size:16px;line-height:1.6;margin:0 0 24px;">
            Hai <strong style="color:#fff;">${userName}</strong>! 🎉 Terima kasih sudah bergabung dengan komunitas AlexCloud.<br><br>
            Sebagai tanda sambutan, kami punya <strong style="color:#f5576c;">hadiah spesial</strong> untukmu:
          </p>
          <!-- Promo Code Box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,rgba(240,147,251,0.15),rgba(245,87,108,0.15));border:2px dashed #f093fb;border-radius:16px;margin-bottom:24px;">
            <tr><td style="padding:24px;text-align:center;">
              <p style="margin:0 0 8px;color:#f093fb;font-size:13px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Kode Promo Eksklusifmu</p>
              <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:12px 24px;display:inline-block;margin:8px 0;">
                <span style="color:#fff;font-size:28px;font-weight:900;letter-spacing:4px;font-family:monospace;">${promoCode}</span>
              </div>
              <p style="margin:8px 0 0;color:#7aef9e;font-size:18px;font-weight:700;">Hemat ${formattedDiscount} untuk semua paket!</p>
            </td></tr>
          </table>
          <!-- Urgency Banner -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,69,0,0.15);border-left:4px solid #ff4500;border-radius:0 8px 8px 0;margin-bottom:24px;">
            <tr><td style="padding:16px;">
              <p style="margin:0;color:#ff8c69;font-size:14px;font-weight:600;">
                ⏰ PERHATIAN: Kode ini <strong>kedaluwarsa dalam ${expiryHours} jam</strong>!<br>
                <span style="font-weight:400;color:#c0a090;">Gunakan sekarang sebelum kesempatan ini berlalu.</span>
              </p>
            </td></tr>
          </table>
          <!-- Features -->
          <p style="color:#9090a0;font-size:14px;margin:0 0 16px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Yang kamu dapatkan di AlexCloud:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${['🎮 Akses 100+ Game Premium', '📺 Streaming 4K / 60fps', '☁️ Cloud Save Otomatis', '🤖 AI Assistant 24/7', '📱 Support WhatsApp 24/7'].map(f => `
            <tr><td style="padding:6px 0;color:#c0c0d0;font-size:14px;">✅ ${f}</td></tr>`).join('')}
          </table>
          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
            <a href="${websiteUrl}/order" style="display:inline-block;background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff;text-decoration:none;padding:16px 40px;border-radius:50px;font-size:16px;font-weight:700;box-shadow:0 4px 20px rgba(240,147,251,0.4);">
              🛒 Klaim Diskonku Sekarang →
            </a>
          </td></tr></table>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:rgba(0,0,0,0.3);padding:20px;text-align:center;">
          <p style="margin:0;color:#505060;font-size:12px;">© 2024 AlexCloud Store · <a href="${websiteUrl}" style="color:#667eea;">alexcloud.my.id</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = {
    sendEmail,
    pendingOrderFollowUpHtml,
    fomoWelcomeHtml
};
