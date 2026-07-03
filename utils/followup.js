/**
 * utils/followup.js
 * Auto follow-up for pending/expired orders via WhatsApp (if phone exists) or Email.
 * 
 * Rules:
 *  - Only targets orders with status 'pending' or 'expired'
 *  - First follow-up: 1 hour after createdAt
 *  - Second follow-up: 24 hours after createdAt (final)
 *  - Max 2 follow-ups per order (anti-spam)
 *  - Tracks follow-up state with: followUpCount, lastFollowUpAt
 */

const { db } = require('../database/db');
const { sendWhatsAppNotification } = require('./whatsapp');
const { sendEmail, pendingOrderFollowUpHtml } = require('./mailer');

const BASE_URL = (process.env.BASE_URL || 'https://alexcloud.my.id').replace(/\/$/, '');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutesSince(isoStr) {
    return (Date.now() - new Date(isoStr).getTime()) / 60000;
}

function formatRupiah(amount) {
    return `Rp ${Number(amount).toLocaleString('id-ID')}`;
}

// ─── WhatsApp message to buyer (via bot → send to their number) ───────────────
async function sendWaFollowUpToBuyer(phone, order, followUpNum) {
    const paymentUrl = `${BASE_URL}/payment/${order.orderId}`;
    const msg = followUpNum === 1
        ? `Halo *${order.userName}*! 👋\n\n` +
          `Kami dari *AlexCloud Store* ingin mengingatkan bahwa kamu memiliki pesanan yang belum diselesaikan:\n\n` +
          `📦 *Paket:* ${order.planName}\n` +
          `🆔 *Order ID:* #${order.orderId}\n` +
          `💰 *Total:* ${formatRupiah(order.price)}\n\n` +
          `Segera selesaikan pembayaranmu di link berikut:\n` +
          `🔗 ${paymentUrl}\n\n` +
          `Butuh bantuan? Balas pesan ini ya! 😊`
        : `Hai *${order.userName}*! ⚠️\n\n` +
          `Ini adalah pengingat terakhir untuk pesananmu di *AlexCloud Store*:\n\n` +
          `📦 *Paket:* ${order.planName}\n` +
          `🆔 *Order ID:* #${order.orderId}\n` +
          `💰 *Total:* ${formatRupiah(order.price)}\n\n` +
          `Pesananmu akan segera kedaluwarsa. Selesaikan sekarang:\n` +
          `🔗 ${paymentUrl}\n\n` +
          `_Jika kamu tidak berminat, abaikan pesan ini._ 🙏`;

    // Send via Bot WA endpoint → to buyer's phone
    const botWaUrl = process.env.BOT_WA_URL;
    const botSecret = process.env.BOT_SHARED_SECRET || 'alexcloud-botwa-secret-2026';
    if (botWaUrl) {
        try {
            const axios = require('axios');
            // Format phone: remove leading 0, add 62, remove +
            const cleanPhone = phone.replace(/\D/g, '').replace(/^0/, '62').replace(/^\+/, '');
            await axios.post(`${botWaUrl}/api/send-message`, {
                secret: botSecret,
                phone: cleanPhone,
                message: msg
            }, { timeout: 10000 });
            console.log(`[FOLLOWUP] ✅ WA sent to buyer ${cleanPhone} (order #${order.orderId})`);
            return true;
        } catch (err) {
            console.error(`[FOLLOWUP] ❌ WA to buyer failed:`, err.message);
            return false;
        }
    }
    return false;
}

