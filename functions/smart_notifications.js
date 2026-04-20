/**
 * smart_notifications.js — Smart Automated Notification Engine
 * 
 * Runs every 10 minutes via Cloud Scheduler. Evaluates multiple notification
 * triggers and sends contextual, hype-driven push notifications to all users.
 * 
 * Categories:
 *   1. Time-Based Daily Engagement (Morning, Afternoon, Evening, Prime, Night)
 *   2. Match Slot-Fill Alerts (75%, 90%, Final Call)
 *   3. Match Countdown (1 hour, 15 min before)
 *   4. Deposit Motivation (rotating)
 *   5. General Hype & FOMO (rotating)
 *   6. New Matches Alert
 *   7. Tomorrow Preview (evening notification about next day)
 *   8. Weekend Special
 *   9. Social Proof / Win Hype
 *  10. Tournament Hype
 * 
 * Deduplication: smart_notif_tracking/{YYYY-MM-DD}/{key}
 * Config: platform_config/smart_notifications/
 * 
 * Exports: smartNotificationEngine
 */

const {
    functions, admin, db,
    sendPush, logEvent
} = require('./helpers');

// ─── IST Helpers ────────────────────────────────────────────

function getISTNow() {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function getISTDateStr(d) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getISTHour(d) {
    return d.getUTCHours(); // Already shifted by +5:30
}

function getISTMinute(d) {
    return d.getUTCMinutes();
}

function formatMatchTime(dateTimeStr) {
    try {
        const d = new Date(dateTimeStr);
        return d.toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
        });
    } catch {
        return 'soon';
    }
}

function formatMatchDate(dateTimeStr) {
    try {
        const d = new Date(dateTimeStr);
        return d.toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'
        });
    } catch {
        return '';
    }
}

// Random pick from array
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ─── MESSAGE TEMPLATES ──────────────────────────────────────

