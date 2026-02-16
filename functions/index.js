/**
 * index.js — Cloud Functions entry point
 *
 * All functions are organized by domain in separate modules.
 * This file simply re-exports them so Firebase discovers them.
 *
 * Modules:
 *   helpers.js       — shared utilities (assertAuth, sendPush, deductBalance, etc.)
 *   payments.js      — payment gateway integration (ZapUPI, webhooks, deposits, withdrawals)
 *   ludo.js          — Ludo game functions (submit result, cancel, create, accept)
 *   esports.js       — eSports functions (join match)
 *   admin.js         — admin-only functions (login, wallet updates, dispute resolution)
 *   referrals.js     — referral system
 *   notifications.js — push notifications (admin broadcasts, eSports notifs, FCM topics)
 *   triggers.js      — database triggers (match updates, withdrawal updates, new user)
 *   scheduled.js     — cron jobs (dispute timeouts, reminders, re-engagement)
 *   daily_rewards.js  — daily login streak rewards
 *   spin_wheel.js     — spin wheel / lucky draw
 *   vip.js            — VIP premium membership
 *   tournament.js     — tournament registration / unregistration
 */

const payments = require('./payments');
const ludo = require('./ludo');
const esports = require('./esports');
const admin = require('./admin');
const referrals = require('./referrals');
const notifications = require('./notifications');
const triggers = require('./triggers');
const scheduled = require('./scheduled');

const coupons = require('./coupons');
const dailyRewards = require('./daily_rewards');
const spinWheel = require('./spin_wheel');
const vip = require('./vip');
const tournament = require('./tournament');

// ─── Re-export all Cloud Functions ──────────────────────────

// Payments (8 exports)
exports.createPaymentApi = payments.createPaymentApi;
exports.zapupiAutoCheckApi = payments.zapupiAutoCheckApi;
exports.checkPaymentStatusApi = payments.checkPaymentStatusApi;
exports.webhookApi = payments.webhookApi;
exports.processWithdrawal = payments.processWithdrawal;
exports.processDeposit = payments.processDeposit;
exports.confirmDeposit = payments.confirmDeposit;
exports.creditZapUPIDeposit = payments.creditZapUPIDeposit;

// Ludo (9 exports)
exports.submitLudoResult = ludo.submitLudoResult;
exports.cancelLudoMatch = ludo.cancelLudoMatch;
exports.shareRoomCode = ludo.shareRoomCode;
exports.startLudoGame = ludo.startLudoGame;
exports.createLudoChallenge = ludo.createLudoChallenge;
exports.acceptLudoChallenge = ludo.acceptLudoChallenge;
exports.sendRematch = ludo.sendRematch;
exports.acceptRematch = ludo.acceptRematch;
exports.declineRematch = ludo.declineRematch;

// eSports (1 export)
exports.joinEsportsMatch = esports.joinEsportsMatch;

// Admin (8 exports)
exports.adminLogin = admin.adminLogin;
exports.adminWalletUpdate = admin.adminWalletUpdate;
exports.adminRejectWithdrawal = admin.adminRejectWithdrawal;
exports.adminCancelLudoMatch = admin.adminCancelLudoMatch;
exports.adminResolveLudoDispute = admin.adminResolveLudoDispute;
exports.lookupEmailByMobile = admin.lookupEmailByMobile;
exports.adminBanUser = admin.adminBanUser;
exports.adminUnbanUser = admin.adminUnbanUser;

// Coupons (3 exports)
exports.redeemCoupon = coupons.redeemCoupon;
exports.adminCreateCoupon = coupons.adminCreateCoupon;
exports.adminToggleCoupon = coupons.adminToggleCoupon;

// Daily Rewards (1 export)
exports.claimDailyReward = dailyRewards.claimDailyReward;

// Spin Wheel (1 export)
exports.spinWheel = spinWheel.spinWheel;

// VIP (1 export)
exports.purchaseVip = vip.purchaseVip;

// Referrals (1 export)
exports.processReferralReward = referrals.processReferralReward;

// Notifications (5 exports)
exports.sendAdminNotification = notifications.sendAdminNotification;
exports.subscribeToTopic = notifications.subscribeToTopic;
exports.sendEsportsNotification = notifications.sendEsportsNotification;
exports.sendEsportsPrizePush = notifications.sendEsportsPrizePush;
exports.sendEsportsRoomCredsPush = notifications.sendEsportsRoomCredsPush;

// Database Triggers (4 exports)
exports.onLudoMatchUpdate = triggers.onLudoMatchUpdate;
exports.onWithdrawalUpdate = triggers.onWithdrawalUpdate;
exports.onFcmTokenUpdate = triggers.onFcmTokenUpdate;
exports.onNewUser = triggers.onNewUser;

// Scheduled Functions (8 exports)
exports.checkDisputeTimeouts = scheduled.checkDisputeTimeouts;
exports.esportsMatchReminder = scheduled.esportsMatchReminder;
exports.ludoRoomCodeReminder = scheduled.ludoRoomCodeReminder;
exports.autoExpireStaleLudoMatches = scheduled.autoExpireStaleLudoMatches;
exports.reEngageInactiveUsers = scheduled.reEngageInactiveUsers;
exports.autoCloseTournamentRegistration = scheduled.autoCloseTournamentRegistration;
exports.tournamentStartReminder = scheduled.tournamentStartReminder;
exports.tournamentRoundReminder = scheduled.tournamentRoundReminder;
exports.checkVipExpiry = scheduled.checkVipExpiry;

// Tournament (2 exports)
exports.registerForTournament = tournament.registerForTournament;
exports.unregisterFromTournament = tournament.unregisterFromTournament;
