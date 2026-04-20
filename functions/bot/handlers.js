/**
 * bot/handlers.js — FAQ + Escalation handlers for JeetoPlay Support Bot
 * 
 * NO database access. Pure auto-reply system.
 * - FAQ queries answered automatically
 * - Critical issues forwarded to admin Telegram group
 * - Match/result issues always escalated to human
 */

const { detectIntent } = require('./nlp');

// ─── Inline Keyboards ──────────────────────────────────────

const MAIN_MENU = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '🎮 Game Guide', callback_data: 'menu_game' },
                { text: '💰 Money Help', callback_data: 'menu_money' }
            ],
            [
                { text: '🎫 Report Issue', callback_data: 'menu_support' },
                { text: '❓ FAQ', callback_data: 'menu_faq' }
            ]
        ]
    }
};

const GAME_MENU = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '🎲 Ludo Rules', callback_data: 'faq_ludo' },
                { text: '🎮 eSports Guide', callback_data: 'faq_esports' }
            ],
            [
                { text: '🏆 Tournaments', callback_data: 'faq_tournament' },
                { text: '🎰 Spin & Earn', callback_data: 'faq_spin' }
            ],
            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
        ]
    }
};

const MONEY_MENU = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '💳 How to Deposit', callback_data: 'faq_deposit' },
                { text: '💸 How to Withdraw', callback_data: 'faq_withdraw' }
            ],
            [
                { text: '🔄 Refund Policy', callback_data: 'faq_refund' },
                { text: '👑 VIP Benefits', callback_data: 'faq_vip' }
            ],
            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
        ]
    }
};

const SUPPORT_MENU = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '💳 Deposit Issue', callback_data: 'issue_deposit' },
                { text: '💸 Withdrawal Issue', callback_data: 'issue_withdrawal' }
            ],
            [
                { text: '🎮 Match/Result Issue', callback_data: 'issue_match' },
                { text: '🔒 Account Issue', callback_data: 'issue_account' }
            ],
            [
                { text: '❓ Other Issue', callback_data: 'issue_other' }
            ],
            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
        ]
    }
};

const FAQ_MENU = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '💳 Deposit Kaise Kare?', callback_data: 'faq_deposit' },
                { text: '💸 Withdraw Kaise Kare?', callback_data: 'faq_withdraw' }
            ],
            [
                { text: '🎲 Ludo Kaise Khele?', callback_data: 'faq_ludo' },
                { text: '🎮 eSports Kaise Join Kare?', callback_data: 'faq_esports' }
            ],
            [
                { text: '📲 App Download', callback_data: 'faq_download' },
                { text: '🎁 Referral Program', callback_data: 'faq_referral' }
            ],
            [
                { text: '🔄 Refund Policy', callback_data: 'faq_refund' },
                { text: '👑 VIP Membership', callback_data: 'faq_vip' }
            ],
            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
        ]
    }
};

const BACK_TO_MAIN = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
        ]
    }
};

// ─── Session Store (in-memory, no database) ─────────────────
// For Cloud Functions, each invocation is stateless, so we use
// a simple in-memory map that persists across warm invocations.
// For critical flows, we encode state in callback_data.

const sessions = new Map();

function getSession(chatId) {
    return sessions.get(chatId) || { state: 'IDLE' };
}

function setSession(chatId, data) {
    sessions.set(chatId, { ...data, lastActivity: Date.now() });
    // Auto-cleanup old sessions (>30 min)
    if (sessions.size > 1000) {
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [k, v] of sessions) {
            if (v.lastActivity < cutoff) sessions.delete(k);
        }
    }
}

function clearSession(chatId) {
    sessions.delete(chatId);
}

// ─── FAQ Responses (Bilingual: Hindi + English) ─────────────