const MESSAGES = {

    // ═══════════════════════════════════════════════════════
    // 1. TIME-BASED DAILY ENGAGEMENT
    // ═══════════════════════════════════════════════════════

    morning_hype: [
        { title: '🚀 GOOD MORNING PLAYERS!', body: 'Start your day with matches — join now and win big! 🎯' },
        { title: '☀️ RISE & WIN!', body: 'Morning matches are LIVE — low entry, big rewards. Jump in now! 💰' },
        { title: '🌅 EARLY BIRD WINS MORE!', body: 'First matches of the day are open — fewer players, better chances! 🏆' },
        { title: '⚡ MORNING MATCHES LIVE!', body: 'Your daily chance to win real cash starts NOW. Don\'t sleep on it! 🔥' },
        { title: '🎯 START STRONG TODAY!', body: 'Champions wake up and play! Morning matches are waiting for you 💪' },
        { title: '🌟 NEW DAY, NEW WINS!', body: 'Fresh matches, fresh prizes — start your winning streak today! 🚀' },
        { title: '☕ WAKE UP & PLAY!', body: 'Morning slots are open with easy entry fees. Perfect time to start! 🎮' },
        { title: '🔥 MORNING GRIND TIME!', body: 'Real players play early. Low competition, high rewards — join now! 💰' },
    ],

    afternoon_grind: [
        { title: '🔥 AFTERNOON GRIND!', body: 'Matches are filling fast — secure your slot now! 💰' },
        { title: '🎮 KEEP PLAYING!', body: 'More matches added — don\'t stop your winning streak! 🚀' },
        { title: '⚡ MIDDAY MATCHES LIVE!', body: 'Join now before slots get full. Afternoon matches are heating up! 🔥' },
        { title: '💥 LUNCH BREAK = PLAY TIME!', body: 'Quick matches, real money. Perfect for your break! 🎯' },
        { title: '🏆 AFTERNOON SPECIALS!', body: 'Special prize pools running right now — don\'t miss these! 💰' },
        { title: '🎲 MID-DAY MADNESS!', body: 'Matches are going LIVE one after another. Pick yours and WIN! 🔥' },
        { title: '⚡ SLOTS FILLING UP!', body: 'Afternoon rush is here — players are joining fast. Secure your spot! 🚀' },
        { title: '🎯 HALF DAY, FULL WINS!', body: 'Afternoon matches with big prizes are live now. Don\'t wait! 💪' },
    ],

    evening_matches: [
        { title: '🏟️ EVENING MATCHES LIVE!', body: 'Prime time is here — join now and win big! 🔥' },
        { title: '⚡ FILLING FAST!', body: 'Evening matches almost full — hurry up! 🚀' },
        { title: '🌆 EVENING PRIME TIME!', body: 'The best matches of the day are HERE. Join now! 💰' },
        { title: '🎮 GAME TIME!', body: 'Evening slots are the hottest — most players, biggest prizes! 🏆' },
        { title: '🔥 PEAK HOURS STARTED!', body: 'Maximum players are online NOW. Big matches, big wins! ⚡' },
        { title: '💰 EVENING REWARDS!', body: 'High-reward evening matches are live — grab your slot! 🎯' },
        { title: '🏟️ SHOWTIME!', body: 'Evening matches are where legends are made. Are you in? 🏆' },
        { title: '⚡ PRIME MATCHES DROPPING!', body: 'Fresh evening matches just went live — join before it\'s too late! 🔥' },
    ],

    prime_time: [
        { title: '🔥 PRIME TIME STARTED!', body: 'Best time to play — enter now! 🏆' },
        { title: '🚀 BIG MATCHES LIVE!', body: 'High reward matches are open — don\'t miss out! 💰' },
        { title: '⚡ LAST FEW SLOTS!', body: 'Prime matches filling fast — join now! 🔥' },
        { title: '🎯 WIN BIG NOW!', body: 'Your chance to earn more — enter immediately! 💰' },
        { title: '🏆 PRIME TIME = MONEY TIME!', body: 'The biggest prize pools of the day are LIVE now! 🔥' },
        { title: '💥 MAXIMUM ACTION!', body: 'Peak hours = maximum players = maximum wins. Join NOW! ⚡' },
        { title: '🔥 DON\'T MISS PRIME TIME!', body: 'This is when real winners play. Slots going fast! 🚀' },
        { title: '🎮 PRIME BATTLES LIVE!', body: 'Top players are online. Show your skills and WIN! 🏆' },
    ],

    night_final: [
        { title: '🌙 FINAL MATCHES!', body: 'Last matches of the day — join now or miss out! 🚀' },
        { title: '⚡ LAST CHANCE!', body: 'Only a few matches left — play now! 🔥' },
        { title: '🎯 END YOUR DAY WITH A WIN!', body: 'Join final matches and grab your rewards! 🏆' },
        { title: '🌙 NIGHT OWL MATCHES!', body: 'Late night, low competition. Perfect time for easy wins! 💰' },
        { title: '🔥 FINAL CALL TONIGHT!', body: 'Last few matches closing soon. Don\'t end the day without playing! ⚡' },
        { title: '🌙 CLOSING TIME!', body: 'Tonight\'s last matches are LIVE. Last chance to earn today! 🚀' },
        { title: '💰 NIGHT REWARDS!', body: 'Final matches often have the best odds. Jump in now! 🎯' },
        { title: '🌙 ONE LAST GAME?', body: 'End your day on a winning note — final slots available NOW! 🏆' },
    ],

    // ═══════════════════════════════════════════════════════
    // 2. SLOT-FILL ALERTS (Dynamic — uses template vars)
    // ═══════════════════════════════════════════════════════

    slot_75: [
        { title: '⚡ FEW SLOTS LEFT — {gameName}!', body: '{gameName} {type} at {time} almost full — only {remaining} slots left! 🚀' },
        { title: '🔥 FILLING FAST — {gameName}!', body: 'Only {remaining} slots remain in {gameName} {type} ({time}). Join fast! 💥' },
        { title: '⏳ HURRY UP — {gameName}!', body: '{gameName} {type} match at {time} is 75% full! {remaining} spots left 🔥' },
        { title: '💨 GOING FAST — {gameName}!', body: 'Players rushing to join {gameName} {type} at {time}. Only {remaining} left! ⚡' },
        { title: '🎯 ALMOST PACKED — {gameName}!', body: '{gameName} {type} at {time} — {remaining} slots and counting down! 🚀' },
    ],

    slot_90: [
        { title: '🔥 ALMOST FULL — {gameName}!', body: 'Only {remaining} slots in {gameName} {type} at {time}! Don\'t miss out 💥' },
        { title: '⚡ LAST FEW SLOTS — {gameName}!', body: '{gameName} {type} at {time} — nearly full! Only {remaining} spots 🔥' },
        { title: '🚨 CLOSING SOON — {gameName}!', body: '{gameName} {type} match at {time} is 90% booked! {remaining} left only! ⏰' },
        { title: '💥 GRAB YOUR SPOT — {gameName}!', body: 'Only {remaining} slots remaining in {gameName} at {time}! Act NOW! 🔥' },
        { title: '🎯 NOW OR NEVER — {gameName}!', body: '{gameName} {type} at {time} has just {remaining} spots. Hurry! ⚡' },
    ],

    slot_final: [
        { title: '🚨 FINAL CALL — {gameName}!', body: 'LAST {remaining} SLOT{s} in {gameName} {type} at {time}! Join NOW 🏆' },
        { title: '⚡ LAST SLOT — {gameName}!', body: '1 spot left in {gameName} {type} at {time}! Someone is about to take it 🔥' },
        { title: '🔥 DO OR DIE — {gameName}!', body: '{gameName} {type} at {time} — ONLY {remaining} LEFT! This is IT! 🚨' },
        { title: '💥 FINAL ENTRY — {gameName}!', body: 'Last {remaining} spot{s} in {gameName} {type} ({time}). Don\'t regret missing this! 🏆' },
        { title: '🚨 GOING, GOING, GONE — {gameName}!', body: '{gameName} {type} at {time} has {remaining} slot{s} left! Move FAST! ⚡' },
    ],

    // ═══════════════════════════════════════════════════════
    // 3. MATCH COUNTDOWN
    // ═══════════════════════════════════════════════════════

    countdown_60: [
        { title: '⏰ MATCH IN 1 HOUR — {gameName}!', body: '{gameName} {type} starts at {time}! {slotsInfo} — secure your spot! 🎮' },
        { title: '🕐 1 HOUR TO GO — {gameName}!', body: '{gameName} {type} kicks off at {time}. {slotsInfo} Get ready! ⚡' },
        { title: '⏰ STARTING SOON — {gameName}!', body: 'Just 1 hour until {gameName} {type} at {time}! {slotsInfo} 🔥' },
        { title: '🎮 GET READY — {gameName}!', body: '{gameName} {type} begins at {time} — that\'s just 60 minutes away! {slotsInfo} 🚀' },
    ],

    countdown_15: [
        { title: '⏰ STARTING IN 15 MIN — {gameName}!', body: '{gameName} {type} begins at {time}! {slotsInfo} — last chance! 🔥' },
        { title: '🚨 15 MINUTES LEFT — {gameName}!', body: '{gameName} {type} at {time} is about to START! {slotsInfo} ⚡' },
        { title: '⏰ ALMOST TIME — {gameName}!', body: 'Only 15 min until {gameName} {type}! {slotsInfo} Join NOW! 🏆' },
        { title: '🔥 DOORS CLOSING — {gameName}!', body: '{gameName} {type} starts in 15 min at {time}. {slotsInfo} 🚨' },
    ],

    // ═══════════════════════════════════════════════════════
    // 4. DEPOSIT MOTIVATION
    // ═══════════════════════════════════════════════════════

    deposit_motivation: [
        { title: '💰 TIME TO DEPOSIT!', body: 'Add funds and join today\'s matches — guaranteed rewards waiting! 🚀' },
        { title: '💳 LOW BALANCE?', body: 'Top up now and never miss a match. Every deposit = more chances to WIN! 💰' },
        { title: '🏆 DEPOSIT & WIN!', body: 'Players who deposit today are earning 2x more. Don\'t get left behind! 🔥' },
        { title: '💰 ADD MONEY, WIN MORE!', body: 'Big matches need big entries. Deposit now and compete for REAL prizes! 🏆' },
        { title: '⚡ FUND YOUR WINS!', body: 'Your wallet is ready — add funds and start winning today! 💰' },
        { title: '💳 QUICK DEPOSIT!', body: 'It takes 30 seconds to add money. Start playing within minutes! 🎮' },
        { title: '🤑 INVEST IN YOUR SKILLS!', body: 'Small deposit, big returns. Top players started with just ₹10! 💰' },
        { title: '💰 MATCHES WON\'T WAIT!', body: 'Slots are filling up. Deposit now so you\'re ready when your match drops! ⚡' },
        { title: '🔥 MONEY MAKES MONEY!', body: 'Every ₹10 you deposit could become ₹100. Start earning NOW! 💰' },
        { title: '💳 READY TO PLAY?', body: 'Just add funds & you\'re in! Quick deposits, instant play, real wins! 🚀' },
    ],



    // ═══════════════════════════════════════════════════════
    // 6. GENERAL HYPE & FOMO
    // ═══════════════════════════════════════════════════════

    general_hype: [
        { title: '🏆 WINNERS ARE PLAYING NOW!', body: 'Players are winning real cash RIGHT NOW. Will you be next? 🔥' },
        { title: '🔥 DON\'T MISS TODAY\'S PRIZES!', body: 'Big prize pools available right now. Join and win! 💰' },
        { title: '🎰 MORE MATCHES, MORE WINS!', body: 'New matches just dropped! Join and start earning today 🚀' },
        { title: '💰 KEEP EARNING!', body: 'More matches = more chances. Don\'t stop now! 🔥' },
        { title: '🚀 MATCHES DROPPING!', body: 'Stay active — new matches can drop anytime! ⚡' },
        { title: '🔥 YOUR SKILLS = REAL CASH!', body: 'Stop watching others win. Join a match and prove yourself! 💪' },
        { title: '🏆 TODAY\'S TOP PRIZE!', body: 'Someone is going to win BIG today. Make it YOU! 🔥' },
        { title: '💥 COMPETITION IS HEATING UP!', body: 'More players joining every hour. Get in while you can! ⚡' },
        { title: '🎮 WHAT ARE YOU WAITING FOR?', body: 'Real matches. Real prizes. Real players. Join NOW! 🚀' },
        { title: '🔥 CASH IS CALLING!', body: 'Your next win is just one match away. Are you ready? 💰' },
    ],

    // ═══════════════════════════════════════════════════════
    // 7. NEW MATCHES ALERT
    // ═══════════════════════════════════════════════════════

    new_matches: [
        { title: '🆕 NEW MATCHES ADDED!', body: '{count} new matches just went live! Check them out now 🚀' },
        { title: '⚡ FRESH MATCHES!', body: '{count} new matches dropped — join before they fill up! 🔥' },
        { title: '🎮 MORE ACTION!', body: '{count} new matches are LIVE! More chances to win 💰' },
        { title: '🆕 JUST ADDED!', body: 'New matches available NOW — {count} slots waiting for you! ⚡' },
        { title: '🔥 HOT OFF THE PRESS!', body: '{count} brand new matches just went live. Be the first to join! 🚀' },
    ],

    // ═══════════════════════════════════════════════════════
    // 8. TOMORROW PREVIEW (sent in evening)
    // ═══════════════════════════════════════════════════════

    tomorrow_preview: [
        { title: '📅 TOMORROW\'S MATCHES!', body: '{count} matches scheduled for tomorrow! Plan your lineup now 🗓️' },
        { title: '🗓️ GET READY FOR TOMORROW!', body: '{count} exciting matches dropping tomorrow. Early joiners get the best slots! 🔥' },
        { title: '📅 TOMORROW = BIG DAY!', body: '{count} matches coming tomorrow with huge prizes. Set your alarm! ⏰' },
        { title: '🗓️ PLAN YOUR WINS!', body: 'Tomorrow has {count} matches lined up. Deposit now, play tomorrow! 💰' },
    ],

    // ═══════════════════════════════════════════════════════
    // 9. WEEKEND SPECIAL
    // ═══════════════════════════════════════════════════════

    weekend_special: [
        { title: '🎉 WEEKEND WARRIORS!', body: 'It\'s the weekend! More matches, bigger prizes, better vibes! 🔥' },
        { title: '🎊 WEEKEND SPECIAL!', body: 'Weekend matches are STACKED with prizes. Don\'t waste your day off — PLAY! 💰' },
        { title: '🎉 SATURDAY/SUNDAY SLAM!', body: 'Weekend = unlimited play time. Join matches all day and WIN! 🏆' },
        { title: '🎊 WEEKEND MODE ON!', body: 'Extra matches this weekend! More games, more prizes, more fun! 🚀' },
    ],

    // ═══════════════════════════════════════════════════════
    // 12. NEXT DAY PUSH (10 PM to midnight — drive tomorrow's registrations)
    // ═══════════════════════════════════════════════════════

    next_day_push: [
        { title: '🌙 TOMORROW\'S MATCHES ARE OPEN!', body: 'Secure your slot for tomorrow\'s matches right now. Early birds grab the best spots! 🔥' },
        { title: '🔔 DON\'T MISS TOMORROW!', body: 'Register for tomorrow\'s matches before they fill up. Limited slots available! ⚡' },
        { title: '📅 PLAN YOUR WINS TONIGHT!', body: 'Check out tomorrow\'s match lineup. Pre-register now and wake up ready to play! 💰' },
        { title: '🌟 TOMORROW\'S PRIZE POOLS!', body: 'Massive prizes dropping tomorrow. Join now while slots are wide open! 🏆' },
        { title: '🔥 REGISTER TONIGHT!', body: 'Smart players register the night before. Be first in line for tomorrow\'s matches! 🚀' },
        { title: '🎯 GET AHEAD OF THE CROWD!', body: 'Tomorrow\'s matches filling fast. Register NOW before your favorite slot is gone! ⏰' },
        { title: '💡 PRO TIP: REGISTER EARLY!', body: 'Top players always register the night before. Secure your spot for tomorrow! 💪' },
        { title: '🌙 NIGHT OWL ADVANTAGE!', body: 'You\'re up late? Great! Register for tomorrow\'s matches now — zero competition! 🔥' },
        { title: '🏆 TOMORROW = YOUR DAY!', body: 'Big matches, big prizes coming tomorrow. Register now & add funds before the rush! 💰' },
        { title: '📱 BEFORE YOU SLEEP...', body: 'Quick — join tomorrow\'s matches now. Wake up, play, WIN! Goodnight 🌙💰' },
    ],

    // ═══════════════════════════════════════════════════════
    // 10. SOCIAL PROOF / WIN HYPE
    // ═══════════════════════════════════════════════════════

    social_proof: [
        { title: '🤑 PLAYERS ALREADY WON TODAY!', body: 'Real cash. Real players. Real wins. Your turn next! 💰' },
        { title: '🏆 SOMEONE JUST WON BIG!', body: 'A player just won a huge prize! Next could be YOU! 🔥' },
        { title: '💰 WINNINGS FLOWING!', body: 'Cash prizes being distributed right now. Join and grab yours! 🚀' },
        { title: '🎉 WINNERS EVERYWHERE!', body: 'Multiple players cashed out today. What are YOU waiting for? 💪' },
        { title: '🤑 CASH RAINING!', body: 'Players are withdrawing their winnings right now. Join and be next! 💰' },
    ],

    // ═══════════════════════════════════════════════════════
    // 11. TOURNAMENT HYPE
    // ═══════════════════════════════════════════════════════

    tournament_hype: [
        { title: '🏆 TOURNAMENTS OPEN!', body: 'Register for upcoming tournaments — massive prize pools! 🔥' },
        { title: '🏆 TOURNAMENT TIME!', body: 'Compete against the best. Register now & win BIG! 💰' },
        { title: '🎯 PROVE YOUR SKILLS!', body: 'Tournaments are where champions are made. Register NOW! 🏆' },
        { title: '🏆 BIG STAGE, BIG PRIZES!', body: 'Tournament registrations open — don\'t miss your shot at glory! 🔥' },
    ],
};