// ─── Send owner alert (when buyer has no phone) ───────────────────────────────
async function sendOwnerAlert(order) {
    const paymentUrl = `${BASE_URL}/payment/${order.orderId}`;
    const adminUrl  = `${BASE_URL}/admin/orders`;
    const msg = `🔔 *FOLLOW-UP DIPERLUKAN - Order Pending*\n\n` +
        `Pembeli berikut belum menyelesaikan pembayaran:\n\n` +
        `👤 *Nama:* ${order.userName}\n` +
        `📧 *Email:* ${order.userEmail}\n` +
        `📦 *Paket:* ${order.planName}\n` +
        `🆔 *Order ID:* #${order.orderId}\n` +
        `💰 *Total:* ${formatRupiah(order.price)}\n` +
        `🕐 *Order dibuat:* ${new Date(order.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
        `📱 Tidak ada nomor HP tersimpan. Email follow-up sudah dikirim ke ${order.userEmail}.\n\n` +
        `🔗 Link admin: ${adminUrl}`;
    
    return sendWhatsAppNotification(msg).catch(err => 
        console.error('[FOLLOWUP] Owner WA alert failed:', err.message)
    );
}

// ─── Main follow-up runner ────────────────────────────────────────────────────
async function runPendingOrderFollowUp() {
    try {
        const now = Date.now();
        const orders = db.get('orders').value() || [];

        // Find actionable orders
        const targets = orders.filter(o => {
            if (!['pending', 'expired'].includes(o.status)) return false;
            if ((o.followUpCount || 0) >= 2) return false; // max 2 follow-ups

            const ageMinutes = minutesSince(o.createdAt);
            const followUpCount = o.followUpCount || 0;

            // First follow-up: after 60 min
            if (followUpCount === 0 && ageMinutes >= 60) return true;
            // Second follow-up: after 1440 min (24h), min 60 min after last follow-up
            if (followUpCount === 1 && ageMinutes >= 1440) {
                if (!o.lastFollowUpAt) return true;
                const minSinceLastFollowUp = (now - new Date(o.lastFollowUpAt).getTime()) / 60000;
                return minSinceLastFollowUp >= 60;
            }
            return false;
        });

        if (targets.length === 0) {
            console.log('[FOLLOWUP] No pending orders to follow up.');
            return { sent: 0, skipped: 0 };
        }

        console.log(`[FOLLOWUP] Found ${targets.length} order(s) to follow up.`);
        let sent = 0, skipped = 0;

        for (const order of targets) {
            const followUpNum = (order.followUpCount || 0) + 1;
            const paymentUrl = `${BASE_URL}/payment/${order.orderId}`;
            const expiryHours = followUpNum === 1 ? 23 : 2;

            // Get user record to check if phone exists
            const user = db.get('users').find({ id: order.userId }).value();
            const phone = user?.phone;

            let waSent = false;
            let emailSent = false;

            // 1. Try WhatsApp to buyer if phone available
            if (phone) {
                waSent = await sendWaFollowUpToBuyer(phone, order, followUpNum);
            }

            // 2. Send email to buyer (always, regardless of phone)
            const html = pendingOrderFollowUpHtml({
                userName: order.userName,
                orderId: order.orderId,
                planName: order.planName,
                price: order.price,
                paymentUrl,
                expiryHours
            });
            const subject = followUpNum === 1
                ? `⚠️ Pesananmu #${order.orderId} belum selesai - AlexCloud`
                : `🔴 Pengingat Terakhir: Pesanan #${order.orderId} akan kedaluwarsa!`;
            emailSent = await sendEmail(order.userEmail, subject, html);

            // 3. If no phone, alert owner
            if (!phone) {
                await sendOwnerAlert(order);
            }

            // Update follow-up tracking on order
            db.get('orders').find({ id: order.id }).assign({
                followUpCount: followUpNum,
                lastFollowUpAt: new Date().toISOString()
            }).write();

            if (waSent || emailSent) {
                sent++;
                console.log(`[FOLLOWUP] ✅ Follow-up #${followUpNum} sent for order #${order.orderId} (email:${emailSent}, wa:${waSent})`);
            } else {
                skipped++;
                console.warn(`[FOLLOWUP] ⚠️  Follow-up #${followUpNum} failed for order #${order.orderId} — no delivery method worked.`);
            }
        }

        return { sent, skipped };
    } catch (err) {
        console.error('[FOLLOWUP] Fatal error:', err.message);
        return { sent: 0, skipped: 0, error: err.message };
    }
}

module.exports = { runPendingOrderFollowUp };
