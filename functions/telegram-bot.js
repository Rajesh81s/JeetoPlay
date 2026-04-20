/**
 * telegram-bot.js — JeetoPlay Telegram Customer Support Bot
 * 
 * NO database access. Standalone Telegram bot with:
 * - Smart Hindi + English NLP auto-replies
 * - FAQ system with inline keyboard navigation
 * - Issue escalation to admin Telegram group
 * - Match/result issues always forwarded to human
 * 
 * Runs as: Firebase Cloud Function (webhook mode)
 * 
 * Exports: telegramWebhook (HTTP Cloud Function)
 */

const { Telegraf } = require('telegraf');
const functions = require('firebase-functions');
const {
    handleTextMessage,
    handleCallbackQuery,
    escalateToAdmin,
    MAIN_MENU,
    SUPPORT_MENU,
    getSession,
    setSession,
    clearSession
} = require('./bot/handlers');

// ─── Configuration ──────────────────────────────────────────
// Bot token — read from Firebase Functions config
// Set via: firebase functions:config:set telegram.token="YOUR_TOKEN" telegram.admin_group="GROUP_CHAT_ID"
// Or fallback to hardcoded values (for initial setup)

const BOT_TOKEN = (functions.config().telegram && functions.config().telegram.token) || '';
if (!BOT_TOKEN) {
    functions.logger.warn('[TelegramBot] BOT_TOKEN not set. Run: firebase functions:config:set telegram.token="YOUR_TOKEN"');
}

const ADMIN_GROUP_ID = (functions.config().telegram && functions.config().telegram.admin_group) || '';

// ─── Bot Instance (cached across warm invocations) ──────────

let _bot = null;