const FAQ_RESPONSES = {
    faq_ludo: 
        `🎲 *Ludo Kaise Khele? / How to Play Ludo*\n\n` +
        `1️⃣ App kholein → *Ludo* section mein jayein\n` +
        `    Open app → Go to *Ludo* section\n\n` +
        `2️⃣ Entry fee choose karein (🪙 10 se 🪙 10,000)\n` +
        `    Choose entry fee (🪙 10 to 🪙 10,000)\n\n` +
        `3️⃣ Challenge create karein ya kisi ka accept karein\n` +
        `    Create a challenge or accept one\n\n` +
        `4️⃣ Match pair hone ke baad *Ludo King* app mein room banayein\n` +
        `    After pairing, create room in *Ludo King* app\n\n` +
        `5️⃣ Room code JeetoPlay mein share karein\n` +
        `    Share room code on JeetoPlay\n\n` +
        `6️⃣ Ludo King mein game khelein\n` +
        `    Play the game on Ludo King\n\n` +
        `7️⃣ Result submit karein (Won/Lost/Dispute)\n` +
        `    Submit your result\n\n` +
        `🏆 *Winner ko prize pool milta hai!*\n` +
        `⚠️ *Hamesha game ka screenshot lein!*\n` +
        `    Always take screenshots of your game result!`,

    faq_esports:
        `🎮 *eSports Kaise Khele? / How to Play eSports*\n\n` +
        `1️⃣ App mein *eSports* section kholein\n` +
        `    Open *eSports* section in app\n\n` +
        `2️⃣ Upcoming match choose karein (BGMI, Free Fire, etc.)\n` +
        `    Browse upcoming matches\n\n` +
        `3️⃣ Entry fee dekar slot book karein\n` +
        `    Book a slot by paying entry fee\n\n` +
        `4️⃣ Match se 30 min pehle Room ID + Password milega\n` +
        `    Room ID + Password sent 30 min before match\n\n` +
        `5️⃣ Game mein room join karein aur khelein\n` +
        `    Join the room and play\n\n` +
        `6️⃣ Admin results declare karega\n` +
        `    Results declared by admin\n\n` +
        `7️⃣ Jeetne par paisa wallet mein auto-credit!\n` +
        `    Winnings auto-credited!\n\n` +
        `📊 Prize distribution: Per Kill / Survival / Position`,

    faq_tournament:
        `🏆 *Tournament Kaise Khelein? / Tournaments*\n\n` +
        `• Deadline se pehle register karein\n` +
        `  Register before the deadline\n\n` +
        `• Do format: *Lobby Elimination* & *Bracket*\n` +
        `  Two formats available\n\n` +
        `• Multiple rounds, badhte prizes\n` +
        `  Multiple rounds with increasing prizes\n\n` +
        `• Har round se pehle room details milenge\n` +
        `  Room details sent before each round\n\n` +
        `• Top players ko bade prizes!\n` +
        `  Top players win big prizes!\n\n` +
        `📱 App mein *Tournaments* section check karein.`,

    faq_deposit:
        `💳 *Deposit Kaise Kare? / How to Deposit*\n\n` +
        `1️⃣ App kholein → *Wallet* tap karein\n` +
        `    Open app → Tap *Wallet*\n\n` +
        `2️⃣ Amount daalein\n` +
        `    Enter amount\n\n` +
        `3️⃣ UPI/Bank se payment karein\n` +
        `    Pay via UPI/Bank\n\n` +
        `4️⃣ Balance 1-2 minute mein update hoga\n` +
        `    Balance updates in 1-2 minutes\n\n` +
        `⚠️ *Agar deposit reflect nahi ho raha:*\n` +
        `• 5-10 minute wait karein\n` +
        `  Wait 5-10 minutes\n` +
        `• App mein "Check Deposit" tap karein\n` +
        `  Tap "Check Deposit" in app\n` +
        `• Phir bhi nahi hua toh support mein report karein\n` +
        `  If still pending, report in support`,

    faq_withdraw:
        `💸 *Withdraw Kaise Kare? / How to Withdraw*\n\n` +
        `1️⃣ App → Wallet → *Withdraw* tap karein\n` +
        `    Open app → Wallet → *Withdraw*\n\n` +
        `2️⃣ Amount aur UPI ID daalein\n` +
        `    Enter amount and UPI ID\n\n` +
        `3️⃣ Request submit karein\n` +
        `    Submit the request\n\n` +
        `4️⃣ Admin 24 ghante mein review karega\n` +
        `    Admin reviews within 24 hours\n\n` +
        `5️⃣ UPI/Bank mein paisa aa jayega\n` +
        `    Money transferred to your UPI/Bank\n\n` +
        `📋 *Rules:*\n` +
        `• Sirf *Winning Balance* withdraw hota hai\n` +
        `  Only Winning Balance can be withdrawn\n` +
        `• Din mein max 3 withdrawals\n` +
        `  Max 3 withdrawals per day\n` +
        `• Account 24+ ghante purana hona chahiye\n` +
        `  Account must be 24+ hours old`,

    faq_refund:
        `🔄 *Refund Policy*\n\n` +
        `✅ *Automatic Refunds / Auto Refund:*\n` +
        `• Match cancel → Entry fee turant refund\n` +
        `  Match cancelled → Instant refund\n` +
        `• Match expire → Entry fee turant refund\n` +
        `  Match expired → Instant refund\n` +
        `• Withdrawal reject → Winning balance mein refund\n` +
        `  Withdrawal rejected → Refund to winning balance\n\n` +
        `⏳ *Deposit Failures:*\n` +
        `• Payment gateway fail → Bank 24-48 hrs mein auto-refund karega\n` +
        `  Gateway failure → Bank auto-refunds in 24-48 hours\n` +
        `• Bank se kata lekin credit nahi → Support mein report\n` +
        `  Deducted but not credited → Report in support\n\n` +
        `❌ *Non-Refundable:*\n` +
        `• Completed matches (winner declared ho chuka)\n` +
        `• VIP membership purchase`,

    faq_vip:
        `👑 *VIP Membership*\n\n` +
        `• Har deposit par *5% bonus* 🎉\n` +
        `  Extra 5% on every deposit\n` +
        `• Profile par VIP Badge\n` +
        `  VIP Badge on your profile\n` +
        `• Priority support\n\n` +
        `📱 App → Profile → VIP section se purchase karein\n` +
        `   Buy from App → Profile → VIP section`,

    faq_spin:
        `🎰 *Spin & Earn*\n\n` +
        `• Ads dekhkar free spins earn karein\n` +
        `  Watch ads to earn free spins\n` +
        `• Wheel spin karein aur coins jeetein!\n` +
        `  Spin the wheel and win coins!\n` +
        `• Daily limits apply\n` +
        `• Prizes: 🪙 1 se 🪙 100+ tak`,

    faq_download:
        `📲 *App Download*\n\n` +
        `🔗 Website: https://jeetoplay.in\n\n` +
        `Website se latest APK download karein.\n` +
        `Download the latest APK from our website.\n\n` +
        `Install karein aur real cash jeeten! 🏆`,

    faq_referral:
        `🎁 *Referral Program*\n\n` +
        `• App mein apna referral link share karein\n` +
        `  Share your referral link from the app\n\n` +
        `• Dost sign up kare aur 3 games khele\n` +
        `  Friend signs up and completes 3 games\n\n` +
        `• Dono ko bonus coins milenge! 🎉\n` +
        `  Both of you earn bonus coins!\n\n` +
        `📱 App → Profile → *Refer & Earn* mein link milega`
};