// ─── TEMPLATE VARIABLE REPLACEMENT ──────────────────────────

function fillTemplate(msg, vars) {
    let title = msg.title;
    let body = msg.body;
    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        title = title.replace(regex, String(value));
        body = body.replace(regex, String(value));
    }
    return { title, body };
}

// ─── CORE: Send Broadcast via Topic ─────────────────────────

async function sendBroadcast(title, body, notifType, extraData = {}) {
    try {
        const message = {
            notification: { title, body },
            data: {
                type: notifType,
                title, body,
                autoGenerated: 'true',
                ...Object.fromEntries(
                    Object.entries(extraData).map(([k, v]) => [k, String(v)])
                )
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'jeetoplay_promo',
                    priority: 'high',
                    defaultSound: true,
                    defaultVibrateTimings: true
                }
            },
            webpush: {
                headers: { Urgency: 'high' },
                notification: {
                    icon: '/assets/images/icon-192.png',
                    badge: '/assets/images/badge-72.png',
                    vibrate: [200, 100, 200]
                }
            },
            topic: 'all_users'
        };

        await admin.messaging().send(message);
        functions.logger.info(`[SmartNotif] Broadcast sent: ${title}`);

        // Save to admin_notifications for history
        const notifId = db.ref('admin_notifications').push().key;
        await db.ref('admin_notifications/' + notifId).set({
            id: notifId,
            title, body,
            type: notifType,
            sender: 'smart_system',
            autoGenerated: true,
            sentAt: new Date().toISOString(),
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        return true;
    } catch (err) {
        functions.logger.error(`[SmartNotif] Broadcast failed: ${err.message}`);
        return false;
    }
}

// ─── DEDUPLICATION & THROTTLE ───────────────────────────────

/**
 * Check if a notification can be sent (dedup + daily cap + cooldown)
 * @param {string} dateStr - Today's date (YYYY-MM-DD)
 * @param {string} key - Unique notification key
 * @param {object} config - Smart notification config from admin panel
 */
async function canSend(dateStr, key, config) {
    const trackRef = db.ref(`smart_notif_tracking/${dateStr}`);
    const trackSnap = await trackRef.once('value');
    const tracking = trackSnap.val() || {};

    // Already sent this specific notification today?
    if (tracking[key]) return false;

    // Daily cap check
    const totalSent = tracking.totalSent || 0;
    const dailyCap = config.dailyCap || 30;
    if (totalSent >= dailyCap) {
        functions.logger.info(`[SmartNotif] Daily cap (${dailyCap}) reached, skipping ${key}`);
        return false;
    }

    // Cooldown check (minimum gap between ANY two notifications)
    const lastSentAt = tracking.lastSentAt || 0;
    const cooldownMs = (config.cooldownMinutes || 15) * 60 * 1000;
    if (lastSentAt && (Date.now() - lastSentAt) < cooldownMs) {
        functions.logger.info(`[SmartNotif] Cooldown active (${config.cooldownMinutes || 15} min), skipping ${key}`);
        return false;
    }

    return true;
}

async function markSent(dateStr, key) {
    const trackRef = db.ref(`smart_notif_tracking/${dateStr}`);
    await trackRef.child(key).set(Date.now());
    await trackRef.child('lastSentAt').set(Date.now());

    // Increment totalSent atomically
    await trackRef.child('totalSent').transaction(val => (val || 0) + 1);
}

// ─── CATEGORY ENABLED CHECK ────────────────────────────────

function isCategoryEnabled(config, category) {
    if (!config.enabled) return false;
    const cats = config.categories || {};
    // Default to enabled if not explicitly set to false
    return cats[category] !== false;
}

// ─── THE ENGINE ─────────────────────────────────────────────

exports.smartNotificationEngine = functions.pubsub
    .schedule('every 10 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        // Load config
        const configSnap = await db.ref('platform_config/smart_notifications').once('value');
        const config = configSnap.val() || { enabled: true, dailyCap: 30, cooldownMinutes: 15 };

        if (!config.enabled) {
            functions.logger.info('[SmartNotif] System disabled via config');
            return null;
        }

        const now = getISTNow();
        const dateStr = getISTDateStr(now);
        const hour = getISTHour(now);
        const minute = getISTMinute(now);
        const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat

        let notificationsSent = 0;

        /**
         * Priority Queue System:
         * Instead of sending notifications immediately, we collect ALL candidates
         * into a queue, then send ONLY the highest-priority one per cycle.
         * This prevents spam while ensuring urgent alerts (last slot, starting soon) always win.
         *
         * Priority Levels:
         *   5 = Final slot / Match in 15 min (most urgent)
         *   4 = 90%+ full / Match in 60 min
         *   3 = 80%+ full
         *   2 = 75%/60% full / Tournament / Social proof
         *   1 = Time-based hype, deposit, general (lowest)
         */
        const notifQueue = [];

        // Helper: add a notification candidate to the priority queue
        const queueNotif = (key, category, messagePool, templateVars = {}, extraData = {}, priority = 1) => {
            if (!isCategoryEnabled(config, category)) return;
            notifQueue.push({ key, category, messagePool, templateVars, extraData, priority });
        };

        // Helper: attempt to send a notification with dedup (used at the end to send winner)
        const trySend = async (key, category, messagePool, templateVars = {}, extraData = {}) => {
            if (!(await canSend(dateStr, key, config))) return false;

            const msg = pick(messagePool);
            const { title, body } = templateVars ? fillTemplate(msg, templateVars) : msg;
            const sent = await sendBroadcast(title, body, `SMART_${category.toUpperCase()}`, extraData);

            if (sent) {
                await markSent(dateStr, key);
                notificationsSent++;
                return true;
            }
            return false;
        };

        // ═══════════════════════════════════════════════════
        // 1. TIME-BASED DAILY ENGAGEMENT — Queue with Priority 1
        //    Schedule: 8 AM build-up → 10 AM-10 PM peak → 10 PM-midnight next-day push
        // ═══════════════════════════════════════════════════

        // ── PRE-MATCH BUILD-UP (8 AM - 10 AM) ──

        if (hour === 8 && minute < 20) {
            queueNotif('early_morning', 'morning_hype', MESSAGES.morning_hype, {}, {}, 1);
        }
        if (hour === 9 && minute < 20) {
            queueNotif('morning_boost', 'morning_hype', MESSAGES.deposit_motivation, {}, {}, 1);
        }
        if (hour === 9 && minute >= 30 && minute < 50) {
            queueNotif('morning_ready', 'morning_hype', MESSAGES.general_hype, {}, {}, 1);
        }

        // ── PEAK MATCH HOURS (10 AM - 10 PM) ──

        if (hour === 10 && minute < 20) {
            queueNotif('morning_live', 'morning_hype', MESSAGES.morning_hype, {}, {}, 1);
        }
        if (hour === 11 && minute < 20) {
            queueNotif('tournament_morning', 'tournament_hype', MESSAGES.tournament_hype, {}, {}, 1);
        }
        if (hour === 11 && minute >= 30 && minute < 50) {
            queueNotif('deposit_morning', 'deposit_motivation', MESSAGES.deposit_motivation, {}, {}, 1);
        }
        if (hour === 12 && minute < 20) {
            queueNotif('afternoon_grind', 'afternoon_grind', MESSAGES.afternoon_grind, {}, {}, 1);
        }
        if (hour === 13 && minute < 20) {
            queueNotif('hype_afternoon', 'general_hype', MESSAGES.general_hype, {}, {}, 1);
        }
        if (hour === 14 && minute < 20) {
            queueNotif('afternoon_boost', 'afternoon_grind', MESSAGES.general_hype, {}, {}, 1);
        }
        if (hour === 15 && minute < 20) {
            queueNotif('deposit_afternoon', 'deposit_motivation', MESSAGES.deposit_motivation, {}, {}, 1);
        }
        if (hour === 15 && minute >= 30 && minute < 50) {
            queueNotif('social_afternoon', 'social_proof', MESSAGES.social_proof, {}, {}, 2);
        }
        if (hour === 16 && minute < 20) {
            queueNotif('evening_matches', 'evening_matches', MESSAGES.evening_matches, {}, {}, 1);
        }
        if (hour === 17 && minute < 20) {
            queueNotif('evening_boost', 'evening_matches', MESSAGES.general_hype, {}, {}, 1);
        }
        if (hour === 18 && minute < 20) {
            queueNotif('deposit_evening', 'deposit_motivation', MESSAGES.deposit_motivation, {}, {}, 1);
        }
        if (hour === 18 && minute >= 30 && minute < 50) {
            queueNotif('social_evening', 'social_proof', MESSAGES.social_proof, {}, {}, 2);
        }
        if (hour === 19 && minute < 20) {
            queueNotif('prime_time', 'prime_time', MESSAGES.prime_time, {}, {}, 1);
        }
        if (hour === 20 && minute < 20) {
            queueNotif('prime_boost', 'prime_time', MESSAGES.social_proof, {}, {}, 1);
        }
        if (hour === 21 && minute < 20) {
            queueNotif('night_final', 'night_final', MESSAGES.night_final, {}, {}, 1);
        }
        if (hour === 21 && minute >= 30 && minute < 50) {
            queueNotif('night_last_call', 'night_final', MESSAGES.general_hype, {}, {}, 1);
        }

        // ── NEXT DAY PUSH (10 PM - 11:59 PM) ──

        if (hour === 22 && minute < 20) {
            queueNotif('nextday_10pm', 'next_day_push', MESSAGES.next_day_push, {}, {}, 1);
        }
        if (hour === 22 && minute >= 30 && minute < 50) {
            queueNotif('nextday_deposit', 'next_day_push', MESSAGES.deposit_motivation, {}, {}, 1);
        }
        if (hour === 23 && minute < 20 && isCategoryEnabled(config, 'tomorrow_preview')) {
            try {
                const tmw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                const tmwStr = tmw.toISOString().slice(0, 10);
                const allM = await db.ref('esports_matches').orderByChild('status').equalTo('UPCOMING').once('value');
                let cnt = 0;
                if (allM.exists()) {
                    allM.forEach(c => { if (c.val().dateTime && c.val().dateTime.startsWith(tmwStr)) cnt++; });
                }
                if (cnt > 0) {
                    queueNotif('nextday_preview_11pm', 'tomorrow_preview', MESSAGES.tomorrow_preview, { count: cnt }, {}, 1);
                } else {
                    queueNotif('nextday_11pm', 'next_day_push', MESSAGES.next_day_push, {}, {}, 1);
                }
            } catch (err) {
                functions.logger.error(`[SmartNotif] 11 PM next-day preview error: ${err.message}`);
            }
        }
        if (hour === 23 && minute >= 30 && minute < 50) {
            queueNotif('nextday_goodnight', 'next_day_push', MESSAGES.next_day_push, {}, {}, 1);
        }

        // Weekend special
        if ((dayOfWeek === 0 || dayOfWeek === 6) && hour === 10 && minute < 20) {
            queueNotif('weekend_special', 'weekend_special', MESSAGES.weekend_special, {}, {}, 1);
        }
        if ((dayOfWeek === 0 || dayOfWeek === 6) && hour === 20 && minute >= 30 && minute < 50) {
            queueNotif('weekend_evening', 'weekend_special', MESSAGES.weekend_special, {}, {}, 1);
        }

        // ═══════════════════════════════════════════════════
        // 2. MATCH SLOT-FILL ALERTS — Queue with smart priority
        // ═══════════════════════════════════════════════════

        if (isCategoryEnabled(config, 'slot_fill')) {
            try {
                const matchesSnap = await db.ref('esports_matches')
                    .orderByChild('status').equalTo('UPCOMING')
                    .once('value');

                if (matchesSnap.exists()) {
                    matchesSnap.forEach(child => {
                        const match = child.val();
                        const matchId = child.key;
                        const max = match.maxParticipants || 100;
                        const current = match.participants ? Object.keys(match.participants).length : 0;
                        const remaining = max - current;
                        const fillPercent = max > 0 ? (current / max) * 100 : 0;

                        if (current === 0 || remaining <= 0) return;

                        const gameName = match.gameName || match.title || 'Match';
                        const type = match.type || 'Solo';
                        const time = formatMatchTime(match.dateTime);
                        const s = remaining === 1 ? '' : 's';
                        const vars = { gameName, type, time, remaining, s, slotsInfo: `${remaining} slot${s} left` };

                        // ── SMALL MATCHES (2-4 max) ──
                        if (max <= 4) {
                            if (remaining === 1) {
                                queueNotif(`slot_final_${matchId}`, 'slot_fill', MESSAGES.slot_final, vars, { matchId }, 5);
                            }
                        }
                        // ── MEDIUM MATCHES (5-16 max) ──
                        else if (max <= 16) {
                            if (remaining <= 2) {
                                queueNotif(`slot_final_${matchId}`, 'slot_fill', MESSAGES.slot_final, vars, { matchId }, 5);
                            } else if (fillPercent >= 75) {
                                queueNotif(`slot_75_${matchId}`, 'slot_fill', MESSAGES.slot_75, vars, { matchId }, 2);
                            }
                        }
                        // ── LARGE/BR MATCHES (17+ max) ──
                        else {
                            if (remaining <= 3) {
                                queueNotif(`slot_final_${matchId}`, 'slot_fill', MESSAGES.slot_final, vars, { matchId }, 5);
                            } else if (fillPercent >= 90) {
                                queueNotif(`slot_90_${matchId}`, 'slot_fill', MESSAGES.slot_90, vars, { matchId }, 4);
                            } else if (fillPercent >= 80) {
                                queueNotif(`slot_80_${matchId}`, 'slot_fill', MESSAGES.slot_90, vars, { matchId }, 3);
                            } else if (fillPercent >= 60) {
                                queueNotif(`slot_60_${matchId}`, 'slot_fill', MESSAGES.slot_75, vars, { matchId }, 1);
                            }
                        }
                    });
                }
            } catch (err) {
                functions.logger.error(`[SmartNotif] Slot-fill scan error: ${err.message}`);
            }
        }

        // ═══════════════════════════════════════════════════
        // 3. MATCH COUNTDOWN ALERTS — Queue with priority
        // ═══════════════════════════════════════════════════

        if (isCategoryEnabled(config, 'match_countdown')) {
            try {
                const matchesSnap = await db.ref('esports_matches')
                    .orderByChild('status').equalTo('UPCOMING')
                    .once('value');

                if (matchesSnap.exists()) {
                    const realNow = Date.now();

                    matchesSnap.forEach(child => {
                        const match = child.val();
                        const matchId = child.key;
                        const matchTimeMs = new Date(match.dateTime).getTime();
                        if (!matchTimeMs || isNaN(matchTimeMs)) return;

                        const minsUntil = (matchTimeMs - realNow) / 60000;
                        const max = match.maxParticipants || 100;
                        const current = match.participants ? Object.keys(match.participants).length : 0;
                        const remaining = max - current;

                        const gameName = match.gameName || match.title || 'Match';
                        const type = match.type || '';
                        const time = formatMatchTime(match.dateTime);
                        const slotsInfo = remaining > 0 ? `${remaining} slots still open!` : 'FULL!';
                        const vars = { gameName, type, time, slotsInfo, remaining };

                        // 60 min warning → Priority 3
                        if (minsUntil >= 55 && minsUntil <= 65 && remaining > 0) {
                            queueNotif(`countdown_60_${matchId}`, 'match_countdown', MESSAGES.countdown_60, vars, { matchId }, 3);
                        }
                        // 15 min warning → Priority 5 (very urgent)
                        else if (minsUntil >= 10 && minsUntil <= 20 && remaining > 0) {
                            queueNotif(`countdown_15_${matchId}`, 'match_countdown', MESSAGES.countdown_15, vars, { matchId }, 5);
                        }
                    });
                }
            } catch (err) {
                functions.logger.error(`[SmartNotif] Countdown scan error: ${err.message}`);
            }
        }

        // ═══════════════════════════════════════════════════
        // 4. NEW MATCHES ALERT — Queue with priority 2
        // ═══════════════════════════════════════════════════

        if (isCategoryEnabled(config, 'new_matches') && hour >= 8 && hour <= 23) {
            try {
                const tenMinAgo = Date.now() - 10 * 60 * 1000;
                const matchesSnap = await db.ref('esports_matches')
                    .orderByChild('createdAt')
                    .startAt(tenMinAgo)
                    .once('value');

                let newCount = 0;
                if (matchesSnap.exists()) {
                    matchesSnap.forEach(child => {
                        const m = child.val();
                        if (m.status === 'UPCOMING') newCount++;
                    });
                }

                if (newCount >= 3) {
                    queueNotif(`new_matches_${Math.floor(Date.now() / 600000)}`, 'new_matches',
                        MESSAGES.new_matches, { count: newCount }, {}, 2);
                }
            } catch (err) {
                functions.logger.error(`[SmartNotif] New matches check error: ${err.message}`);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  PRIORITY QUEUE RESOLUTION — Send only the BEST ONE per cycle
        // ═══════════════════════════════════════════════════════════════
        //
        // All candidates are collected above. Now we:
        // 1. Sort by priority (highest first)
        // 2. Try to send the top candidate
        // 3. If it's already been sent (dedup) or cooldown active, try the next
        // 4. Stop after ONE successful send per cycle
        //
        // This ensures:
        // - Max 1 notification per engine cycle (every 10 min)
        // - Cooldown from admin panel is respected (time between notifications)
        // - Urgent alerts (final slot, 15-min countdown) always win over hype
        // - Per-match dedup prevents repeat alerts on same threshold

        notifQueue.sort((a, b) => b.priority - a.priority);

        functions.logger.info(`[SmartNotif] Queue has ${notifQueue.length} candidates. Attempting to send top priority...`);

        for (const candidate of notifQueue) {
            const sent = await trySend(
                candidate.key, candidate.category,
                candidate.messagePool, candidate.templateVars,
                candidate.extraData
            );
            if (sent) {
                functions.logger.info(`[SmartNotif] ✅ Sent: "${candidate.key}" (priority ${candidate.priority}, category: ${candidate.category})`);
                break; // Only 1 notification per cycle
            }
            // If not sent (dedup/cooldown), try next candidate
        }

        functions.logger.info(`[SmartNotif] Engine completed. ${notificationsSent} notification(s) sent this cycle (${dateStr})`);
        return null;
    });