function getBot() {
    if (_bot) return _bot;

    const bot = new Telegraf(BOT_TOKEN);

    // ── Global Error Handler ──
    bot.catch((err, ctx) => {
        functions.logger.error('[TelegramBot] Error:', err.message);
    });

    // ── /start command ──
    bot.start(async (ctx) => {
        try {
            const name = ctx.from.first_name || 'Friend';
            await ctx.reply(
                `👋 *Namaste ${name}!* Welcome to JeetoPlay Support! 🤖\n\n` +
                `Main aapki har tarah ki help kar sakta hoon:\n` +
                `I can help you with everything:\n\n` +
                `🎮 Game Rules — Ludo, eSports, Tournaments\n` +
                `💰 Deposit & Withdrawal Help\n` +
                `🎫 Issue Report — Deposit, Match, Result\n` +
                `❓ FAQ — Aam sawalon ke jawab\n\n` +
                `👇 *Neeche se choose karein ya apna sawaal type karein!*\n` +
                `    Choose below or type your question!`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );
        } catch (err) {
            functions.logger.error('[/start] Error:', err.message);
        }
    });

    // ── /help command ──
    bot.help(async (ctx) => {
        try {
            await ctx.reply(
                `📋 *Help / Madad*\n\n` +
                `Aap yeh kar sakte hain:\n` +
                `You can do these things:\n\n` +
                `✍️ *Apna sawaal type karein* (Hindi ya English)\n` +
                `    Type your question (Hindi or English)\n\n` +
                `📱 *Menu buttons use karein* (neeche)\n` +
                `    Use the menu buttons (below)\n\n` +
                `🎫 *Issue report karein* → Agent se baat hogi\n` +
                `    Report an issue → Talk to agent\n\n` +
                `*Examples:*\n` +
                `• "deposit nahi aaya"\n` +
                `• "withdrawal kab milega"\n` +
                `• "ludo kaise khele"\n` +
                `• "result galat hai"`,
                { parse_mode: 'Markdown', ...MAIN_MENU }
            );
        } catch (err) {
            functions.logger.error('[/help] Error:', err.message);
        }
    });

    // ── /support command ──
    bot.command('support', async (ctx) => {
        try {
            await ctx.reply(
                '🎫 *Issue Report Karein / Report an Issue*\n\nKya issue hai? / What\'s the issue?',
                { parse_mode: 'Markdown', ...SUPPORT_MENU }
            );
        } catch (err) {
            functions.logger.error('[/support] Error:', err.message);
        }
    });

    // ── Callback queries (inline button clicks) ──
    bot.on('callback_query', async (ctx) => {
        try {
            await handleCallbackQuery(ctx, ADMIN_GROUP_ID);
        } catch (err) {
            functions.logger.error('[callback] Error:', err.message);
            try { await ctx.answerCbQuery('⚠️ Error. Try again.'); } catch (_) { }
        }
    });

    // ── Text messages ──
    bot.on('text', async (ctx) => {
        try {
            // ── Admin group reply forwarding ──
            // When admin replies to a support ticket in the group, forward to user
            if (ctx.chat.id.toString() === ADMIN_GROUP_ID && ctx.message.reply_to_message) {
                const repliedMsg = ctx.message.reply_to_message;
                const repliedText = repliedMsg.text || repliedMsg.caption || '';

                // Check if it's a reply to a support ticket (contains Telegram ID)
                const idMatch = repliedText.match(/Telegram ID:\s*`?(\d+)`?/);
                if (idMatch) {
                    const userId = idMatch[1];
                    const adminName = `${ctx.from.first_name || 'Admin'}`;
                    const replyText = ctx.message.text;

                    try {
                        await ctx.telegram.sendMessage(
                            userId,
                            `💬 *JeetoPlay Support Reply*\n\n` +
                            `${replyText}\n\n` +
                            `_— ${adminName}, JeetoPlay Support Team_`,
                            { parse_mode: 'Markdown', ...MAIN_MENU }
                        );
                        // Confirm to admin that reply was sent
                        await ctx.reply('✅ Reply sent to user.', { reply_to_message_id: ctx.message.message_id });
                    } catch (sendErr) {
                        await ctx.reply('❌ Could not send reply. User may have blocked the bot.', { reply_to_message_id: ctx.message.message_id });
                    }
                }
                return;
            }

            // Skip non-private chats (don't auto-reply in groups)
            if (ctx.chat.type !== 'private') return;
            await handleTextMessage(ctx, ADMIN_GROUP_ID);
        } catch (err) {
            functions.logger.error('[text] Error:', err.message);
            if (ctx.chat.type === 'private') {
                await ctx.reply('⚠️ Kuch gadbad ho gayi. Dubara try karein.', MAIN_MENU);
            }
        }
    });

    // ── Photo/document messages — only in private chats ──
    bot.on(['photo', 'document'], async (ctx) => {
        try {
            if (ctx.chat.type !== 'private') return;
            const chatId = ctx.chat.id;
            const session = getSession(chatId);

            // If user is in issue reporting flow, forward with the image
            if (session.state === 'AWAITING_ISSUE_DETAILS' && ADMIN_GROUP_ID) {
                const caption = ctx.message.caption || '';
                const userName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'User';
                const userHandle = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;

                const adminCaption =
                    `🎫 SUPPORT — ${session.category || 'ISSUE'}\n` +
                    `👤 ${userName} (${userHandle})\n` +
                    `💬 ${caption || 'Screenshot attached'}`;

                // Forward the photo/document to admin group
                if (ctx.message.photo) {
                    const photo = ctx.message.photo[ctx.message.photo.length - 1];
                    await ctx.telegram.sendPhoto(ADMIN_GROUP_ID, photo.file_id, { caption: adminCaption });
                } else if (ctx.message.document) {
                    await ctx.telegram.sendDocument(ADMIN_GROUP_ID, ctx.message.document.file_id, { caption: adminCaption });
                }

                clearSession(chatId);

                return ctx.reply(
                    `✅ *Screenshot support team ko forward ho gaya!*\n` +
                    `    Screenshot forwarded to support team!\n\n` +
                    `⏰ Jaldi se reply milega.\n` +
                    `   You'll get a reply soon.`,
                    { parse_mode: 'Markdown', ...MAIN_MENU }
                );
            }

            // Not in a flow — ask what it's about
            await ctx.reply(
                `📸 Thanks for sharing!\n\n` +
                `Yeh kis issue ke liye hai? / What is this for?\n` +
                `Neeche se choose karein:`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💳 Deposit Issue', callback_data: 'escalate_deposit' }],
                            [{ text: '🎮 Match/Result Issue', callback_data: 'escalate_match' }],
                            [{ text: '❓ Other Issue', callback_data: 'escalate_other' }],
                            [{ text: '← Menu', callback_data: 'menu_main' }]
                        ]
                    }
                }
            );
        } catch (err) {
            functions.logger.error('[media] Error:', err.message);
        }
    });

    _bot = bot;
    return bot;
}

// ─── Webhook HTTP Endpoint (Firebase Cloud Function) ────────

exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
    // Health check
    if (req.method === 'GET') {
        return res.status(200).send('JeetoPlay Support Bot Active ✅');
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method not allowed');
    }

    try {
        const bot = getBot();
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (err) {
        functions.logger.error('[webhook] Error:', err.message);
        res.status(200).send('OK'); // Always 200 to prevent Telegram retries
    }
});