// ─── Issue Response Templates ───────────────────────────────

const ISSUE_RESPONSES = {
    issue_deposit:
        `💳 *Deposit Issue / Deposit Problem*\n\n` +
        `Agar aapka deposit reflect nahi ho raha:\n` +
        `If your deposit is not reflecting:\n\n` +
        `1️⃣ *5-10 minute wait karein* — kabhi kabhi gateway mein delay hota hai\n` +
        `    Wait 5-10 minutes — gateway sometimes delays\n\n` +
        `2️⃣ App mein *"Check Deposit"* button dabayein\n` +
        `    Tap "Check Deposit" in the app\n\n` +
        `3️⃣ Check karein kya bank/UPI se paisa kata hai\n` +
        `    Check if money was deducted from bank/UPI\n\n` +
        `*Agar bank se kata hai lekin balance nahi aaya:*\n` +
        `If deducted from bank but not credited:\n\n` +
        `👇 Neeche tap karke humein yeh details bhejein:\n` +
        `    Tap below and send us these details:\n` +
        `• Amount kitna tha? / Amount\n` +
        `• Kab deposit kiya? / When\n` +
        `• UPI app ka naam / UPI app name\n` +
        `• Transaction ID / UTR number (agar ho toh)`,

    issue_withdrawal:
        `💸 *Withdrawal Issue / Withdrawal Problem*\n\n` +
        `📋 *Withdrawal Process:*\n` +
        `• Request submit → Admin review → Approve/Reject\n` +
        `• Usually 24 ghante mein process hota hai\n` +
        `  Usually processed within 24 hours\n\n` +
        `*Common Issues:*\n\n` +
        `⏳ *PENDING* — Admin abhi review karega, wait karein\n` +
        `   Admin will review soon, please wait\n\n` +
        `🔍 *FLAGGED* — Security review mein hai\n` +
        `   Under security review\n\n` +
        `❌ *REJECTED* — Amount winning balance mein wapas aa gaya\n` +
        `   Amount refunded to winning balance\n\n` +
        `*Agar 24+ ghante se pending hai:*\n` +
        `If pending for more than 24 hours:\n` +
        `👇 Neeche tap karke agent se baat karein`,

    issue_match:
        `🎮 *Match / Result Issue*\n\n` +
        `⚠️ Match aur result ke issues admin team handle karti hai.\n` +
        `    Match and result issues are handled by the admin team.\n\n` +
        `Kripya neeche tap karke humein yeh details bhejein:\n` +
        `Please tap below and send us:\n\n` +
        `• Match ID kya hai? (app mein dekh sakte hain)\n` +
        `  What is the Match ID? (visible in the app)\n` +
        `• Kya issue hai? (wrong result / cheating / cancel)\n` +
        `  What's the issue? (wrong result / cheating / cancel)\n` +
        `• Game ka screenshot bhejein\n` +
        `  Send game screenshot\n\n` +
        `📸 *Screenshot bahut zaroori hai — bina screenshot ke resolve nahi hoga!*\n` +
        `    Screenshot is very important — cannot resolve without it!`,

    issue_account:
        `🔒 *Account Issue*\n\n` +
        `*Common Account Problems:*\n\n` +
        `🔐 *Login nahi ho raha / Can't Login:*\n` +
        `• Sahi mobile number use karein\n` +
        `  Use the correct mobile number\n` +
        `• OTP nahi aa raha → thodi der baad try karein\n` +
        `  OTP not coming → try after some time\n\n` +
        `🚫 *Account Blocked / Suspended:*\n` +
        `• App mein reason dikhega\n` +
        `  Reason shown in the app\n` +
        `• Appeal ke liye neeche tap karein\n` +
        `  Tap below to appeal\n\n` +
        `👇 Agent se baat karne ke liye tap karein:`,

    issue_other:
        `❓ *Other Issue*\n\n` +
        `Apna issue detail mein describe karein.\n` +
        `Please describe your issue in detail.\n\n` +
        `Jitna detail denge, utna jaldi solve hoga! 👇`
};

// ─── Escalation: Forward to Admin Group ─────────────────────

