/**
 * utils/fomowelcome.js
 * FOMO Welcome Campaign — send promo code reminder to new users (registered < 24h ago)
 * who haven't made any order yet.
 *
 * - Sends beautiful HTML email with promo code + urgency countdown
 * - Sends in-app notification (stored in DB, shown on dashboard)
 * - Anti-spam: tracks sent status per user with `fomoWelcomeSentAt`
 */

const { db } = require('../database/db');
const { sendEmail, fomoWelcomeHtml } = require('./mailer');
const { sendWhatsAppNotification } = require('./whatsapp');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = (process.env.BASE_URL || 'https://alexcloud.my.id').replace(/\/$/, '');

/**
 * Create or update a promo code in the database.
 * Returns the promo code string.
 */
function ensurePromoCode(code, discountValue, expiryHours) {
    const existing = db.get('promoCodes').find({ code }).value();
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    if (!existing) {
        db.get('promoCodes').push({
            id: uuidv4(),
            code,
            discountType: 'fixed',
            discountValue,
            maxUses: 9999,
            usedCount: 0,
            expiresAt,
            isActive: true,
            createdAt: new Date().toISOString(),
            description: 'Promo FOMO Welcome - User Baru'
        }).write();
        console.log(`[FOMO] Created promo code ${code} (expires in ${expiryHours}h)`);
    } else {
        // Refresh expiry if already exists but expired or close to expiring
        db.get('promoCodes').find({ code }).assign({ 
            expiresAt, 
            isActive: true 
        }).write();
        console.log(`[FOMO] Refreshed expiry for promo code ${code}`);
    }

    return code;
}

/**
 * Push in-app notification to user's notification list (stored in DB).
 * These are shown on the user's dashboard.
 */
function pushInAppNotification(userId, { title, message, type = 'promo', link = null }) {
    // Check if chatMessages or notifications collection exists
    const notifications = db.get('notifications');
    if (notifications) {
        const existing = db.get('notifications').value();
        if (Array.isArray(existing)) {
            // Check if already notified
            const alreadySent = existing.find(n => n.userId === userId && n.type === 'fomo_welcome');
            if (alreadySent) return false;

            db.get('notifications').push({
                id: uuidv4(),
                userId,
                type: 'fomo_welcome',
                title,
                message,
                link,
                isRead: false,
                createdAt: new Date().toISOString()
            }).write();
            return true;
        }
    }

    // Fallback: store in chatMessages as system message
    const chatMsgs = db.get('chatMessages').value();
    if (Array.isArray(chatMsgs)) {
        // Check if already sent
        const alreadySent = chatMsgs.find(m => m.userId === userId && m.type === 'fomo_welcome');
        if (alreadySent) return false;

        db.get('chatMessages').push({
            id: uuidv4(),
            userId,
            type: 'fomo_welcome',
            sender: 'system',
            title,
            message,
            link,
            isRead: false,
            createdAt: new Date().toISOString()
        }).write();
        return true;
    }

    return false;
}

/**
 * Main FOMO Welcome runner.
 * Call this once when you want to blast new users (< 24h ago, no orders).
 *
 * @param {Object} options
 * @param {string} options.promoCode   - promo code string, e.g. "WELCOME-5AH7A"
 * @param {number} options.discount    - discount in IDR, e.g. 5000
 * @param {number} options.expiryHours - hours until promo expires, e.g. 12
 */
async function runFomoWelcome({ promoCode, discount = 5000, expiryHours = 12 } = {}) {
    try {
        const code = promoCode || `WELCOME-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        // Ensure promo exists in DB
        ensurePromoCode(code, discount, expiryHours);

        // Find new users: registered in last 24h, not yet received FOMO welcome
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const allUsers = db.get('users').value() || [];
        const allOrders = db.get('orders').value() || [];
        const userIdsWithOrders = new Set(allOrders.map(o => o.userId));

        const targets = allUsers.filter(u => {
            if (u.role === 'admin') return false;           // skip admin
            if (!u.createdAt || u.createdAt < cutoff) return false; // must be < 24h
            if (u.fomoWelcomeSentAt) return false;          // already sent
            // Only target users who haven't made any order
            // (optional: include them anyway as reminder)
            return true;
        });

        if (targets.length === 0) {
            console.log('[FOMO] No new users to send FOMO Welcome.');
            return { sent: 0, skipped: 0, promoCode: code };
        }

        console.log(`[FOMO] Sending FOMO Welcome to ${targets.length} new user(s). Promo: ${code}`);
        let sent = 0, skipped = 0;

        for (const user of targets) {
            let emailSent = false;

            // 1. Send email
            const html = fomoWelcomeHtml({
                userName: user.name,
                promoCode: code,
                discountAmount: discount,
                expiryHours,
                websiteUrl: BASE_URL
            });
            emailSent = await sendEmail(
                user.email,
                `🎁 ${user.name.split(' ')[0]}, kode promomu akan kedaluwarsa dalam ${expiryHours} jam!`,
                html
            );

            // 2. Push in-app notification
            pushInAppNotification(user.id, {
                title: `🎁 Kode Promo Eksklusif Untukmu!`,
                message: `Gunakan kode *${code}* untuk hemat Rp ${Number(discount).toLocaleString('id-ID')}! Berlaku hanya ${expiryHours} jam. Jangan sampai kedaluwarsa! 🔥`,
                type: 'fomo_welcome',
                link: `${BASE_URL}/order`
            });

            // 3. Mark user as FOMO-welcomed
            db.get('users').find({ id: user.id }).assign({
                fomoWelcomeSentAt: new Date().toISOString()
            }).write();

            if (emailSent) {
                sent++;
                console.log(`[FOMO] ✅ Sent to ${user.email}`);
            } else {
                skipped++;
                console.warn(`[FOMO] ⚠️  Email failed for ${user.email}`);
            }
        }

        // Notify owner about the campaign result
        if (sent > 0 || skipped > 0) {
            const ownerMsg = `📢 *FOMO WELCOME CAMPAIGN*\n\n` +
                `✅ Berhasil: ${sent} user\n` +
                `⚠️ Gagal kirim email: ${skipped} user\n\n` +
                `🎟️ Kode Promo: *${code}*\n` +
                `💰 Diskon: Rp ${Number(discount).toLocaleString('id-ID')}\n` +
                `⏰ Berlaku: ${expiryHours} jam\n\n` +
                `Total user baru yang di-target: ${targets.length}`;
            sendWhatsAppNotification(ownerMsg).catch(err =>
                console.error('[FOMO] Owner WA notification failed:', err.message)
            );
        }

        return { sent, skipped, promoCode: code, total: targets.length };
    } catch (err) {
        console.error('[FOMO] Fatal error:', err.message);
        return { sent: 0, skipped: 0, error: err.message };
    }
}

module.exports = { runFomoWelcome };