async function escalateToAdmin(ctx, category, userMessage, adminGroupId) {
    if (!adminGroupId) {
        return ctx.reply(
            `🎫 *Aapka issue note kar liya!*\n` +
            `    Your issue has been noted!\n\n` +
            `Hamari support team jaldi se jaldi respond karegi.\n` +
            `Our support team will respond as soon as possible.\n\n` +
            `⏰ Response time: *2-4 hours* (10 AM - 10 PM IST)\n\n` +
            `_Kripya dhairya rakhein. / Please be patient._`,
            { parse_mode: 'Markdown', ...BACK_TO_MAIN }
        );
    }

    try {
        const userName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'User';
        const userHandle = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
        const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const userId = ctx.from.id;

        const adminMsg =
            `🎫 *NEW SUPPORT REQUEST*\n\n` +
            `👤 *User:* [${userName}](tg://user?id=${userId}) (${userHandle})\n` +
            `🆔 *Telegram ID:* \`${userId}\`\n` +
            `📂 *Category:* ${category}\n` +
            `🕐 *Time:* ${time}\n` +
            `💬 *Message:*\n${userMessage || 'No details provided'}\n\n` +
            `_Reply to this message to respond to the user._`;

        await ctx.telegram.sendMessage(adminGroupId, adminMsg, { parse_mode: 'Markdown' });

        return ctx.reply(
            `✅ *Aapka issue support team ko forward kar diya!*\n` +
            `    Your issue has been forwarded to support team!\n\n` +
            `🎫 Category: *${category}*\n` +
            `⏰ Expected response: *2-4 hours* (10 AM - 10 PM IST)\n\n` +
            `Aapko yahi chat mein reply milega.\n` +
            `You'll receive a reply right here.\n\n` +
            `_Kuch aur poochna ho toh baat karein! / Ask anything else!_`,
            { parse_mode: 'Markdown', ...MAIN_MENU }
        );
    } catch (err) {
        console.error('Failed to forward to admin group:', err.message);
        return ctx.reply(
            `⚠️ Error forwarding your issue. Please try again or contact:\n` +
            `📧 support@jeetoplay.in`,
            MAIN_MENU
        );
    }
}

// ─── Text Message Router (NLP-based) ────────────────────────

async function handleTextMessage(ctx, adminGroupId) {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // Skip bot commands
    if (text.startsWith('/')) return;

    // Check if user is in an issue reporting flow
    const session = getSession(chatId);

    if (session.state === 'AWAITING_ISSUE_DETAILS') {
        clearSession(chatId);
        return escalateToAdmin(ctx, session.category, text, adminGroupId);
    }

    // NLP intent detection (keyword first, then Gemini AI fallback)
    const { intent, confidence } = await detectIntent(text);

    if (confidence < 0.1) {
        // Very low confidence — show helpful menu
        return ctx.reply(
            `🤔 *Main samajh nahi paaya / I didn't quite understand*\n\n` +
            `Aap yeh try kar sakte hain:\n` +
            `You can try:\n\n` +
            `• Hindi ya English mein apna sawaal likhein\n` +
            `  Type your question in Hindi or English\n` +
            `• Ya neeche menu se choose karein 👇\n` +
            `  Or choose from the menu below`,
            { parse_mode: 'Markdown', ...MAIN_MENU }
        );
    }

    // Route to handler based on intent
    switch (intent) {
        case 'GREETING':
            return ctx.reply(
                `👋 *Namaste! Hello!*\n\n` +
                `JeetoPlay Support mein aapka swagat hai! 🤖\n` +
                `Welcome to JeetoPlay Support!\n\n` +
                `Main aapki kaise madad karun?\n` +
                `How can I help you?`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        // ─── Real-World Common Queries (auto-handled) ───

        case 'NEED_HOST':
            return ctx.reply(
                `🎙️ *Host ke baare mein / About Hosting*\n\n` +
                `Filhaal hamare paas hosts available hain! 🎉\n` +
                `We already have hosts available!\n\n` +
                `Aapko kuch aur nahi karna — bas app kholein aur match join karein.\n` +
                `You don't need to do anything extra — just open the app and join matches.\n\n` +
                `🎮 Matches hamare team dwara host kiye jaate hain.\n` +
                `   Matches are hosted by our team.\n\n` +
                `_Kuch aur help chahiye? / Need anything else?_`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'FREE_COINS':
            return ctx.reply(
                `🎁 *Free Coins Kaise Earn Karein? / How to Get Free Coins*\n\n` +
                `JeetoPlay mein bahut saare FREE options hain! 🎉\n` +
                `There are many FREE options in JeetoPlay!\n\n` +
                `🎰 *Spin & Earn* — Ads dekho, free spin karo, coins jeeto!\n` +
                `   Watch ads, spin the wheel, win coins!\n\n` +
                `📺 *Watch & Earn* — Ads dekhkar direct coins kamao\n` +
                `   Watch ads to earn coins directly\n\n` +
                `🎁 *Referral Program* — Dost ko invite karo, dono ko bonus!\n` +
                `   Invite friends, both earn bonus!\n\n` +
                `🎯 *Daily Rewards* — Roz app kholein aur rewards paayein\n` +
                `   Open app daily for rewards\n\n` +
                `🏷️ *Promo Codes* — Hamare Telegram/Instagram pe nazar rakhein\n` +
                `   Follow us on Telegram/Instagram for promo codes\n\n` +
                `📱 *App kholein aur in sab features ka fayda uthayein!*`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'SPIN_NOT_WORKING':
            return ctx.reply(
                `🎰 *Spin/Ads Not Working? / Spin ya Ads kaam nahi kar raha?*\n\n` +
                `Yeh try karein:\n` +
                `Try these steps:\n\n` +
                `1️⃣ *Internet check karein* — Wi-Fi ya mobile data sahi se chal raha ho\n` +
                `    Check your internet connection\n\n` +
                `2️⃣ *App band karke dubara kholein* — Force close karke restart karein\n` +
                `    Close and reopen the app\n\n` +
                `3️⃣ *Thodi der baad try karein* — Kabhi kabhi ad providers ke paas ads nahi hote\n` +
                `    Try after some time — ad providers sometimes run out of ads\n\n` +
                `4️⃣ *App update karein* — Latest version download karein jeetoplay.in se\n` +
                `    Update to the latest version from jeetoplay.in\n\n` +
                `5️⃣ *Daily limit check karein* — Ek din mein limited spins/ads hote hain\n` +
                `    Check daily limit — spins/ads are limited per day\n\n` +
                `⚠️ *Note:* Ads availability depend karta hai aapke region aur time pe.\n` +
                `   Ad availability depends on your region and time of day.`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'SPIN_WRONG_COINS':
            return ctx.reply(
                `🎰 *Spin mein galat coins? / Wrong coins from Spin?*\n\n` +
                `⚠️ *Important:* Spin wheel ka final result *server se aata hai* — \n` +
                `wheel ka animation sirf visual hai.\n\n` +
                `The final spin result comes from the *server* — \n` +
                `the wheel animation is just visual.\n\n` +
                `🔄 *Kabhi kabhi wheel animation aur actual prize mein \n` +
                `chhota sa fark dikh sakta hai — yeh normal hai.*\n` +
                `Sometimes there may be a slight visual difference — this is normal.\n\n` +
                `✅ Jo coins aapke *wallet mein add hue*, wohi sahi prize hai.\n` +
                `   The coins added to your *wallet* are the correct prize.\n\n` +
                `📱 *App → Wallet → Transaction History* mein check karein.\n` +
                `   Check in App → Wallet → Transaction History.`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'ROOM_ID_TIMING':
            return ctx.reply(
                `🔑 *Room ID / Password Kab Milega?*\n` +
                `   *When will I get Room ID / Password?*\n\n` +
                `⏰ Room ID aur Password match se *15-30 minute pehle* share kiye jaate hain.\n` +
                `   Room ID & Password are shared *15-30 minutes before* the match.\n\n` +
                `📲 Aapko 2 jagah se milega:\n` +
                `   You'll get it from 2 places:\n\n` +
                `1️⃣ *Push Notification* — Phone pe notification aayega\n` +
                `    Push notification on your phone\n\n` +
                `2️⃣ *My Matches* — App kholein → My Matches → Us match pe tap karein\n` +
                `    Open app → My Matches → Tap on the match\n\n` +
                `⚠️ *Match time se pehle app nahi band karna* — notification miss ho sakta hai!\n` +
                `   Don't close the app — you might miss the notification!\n\n` +
                `_Match time ke kareeb notification on rakhein!_`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'ROOM_ID_WHERE':
            return ctx.reply(
                `🔑 *Room ID / Password Kahan Milega?*\n` +
                `   *Where to find Room ID / Password?*\n\n` +
                `📲 Room ID aur Password 2 jagah se milega:\n` +
                `   You can find Room ID & Password in 2 places:\n\n` +
                `1️⃣ *Notifications* 🔔\n` +
                `   Match se 15-30 min pehle push notification aayega\n` +
                `   Push notification sent 15-30 min before match\n\n` +
                `2️⃣ *My Matches Section* 🎮\n` +
                `   App → My Matches → Match card pe tap karo → Room ID dikhega\n` +
                `   App → My Matches → Tap match card → Room ID shown\n\n` +
                `💡 *Tip:* Notification on rakhein aur match time se pehle app check karein!`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'PROMO_CODE':
            return ctx.reply(
                `🏷️ *Promo Code Kaise Use Karein? / How to Use Promo Code*\n\n` +
                `1️⃣ App kholein → *Wallet* section jayein\n` +
                `    Open app → Go to *Wallet* section\n\n` +
                `2️⃣ *"Promo Code"* ya *"Apply Coupon"* option dhundhein\n` +
                `    Find the "Promo Code" or "Apply Coupon" option\n\n` +
                `3️⃣ Code daalein aur *Apply* tap karein\n` +
                `    Enter the code and tap *Apply*\n\n` +
                `4️⃣ Discount ya bonus balance mein auto-credit ho jayega! 🎉\n` +
                `    Discount or bonus auto-credited to balance!\n\n` +
                `📢 *Promo codes kahan milte hain:*\n` +
                `   Where to find promo codes:\n` +
                `• Hamare Telegram channel pe\n` +
                `• Instagram pe\n` +
                `• Special events aur tournaments mein\n\n` +
                `_Follow us for the latest codes!_ 🎁`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'DEPOSIT_ISSUE':
            return ctx.reply(ISSUE_RESPONSES.issue_deposit, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                    ]
                }
            });

        case 'WITHDRAWAL_ISSUE':
            return ctx.reply(ISSUE_RESPONSES.issue_withdrawal, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                    ]
                }
            });

        case 'RESULT_DISPUTE':
        case 'MATCH_CANCEL':
            return ctx.reply(ISSUE_RESPONSES.issue_match, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                    ]
                }
            });

        case 'HACKER_REPORT':
            return ctx.reply(
                `🚨 *Hacker / Cheater Report*\n\n` +
                `Hacker report ko humari team seriously leti hai!\n` +
                `We take hacker reports very seriously!\n\n` +
                `Report karne ke liye yeh details bhejein:\n` +
                `Please share these details:\n\n` +
                `1️⃣ *Match ID* (app mein dekh sakte hain)\n` +
                `2️⃣ *Opponent ka username*\n` +
                `3️⃣ *Kya hack use kiya* (speed hack, aimbot, wall hack, etc.)\n` +
                `4️⃣ *Screenshot / Screen Recording* 📸📹\n\n` +
                `⚠️ *Bina proof ke action nahi liya ja sakta.*\n` +
                `   No action can be taken without proof.\n\n` +
                `👇 *"Talk to Agent" tap karein aur details bhejein:*`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                        ]
                    }
                }
            );

        case 'GAME_RULES':
            return ctx.reply(
                `📋 *Game Rules / Game ke Niyam*\n\n` +
                `🎮 *BGMI / Free Fire Rules:*\n` +
                `• TPP/FPP mode match ke hisaab se\n` +
                `• Emulator NOT allowed (mobile only)\n` +
                `• Hacking/cheating = permanent ban 🚫\n` +
                `• Wrong result submit = penalty\n\n` +
                `🎲 *Ludo Rules:*\n` +
                `• Ludo King app pe khelo\n` +
                `• Room ID + Password se join karo\n` +
                `• Screenshot zaroor bhejo result ke liye\n` +
                `• Timer khatam hone se pehle result submit karo\n\n` +
                `❌ *Not Allowed / Banned:*\n` +
                `• Emulator/PC se khelna\n` +
                `• Hack ya cheat tools\n` +
                `• Multiple accounts\n` +
                `• Fake result submit karna\n\n` +
                `📱 *Detailed rules app mein Settings → Game Rules mein milenge.*`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'BUG_REPORT':
            return ctx.reply(
                `🐛 *Bug / Glitch Report*\n\n` +
                `Aapko koi technical problem aa rahi hai?\n` +
                `Facing a technical issue?\n\n` +
                `Pehle yeh try karein:\n` +
                `Try these first:\n\n` +
                `1️⃣ *App force close karein* aur dubara kholein\n` +
                `    Force close and reopen the app\n\n` +
                `2️⃣ *App update karein* — jeetoplay.in se latest version\n` +
                `    Update from jeetoplay.in\n\n` +
                `3️⃣ *Phone restart karein*\n` +
                `    Restart your phone\n\n` +
                `4️⃣ *Internet connection check karein*\n` +
                `    Check internet connection\n\n` +
                `Agar problem wahi hai to screenshot ke saath report karein 👇\n` +
                `If issue persists, report with screenshot below 👇`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📸 Screenshot ke saath Report karein', url: 'https://t.me/jeetoplay' }],
                            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                        ]
                    }
                }
            );

        case 'FEATURE_REQUEST':
            return ctx.reply(
                `💡 *Feature Suggestion / सुझाव*\n\n` +
                `Aapka suggestion humne note kar liya hai! ✅\n` +
                `Your suggestion has been noted!\n\n` +
                `Hum hamesha apni app ko better banane ki koshish karte hain.\n` +
                `We're always working to improve JeetoPlay.\n\n` +
                `🔜 *Naye features jald aa rahe hain:*\n` +
                `• More game modes\n` +
                `• More entry options\n` +
                `• Better UI/UX\n\n` +
                `📢 *Updates ke liye:*\n` +
                `• Telegram channel follow karein\n` +
                `• App notifications ON rakhein\n\n` +
                `_Aapke feedback se hum grow karte hain! 🙏_`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'FEEDBACK':
            return ctx.reply(
                `🎉 *Thank You for your Love! / शुक्रिया!*\n\n` +
                `Aapka feedback sunke bahut khushi hui! ❤️\n` +
                `We're so happy to hear that!\n\n` +
                `Hum aur bhi better hone ki koshish kar rahe hain!\n` +
                `We're working hard to make JeetoPlay even better.\n\n` +
                `🌟 *Aap bhi help kar sakte hain:*\n` +
                `• Friends ko refer karein — bonus milega! 🎁\n` +
                `• Play Store pe review dein ⭐\n` +
                `• Telegram channel join karein — updates milenge\n\n` +
                `_Game on! Jeeto aur khelo! 🎮💰_`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'MATCH_FULL':
            return ctx.reply(
                `🏟️ *Match Full / Slot Full*\n\n` +
                `Haan, kabhi kabhi matches jaldi full ho jaate hain! ⚡\n` +
                `Yes, sometimes matches fill up quickly!\n\n` +
                `💡 *Tips:*\n` +
                `1️⃣ Match publish hote hi join karein — jaldi se!\n` +
                `    Join as soon as match is published\n\n` +
                `2️⃣ Notifications ON rakhein — naye matches ka alert milega\n` +
                `    Keep notifications ON for match alerts\n\n` +
                `3️⃣ Zyada slots wale matches try karein (50/100 slots)\n` +
                `    Try matches with more slots\n\n` +
                `⚠️ *Agar paisa kat gaya lekin join nahi hua:*\n` +
                `   If money deducted but couldn't join:\n` +
                `   → Paisa automatically refund ho jayega ✅\n` +
                `   → Check Wallet → Transaction History\n\n` +
                `_Refund nahi mila? "Report Issue" tap karein 👇_`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎫 Refund nahi mila / Report Issue', url: 'https://t.me/jeetoplay' }],
                            [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                        ]
                    }
                }
            );

        case 'MATCH_DELAY':
            return ctx.reply(
                `⏰ *Match Delay / Match Late*\n\n` +
                `Kabhi kabhi matches thoda late start hote hain:\n` +
                `Sometimes matches start a bit late:\n\n` +
                `📋 *Reasons:*\n` +
                `• Slots abhi full nahi hue — waiting for more players\n` +
                `  Slots not filled yet — waiting for players\n` +
                `• Host preparation mein time lag raha\n` +
                `  Host preparing the match\n` +
                `• Technical setup chal raha hai\n` +
                `  Technical setup in progress\n\n` +
                `✅ *Kya karein:*\n` +
                `1️⃣ App mein "My Matches" check karein — status update milega\n` +
                `2️⃣ Notifications ON rakhein — Room ID aate hi alert milega\n` +
                `3️⃣ 15-20 min wait karein — zyaadatar matches time pe start hote hain\n\n` +
                `⚠️ *Agar match bahut zyada late ho:*\n` +
                `   Match auto-cancel ho sakta hai aur refund mil jayega.`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'BALANCE_CHECK':
            return ctx.reply(
                `💰 *Balance Check*\n\n` +
                `Balance check karne ke liye app kholein:\n` +
                `To check your balance, open the app:\n\n` +
                `📱 App → Wallet section → Balance dikhega\n\n` +
                `*Deposit Balance* — matches mein use hota hai\n` +
                `*Winning Balance* — withdraw kar sakte hain\n\n` +
                `_Koi aur help chahiye? / Need more help?_`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'TRANSACTION_HISTORY':
            return ctx.reply(
                `📊 *Transaction History*\n\n` +
                `Apni transactions dekhne ke liye:\n` +
                `To view your transactions:\n\n` +
                `📱 App → Wallet → Transaction History\n\n` +
                `Wahan sabhi deposits, withdrawals, aur match winnings dikhenge.\n` +
                `All deposits, withdrawals, and winnings shown there.`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        case 'HOW_TO_PLAY':
            return ctx.reply(FAQ_RESPONSES.faq_ludo, { parse_mode: 'Markdown', ...GAME_MENU });

        case 'HOW_TO_DEPOSIT':
            return ctx.reply(FAQ_RESPONSES.faq_deposit, { parse_mode: 'Markdown', ...BACK_TO_MAIN });

        case 'HOW_TO_WITHDRAW':
            return ctx.reply(FAQ_RESPONSES.faq_withdraw, { parse_mode: 'Markdown', ...BACK_TO_MAIN });

        case 'ESPORTS_INFO':
            return ctx.reply(FAQ_RESPONSES.faq_esports, { parse_mode: 'Markdown', ...BACK_TO_MAIN });

        case 'REFERRAL_INFO':
            return ctx.reply(FAQ_RESPONSES.faq_referral, { parse_mode: 'Markdown', ...BACK_TO_MAIN });

        case 'VIP_INFO':
            return ctx.reply(FAQ_RESPONSES.faq_vip, { parse_mode: 'Markdown', ...BACK_TO_MAIN });

        case 'APP_DOWNLOAD':
            return ctx.reply(FAQ_RESPONSES.faq_download, { parse_mode: 'Markdown', ...BACK_TO_MAIN });

        case 'ACCOUNT_ISSUE':
            return ctx.reply(ISSUE_RESPONSES.issue_account, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Appeal', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back to Menu', callback_data: 'menu_main' }]
                    ]
                }
            });

        case 'TALK_TO_HUMAN':
            setSession(chatId, { state: 'AWAITING_ISSUE_DETAILS', category: 'GENERAL' });
            return ctx.reply(
                `👨‍💼 *Agent se baat karne ke liye apna issue likhein:*\n` +
                `    To talk to an agent, describe your issue:\n\n` +
                `Detail mein likhein — kya problem hai, kab hua, kaunsa match/transaction.\n` +
                `Write in detail — what's the problem, when, which match/transaction.`,
                { parse_mode: 'Markdown' }
            );

        case 'THANKS':
            return ctx.reply(
                `😊 *Khushi hui madad karke! / Happy to help!*\n\n` +
                `Kuch aur chahiye toh baat karein.\n` +
                `Let me know if you need anything else! 👋`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );

        default:
            return ctx.reply(
                `🤔 *Hmm, main yeh samajhne ki koshish kar raha hoon...*\n\n` +
                `Kripya neeche se choose karein ya apna sawaal dubara likhein:\n` +
                `Please choose below or rephrase your question:`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );
    }
}

// ─── Callback Query Router ──────────────────────────────────

async function handleCallbackQuery(ctx, adminGroupId) {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

    await ctx.answerCbQuery();

    try {
        // ─── Menu Navigation ───
        if (data === 'menu_main') {
            return ctx.editMessageText(
                '🏠 *Main Menu*\n\nKya madad chahiye? / How can I help?',
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );
        }
        if (data === 'menu_game') {
            return ctx.editMessageText(
                '🎮 *Game Guide*\n\nKaunsa game ke baare mein jaanna hai?\nWhich game do you want to know about?',
                { parse_mode: 'Markdown', ...GAME_MENU }
            );
        }
        if (data === 'menu_money') {
            return ctx.editMessageText(
                '💰 *Money Help*\n\nDeposit ya Withdrawal ke baare mein:\nAbout Deposit or Withdrawal:',
                { parse_mode: 'Markdown', ...MONEY_MENU }
            );
        }
        if (data === 'menu_support') {
            return ctx.editMessageText(
                '🎫 *Report Issue*\n\nKya issue hai? / What\'s the issue?',
                { parse_mode: 'Markdown', ...SUPPORT_MENU }
            );
        }
        if (data === 'menu_faq') {
            return ctx.editMessageText(
                '❓ *FAQ — Aksar Poochhe Jaane Wale Sawal*\n\nChoose a topic:',
                { parse_mode: 'Markdown', ...FAQ_MENU }
            );
        }

        // ─── FAQ Responses ───
        if (FAQ_RESPONSES[data]) {
            return ctx.editMessageText(FAQ_RESPONSES[data], { parse_mode: 'Markdown', ...BACK_TO_MAIN });
        }

        // ─── Issue Info Screens ───
        if (data === 'issue_deposit') {
            return ctx.editMessageText(ISSUE_RESPONSES.issue_deposit, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back', callback_data: 'menu_support' }]
                    ]
                }
            });
        }
        if (data === 'issue_withdrawal') {
            return ctx.editMessageText(ISSUE_RESPONSES.issue_withdrawal, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back', callback_data: 'menu_support' }]
                    ]
                }
            });
        }
        if (data === 'issue_match') {
            return ctx.editMessageText(ISSUE_RESPONSES.issue_match, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Talk to Agent', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back', callback_data: 'menu_support' }]
                    ]
                }
            });
        }
        if (data === 'issue_account') {
            return ctx.editMessageText(ISSUE_RESPONSES.issue_account, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👨‍💼 Agent se Baat Karo / Appeal', url: 'https://t.me/jeetoplay' }],
                        [{ text: '← Back', callback_data: 'menu_support' }]
                    ]
                }
            });
        }
        if (data === 'issue_other') {
            setSession(chatId, { state: 'AWAITING_ISSUE_DETAILS', category: 'OTHER' });
            return ctx.reply(
                `❓ *Apna issue detail mein likhein:*\n` +
                `    Please describe your issue in detail:\n\n` +
                `Jitna detail denge, utna jaldi solve hoga!`,
                { parse_mode: 'Markdown' }
            );
        }

        // ─── Escalation Buttons ───
        if (data.startsWith('escalate_')) {
            const categoryMap = {
                'escalate_deposit': 'DEPOSIT ISSUE',
                'escalate_withdrawal': 'WITHDRAWAL ISSUE',
                'escalate_match': 'MATCH / RESULT ISSUE',
                'escalate_account': 'ACCOUNT ISSUE',
                'escalate_other': 'OTHER'
            };
            const category = categoryMap[data] || 'GENERAL';

            setSession(chatId, { state: 'AWAITING_ISSUE_DETAILS', category });
            return ctx.reply(
                `👨‍💼 *Agent se connect kar rahe hain...*\n` +
                `    Connecting to an agent...\n\n` +
                `Kripya apni problem detail mein likhein:\n` +
                `Please describe your problem in detail:\n\n` +
                `Yeh details dein / Include these details:\n` +
                `• Kya hua? / What happened?\n` +
                `• Kab hua? / When?\n` +
                `• Match ID / Transaction ID (agar ho)\n` +
                `• Amount kitna tha?\n` +
                `• Screenshot ho toh bhejein`,
                { parse_mode: 'Markdown' }
            );
        }

    } catch (err) {
        console.error('Callback error:', err.message);
        try {
            await ctx.reply('⚠️ Kuch gadbad ho gayi. Dubara try karein.', MAIN_MENU);
        } catch (_) { }
    }
}

// ─── Exports ────────────────────────────────────────────────

module.exports = {
    handleTextMessage,
    handleCallbackQuery,
    escalateToAdmin,
    FAQ_RESPONSES,
    ISSUE_RESPONSES,
    MAIN_MENU,
    SUPPORT_MENU,
    BACK_TO_MAIN,
    getSession,
    setSession,
    clearSession
};
