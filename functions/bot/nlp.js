/**
 * bot/nlp.js — AI-Powered Intent Detection for JeetoPlay Support Bot
 * 
 * Two-tier intent detection:
 * 1. Fast keyword matching (free, instant)
 * 2. Gemini AI fallback for unclear messages (handles misspellings, slang, mixed languages)
 * 
 * Gemini only classifies intent — all responses are pre-written for accuracy.
 */

const { GoogleGenAI } = require('@google/genai');

// ─── Gemini AI Setup ────────────────────────────────────────

const { functions } = require('../helpers');
const GEMINI_API_KEY = functions.config().gemini?.key || '';
let _ai = null;

function getAI() {
    if (_ai) return _ai;
    _ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    return _ai;
}

// ─── Valid Intent List ──────────────────────────────────────

const VALID_INTENTS = [
    'GREETING',
    'NEED_HOST',
    'FREE_COINS',
    'SPIN_NOT_WORKING',
    'SPIN_WRONG_COINS',
    'ROOM_ID_TIMING',
    'ROOM_ID_WHERE',
    'PROMO_CODE',
    'DEPOSIT_ISSUE',
    'WITHDRAWAL_ISSUE',
    'RESULT_DISPUTE',
    'MATCH_CANCEL',
    'MATCH_FULL',
    'MATCH_DELAY',
    'BALANCE_CHECK',
    'TRANSACTION_HISTORY',
    'HOW_TO_PLAY',
    'HOW_TO_DEPOSIT',
    'HOW_TO_WITHDRAW',
    'ESPORTS_INFO',
    'REFERRAL_INFO',
    'VIP_INFO',
    'APP_DOWNLOAD',
    'ACCOUNT_ISSUE',
    'HACKER_REPORT',
    'GAME_RULES',
    'BUG_REPORT',
    'FEATURE_REQUEST',
    'FEEDBACK',
    'THANKS',
    'TALK_TO_HUMAN'
];

// ─── Gemini System Prompt ───────────────────────────────────

const CLASSIFICATION_PROMPT = `You are an intent classifier for JeetoPlay — a real-money gaming app with Ludo (1v1 on Ludo King) and eSports (BGMI, Free Fire, COD Mobile).
Users write in Hindi, Hinglish (Hindi in English script), and English — often with HEAVY spelling mistakes, slang, abbreviations, and abusive language.

Classify the user message into EXACTLY ONE intent. Return ONLY the intent name.

INTENTS WITH REAL EXAMPLES FROM ACTUAL USERS:

GREETING — any greeting or just attention-seeking with no clear question
"hi" "hii" "hlo" "hello" "namaste" "bhai" "sir" "bro" "good morning" "hey there" "sir?" "?" "bhai bolo" "anyone there" "koi hai" "ji" "haan" "yes"

NEED_HOST — asking for host for matches
"host chahiye" "host chiye" "host do" "need host" "hume host chahiye" "host kab aayega" "we need host" "bhai host do" "sir host"

FREE_COINS — begging for free money/coins/balance
"free coins do" "paisa do" "give me coins" "free money chahiye" "kuch free do" "mujhe free coins" "free balance" "bina paisa" "give me free" "free entry do" "free mein khelna hai"

SPIN_NOT_WORKING — spin wheel or ads not working/loading
"spin nahi chal raha" "spn kaam nhi kr rha" "ads not working" "ad nhi aa rha" "wheel not working" "spin stuck" "ad load nhi ho rha" "no ads available" "spin button not working" "video not playing" "ad band hai" "ads nahi dikh raha"

SPIN_WRONG_COINS — spin showed wrong/different prize than credited
"spin mein galat coins aaye" "wrong coins mile" "wheel pe alag dikha" "coins kam aaye" "spin ka result galat" "showing wrong coins" "Na 1 coin wale pr glitch hua bass 25 coin wale pe glitch ho rha h" "spin glitch"

ROOM_ID_TIMING — when will room ID/password come before match
"id pass kab milega" "room id kab aayega" "kitne pehle milega" "match ka id kab milega" "das baje ka match hai id kab aayega" "10 pm match id pass timing" "id kab aata hai"

ROOM_ID_WHERE — where to find room ID/password
"id kahan milega" "room id kaise dekhe" "how to get id password" "id pass kahan se milega" "room details kahan hai" "notification mein nahi aaya" "id password bhi Mila" "id mila lekin join nahi hua"

PROMO_CODE — how to use promo/coupon code
"promo code kaise use kare" "coupon kahan dale" "promo code kaise lagaye" "how to apply promo" "code apply kaise kare" "offer code"

DEPOSIT_ISSUE — money paid but not credited/received (CRITICAL)
"paisa nahi aaya" "pesa nhi aya" "deposit nahi hua" "payment fail" "paise kat gaye" "money stuck" "My money is stuck" "deposit recive nhi hua" "mujhe deposit receive nhi hua" "bank se kata lekin add nahi hua" "paisa credit nahi" "amount not credited" "recharge nahi hua" "pay kiya lekin balance nahi aaya" "money is stuck" "paisa fas gaya" "payment ho gaya lekin" "UPI se kata" "balance add nahi hua"

WITHDRAWAL_ISSUE — withdrawal pending/rejected/not received (CRITICAL)
"withdrawal kab milega" "withdrawal pending" "paise nahi aaye bank mein" "withdrawal nahi mila" "withdrawal reject" "cashout nahi hua" "paisa nikala lekin nahi aaya" "withdrawal status" "withdraw pending hai" "bank mein nahi aaya"

RESULT_DISPUTE — wrong result, opponent cheated, unfair outcome (CRITICAL)
"result galat hai" "cheating kar raha" "maine jeeta tha" "wrong result" "galat result" "cheater hai" "usne hacker hai" "hack kar raha" "fake result" "opponent cheated" "jeet gaya lekin haar dikha raha" "screenshot dekhlo" "proof hai" "pov lo us mc ka" "result cancel karo"

HACKER_REPORT — reporting hacker/cheater in game (CRITICAL)
"hacker hai" "hack use kar raha" "speed hack" "wall hack" "aimbot" "cheater report" "usne hack kiya" "us mc ka usne hacker hai" "hacker ban karo" "location hack" "pov lo mc location user" "hack wala player"

MATCH_FULL — match slots filled up, couldn't join, match full before time, match started early
"match full ho gaya" "slot full" "join nahi ho raha full" "time se pehle full" "match full dikha raha" "pura salt full dikha raha tha" "software full dikha raha" "match ful Ho Gaya" "slot bhar gaya" "join karne gaya to full" "slot available nahi" "match join nahi hua full tha" "room was full" "match start from 11:10 timing was 11:15" "time se pehle start ho gaya" "match plying bata rha" "match already started" "time se phle hi start ho gya"

MATCH_DELAY — match not starting on time, late match
"why match delay" "match late ho raha" "match kab start hoga" "match time pe nahi hua" "match delay" "match shuru kab hoga" "waiting for match" "match late hai" "kitna wait kare" "they start the match early" "match kab chalega"

MATCH_CANCEL — match cancelled, refund not received
"match cancel ho gaya" "refund nahi mila" "paisa wapas karo" "cancel ho gya" "refund kab milega" "entry fee refund" "match cancel karo"

GAME_RULES — asking about game rules, allowed/banned things, characters
"kon konsa character not allowed" "rules kya hai" "kya allowed hai" "banned characters" "game rules" "kon sa character use kar sakte" "ye allowed hai kya" "settings banned hai kya" "emulator allowed hai kya" "konsa character ban hai"

BUG_REPORT — reporting app glitch/bug/error/crash
"glitch ho raha hai" "app crash" "bug hai" "error aa raha" "it was a complete glitch" "app hang" "screen freeze" "app band ho ja raha" "kuch galat ho raha" "app kaam nahi kar raha"

ACCOUNT_ISSUE — login/OTP/account problems
"login nahi ho raha" "account block" "otp nahi aa raha" "account suspended" "banned" "I can't make a login" "login fail" "try many times" "login issue" "account band ho gaya" "number change karna hai" "cant login" "login problem"

BALANCE_CHECK — check wallet balance
"mera balance" "balance kitna" "kitna paisa hai" "balance check" "wallet balance" "balance dikhao"

TRANSACTION_HISTORY — view transactions
"meri transactions" "payment history" "transaction dikhao" "record dikhao"

HOW_TO_PLAY — how to play games
"kaise khele" "game kaise start kare" "khel kaise" "samjhao" "batao kaise" "kaise join kare"

HOW_TO_DEPOSIT — how to add money
"deposit kaise kare" "paisa kaise dale" "recharge kaise" "money add kaise" "paisa kaise add kare"

HOW_TO_WITHDRAW — how to withdraw money
"withdraw kaise kare" "paisa kaise nikale" "cashout kaise" "paise kaise nikal sakte"

ESPORTS_INFO — about eSports matches
"esports kaise khele" "bgmi match" "free fire" "pubg" "tournament" "upcoming match" "match kab hai"

REFERRAL_INFO — referral program
"refer kaise kare" "referral code" "invite friend" "referral bonus"

VIP_INFO — VIP membership
"vip kya hai" "vip benefits" "premium membership" "vip plan"

APP_DOWNLOAD — downloading the app
"app download" "apk link" "download kaise" "app kahan se" "download link"

FEATURE_REQUEST — user suggesting new features or changes to app
"add kardo" "feature add karo" "entry add kardo" "ye feature chahiye" "survival add karo" "per kill add karo" "new mode add karo" "app mai ye add kardo" "saare entry add karo" "aur matches add karo" "naya game add karo"

FEEDBACK — user giving positive feedback, praising the app
"app mein maza aa raha" "bohot accha app" "great app" "love this app" "best app" "majaaa arhah hai" "accha experience" "bahut maza aaya" "app bahut acchi hai" "keep it up" "awesome app"

THANKS — gratitude, problem resolved
"thanks" "shukriya" "solved" "ho gaya" "thank you" "theek hai" "thik hai" "ok done"

TALK_TO_HUMAN — explicitly wants human agent
"agent se baat karo" "customer care" "kisi se baat karao" "admin se baat" "real person" "please sahayata karen" "help chahiye urgent" "pls help mee" "please help" "kisi ko bhejo"

UNKNOWN — completely irrelevant, random links, spam, just emojis, promotions, or gibberish
"check out my channel" "subscribe" random links, phone numbers only, promotional messages, "Bhai aapko app promotion karvana Hai"

IMPORTANT CLASSIFICATION RULES:
1. Users often say "sir", "bhai", "bro" with their query — IGNORE the greeting word, focus on the ACTUAL question
   - "sir paisa nahi aaya" = DEPOSIT_ISSUE (not GREETING)
   - "bhai host chahiye" = NEED_HOST (not GREETING)
   - "sir result galat hai" = RESULT_DISPUTE (not GREETING)
2. Short msgs like "sir?" or just "?" or "bhai" alone = GREETING
3. Abusive/angry msgs about results or cheating = RESULT_DISPUTE or HACKER_REPORT
4. "money stuck", "paisa fas gaya" = DEPOSIT_ISSUE
5. If mentions "full", "slot full", "join nahi hua" = MATCH_FULL
6. If mentions "delay", "late", "kab start" = MATCH_DELAY
7. If mentions "glitch" + spin/coin = SPIN_WRONG_COINS
8. If mentions "glitch" + app/general = BUG_REPORT
9. "pov lo" or just screenshots context = look at what they're complaining about
10. Login/OTP/can't login = ACCOUNT_ISSUE
11. Promotional msgs, YouTube/channel links = UNKNOWN
12. "add kardo", "ye feature chahiye" = FEATURE_REQUEST
13. "app mein maza", "great app", "best app" = FEEDBACK
14. "match time se pehle start ho gaya", "room was full" = MATCH_FULL
15. "we must record", "recording" about match proof = GAME_RULES

Reply with ONLY the intent name. Nothing else.`;

// ─── Keyword Matching (Tier 1 — Fast) ───────────────────────

const INTENTS = {
    GREETING: {
        priority: 1,
        keywords: [
            'hello', 'hey', 'hlo', 'hii', 'namaste', 'namaskar',
            'good morning', 'good evening', 'good afternoon',
            'kaise ho', 'kya haal', 'suprabhat'
        ]
    },

    HACKER_REPORT: {
        priority: 10,
        keywords: [
            'hacker', 'hack', 'hacker hai', 'hack kar raha',
            'speed hack', 'wall hack', 'aimbot', 'hack use',
            'hacker ban karo', 'hack report', 'using hack',
            'hacker report', 'hack wala'
        ]
    },

    GAME_RULES: {
        priority: 6,
        keywords: [
            'character not allowed', 'allowed character', 'banned character',
            'not allowed', 'character allowed', 'rules kya hai',
            'kya allowed', 'banned hai kya', 'settings allowed',
            'game rules', 'which character', 'konsa character',
            'kon konsa character', 'character ban'
        ]
    },

    BUG_REPORT: {
        priority: 7,
        keywords: [
            'glitch', 'bug', 'app crash', 'crash ho raha',
            'error aa raha', 'app hang', 'screen freeze',
            'app band ho ja raha', 'complete glitch',
            'bug report', 'technical issue', 'app error'
        ]
    },

    FEATURE_REQUEST: {
        priority: 5,
        keywords: [
            'feature add', 'add kardo', 'add karo', 'feature chahiye',
            'naya game add', 'new mode', 'mode add karo', 'entry add kardo',
            'survival add', 'per kill add', 'aur matches add',
            'suggestion', 'feature request', 'ye add karo'
        ]
    },

    FEEDBACK: {
        priority: 4,
        keywords: [
            'great app', 'best app', 'love this app', 'awesome app',
            'bahut accha', 'bohot accha', 'maza aa raha', 'majaaa',
            'accha experience', 'keep it up', 'nice app', 'good app',
            'bahut maza', 'app acchi hai'
        ]
    },

    NEED_HOST: {
        priority: 6,
        keywords: [
            'need host', 'host chahiye', 'host chiye', 'host chaiye',
            'host chahie', 'host do', 'host needed',
            'hume host chahiye', 'hume host chiye', 'hosting',
            'host karwao', 'koi host hai', 'host kab aayega',
            'host please', 'host dedo', 'we need host', 'want host',
            'host milega kya', 'host available', 'host chye',
            'host chahye', 'host chiaye', 'host mangta'
        ]
    },

    FREE_COINS: {
        priority: 6,
        keywords: [
            'free coins', 'free money', 'free paisa', 'free balance',
            'give me coins', 'coins do', 'paisa do', 'free mein',
            'muft coins', 'free reward', 'free win', 'bonus do',
            'free ka kuch', 'free credit', 'paise chahiye free',
            'coins de do', 'kuch free do', 'free dedo',
            'give me free', 'free mein do', 'bina paisa',
            'free entry', 'free match', 'free join'
        ]
    },

    SPIN_NOT_WORKING: {
        priority: 8,
        keywords: [
            'spin not working', 'spin nahi chal raha', 'wheel not working',
            'spin wheel not working', 'spin nahi ho raha', 'spin stuck',
            'spin error', 'ads not working', 'ad not loading', 'ad nahi aa raha',
            'ad nahi chal raha', 'video not playing', 'ad error',
            'ads nahi dikh raha', 'spin kaam nahi kar raha',
            'wheel ghum nahi raha', 'ad load nahi ho raha',
            'ad nahi load ho raha', 'watch ad not working',
            'ad band hai', 'ad problem', 'spin problem',
            'spin button not working', 'no ads available',
            'ad available nahi', 'ads not showing'
        ]
    },

    SPIN_WRONG_COINS: {
        priority: 8,
        keywords: [
            'spin gave wrong coins', 'wrong coins', 'galat coins',
            'spin mein alag aaya', 'different coins', 'coins kam aaye',
            'wheel pe alag dikha', 'spin result wrong', 'spin alag aaya',
            'coins nahi mile', 'spin se coins nahi aaye',
            'wheel pe 100 aaya lekin', 'coins kam mile',
            'spin ka result galat', 'wrong spin result',
            'wheel wrong result', 'galat result spin',
            'showing wrong coins', 'coins galat'
        ]
    },

    ROOM_ID_TIMING: {
        priority: 7,
        keywords: [
            'id password kab', 'room id kab', 'id pass kab',
            'id kab milega', 'password kab milega', 'room kab milega',
            'id pass kitna pehle', 'kitne pehle milega',
            'when room id', 'when will i get id', 'when id password',
            'room id timing', 'id password timing',
            'match ke kitne pehle', 'id pass kab aata hai',
            'room credentials when', 'kab milega id',
            'id pass time', 'id kab aayega', 'password kab aayega'
        ]
    },

    ROOM_ID_WHERE: {
        priority: 7,
        keywords: [
            'room id kahan', 'id password kahan', 'id pass kaise milega',
            'how to get room id', 'where room id', 'where id password',
            'id kahan milega', 'password kahan milega', 'room id kaise dekhe',
            'id pass kaise dekhe', 'room details kahan', 'id pass kahan se',
            'how to find room', 'room id kaise', 'room kaise milega',
            'credentials kahan', 'match ka id kahan',
            'how to get id password', 'room id kaise milta'
        ]
    },

    PROMO_CODE: {
        priority: 6,
        keywords: [
            'promo code', 'coupon code', 'promo kaise use kare',
            'coupon kaise lagaye', 'promo code kahan dale',
            'where to enter promo', 'how to use promo', 'how to use coupon',
            'promo code kaise', 'coupon kaise', 'discount code',
            'promo laga do', 'code kahan dalein', 'offer code',
            'promo apply', 'coupon apply', 'code apply kaise',
            'promo code use', 'voucher', 'promo dale kahan'
        ]
    },

    DEPOSIT_ISSUE: {
        priority: 10,
        keywords: [
            'deposit not received', 'deposit not credited', 'money not added',
            'payment failed', 'payment not received', 'deposit issue',
            'deposit problem', 'deposit stuck', 'deposit pending',
            'money not coming', 'amount not credited', 'paid but not received',
            'upi deducted', 'money deducted but not added', 'double deduction',
            'i paid but', 'bank debited', 'payment done but',
            'paisa nahi aaya', 'paisa nhi aaya', 'paise nahi aaye',
            'deposit nahi hua', 'deposit nhi hua', 'paisa add nahi hua',
            'paisa credit nahi', 'payment fail', 'recharge nahi hua',
            'paise kat gaye', 'paise cut ho gaye', 'paisa kata lekin',
            'bank se kata', 'jama nahi', 'jma nahi', 'paisa nahi mila',
            'deposit kiya lekin', 'pay kiya lekin', 'bheja lekin'
        ]
    },

    WITHDRAWAL_ISSUE: {
        priority: 10,
        keywords: [
            'withdrawal pending', 'withdrawal not received', 'withdrawal stuck',
            'withdrawal rejected', 'withdrawal failed', 'payout pending',
            'payout not received', 'when will i get', 'withdrawal issue',
            'withdrawal problem', 'cashout', 'withdrawal status',
            'money not received in bank', 'upi not received',
            'withdrawal kab milega', 'withdrawal nahi mila',
            'withdrawal pending hai', 'paisa kab aayega',
            'paise kab milenge', 'nikala lekin nahi aaya',
            'withdrawal reject', 'withdrawal cancel', 'cashout nahi',
            'paisa nikala lekin', 'bank mein nahi aaya',
            'upi mein nahi aaya', 'withdrawal kab hoga'
        ]
    },

    RESULT_DISPUTE: {
        priority: 10,
        keywords: [
            'wrong result', 'result wrong', 'cheating', 'cheater',
            'i won but', 'declared wrong', 'wrong winner',
            'result dispute', 'match dispute', 'unfair result',
            'opponent cheated', 'fake result', 'wrong output',
            'result galat', 'result cancel',
            'result galat hai', 'galat result', 'maine jeeta tha',
            'mera result galat', 'cheating ho rahi', 'cheating kar raha',
            'galat winner', 'maine win kiya', 'jeet gaya lekin',
            'haar dikha raha', 'dispute', 'jhooth bol raha',
            'screenshot dekhlo', 'proof hai mere paas'
        ]
    },

    MATCH_CANCEL: {
        priority: 9,
        keywords: [
            'match cancelled', 'match canceled', 'refund not received',
            'refund pending', 'refund issue', 'match cancel',
            'cancelled but no refund', 'entry fee refund',
            'where is my refund', 'cancel refund',
            'match cancel ho gaya', 'cancel ho gya',
            'refund nahi mila', 'refund nhi mila',
            'paisa wapas nahi', 'paise wapas karo',
            'refund kab milega', 'refund do', 'cancel karo'
        ]
    },

    MATCH_FULL: {
        priority: 8,
        keywords: [
            'match full', 'slot full', 'slots full', 'full ho gaya',
            'full dikha raha', 'join nahi ho raha', 'match ful',
            'time se pehle full', 'slot bhar gaya', 'salt full',
            'software full', 'match full ho gaya', 'slot available nahi',
            'join karne gaya full', 'match join nahi hua'
        ]
    },

    MATCH_DELAY: {
        priority: 7,
        keywords: [
            'match delay', 'match late', 'why delay', 'match kab start',
            'match shuru kab', 'waiting for match', 'match time pe nahi',
            'kitna wait', 'match late ho raha', 'delay ho raha',
            'match start nahi ho raha', 'match kab hoga'
        ]
    },

    BALANCE_CHECK: {
        priority: 7,
        keywords: [
            'my balance', 'check balance', 'wallet balance',
            'how much balance', 'balance check', 'show balance',
            'remaining balance', 'current balance',
            'mera balance', 'balance kitna', 'kitna paisa hai',
            'kitne paise', 'balance dikhao', 'balance batao',
            'wallet mein kitna', 'paisa kitna hai'
        ]
    },

    TRANSACTION_HISTORY: {
        priority: 6,
        keywords: [
            'transaction', 'transactions', 'history', 'transaction history',
            'recent transactions', 'payment history',
            'meri transactions', 'paison ka record'
        ]
    },

    HOW_TO_PLAY: {
        priority: 5,
        keywords: [
            'how to play', 'how to start', 'game rules', 'ludo rules',
            'how does it work', 'explain', 'tutorial', 'guide',
            'new user', 'beginner',
            'kaise khele', 'kaise khelte hain', 'khel kaise',
            'game kaise', 'start kaise kare', 'rules kya hai',
            'samjhao', 'batao kaise'
        ]
    },

    HOW_TO_DEPOSIT: {
        priority: 5,
        keywords: [
            'how to deposit', 'how to add money', 'how to recharge',
            'deposit kaise', 'add money', 'recharge kaise',
            'payment method', 'upi deposit',
            'deposit kaise kare', 'paisa kaise dale', 'paise kaise add kare',
            'recharge kaise kare', 'money add kaise'
        ]
    },

    HOW_TO_WITHDRAW: {
        priority: 5,
        keywords: [
            'how to withdraw', 'how to cashout', 'how to get money',
            'withdraw kaise', 'minimum withdrawal',
            'withdrawal kaise kare', 'paisa kaise nikale',
            'paise kaise withdraw kare', 'cashout kaise',
            'nikalna kaise hai'
        ]
    },

    ESPORTS_INFO: {
        priority: 4,
        keywords: [
            'esports', 'e-sports', 'bgmi', 'free fire', 'pubg',
            'match join', 'slot book', 'room id', 'room password',
            'match kaise join', 'slot kaise book', 'esports kaise khele',
            'tournament', 'upcoming match'
        ]
    },

    REFERRAL_INFO: {
        priority: 4,
        keywords: [
            'referral', 'refer', 'referral code', 'invite friend',
            'referral bonus', 'referral link',
            'refer kaise kare', 'referral kya hai', 'invite kaise'
        ]
    },

    VIP_INFO: {
        priority: 4,
        keywords: [
            'vip', 'premium', 'vip membership', 'vip benefits',
            'vip kya hai', 'vip plan', 'vip perks'
        ]
    },

    APP_DOWNLOAD: {
        priority: 3,
        keywords: [
            'download', 'app download', 'apk', 'install',
            'download kaise', 'app kahan se', 'link do',
            'download link', 'play store'
        ]
    },

    ACCOUNT_ISSUE: {
        priority: 8,
        keywords: [
            'account blocked', 'account suspended', 'banned',
            'cannot login', 'login problem', 'login issue',
            'otp not received', 'otp nahi aa raha',
            'account band', 'block ho gaya', 'suspend ho gaya',
            'login nahi ho raha'
        ]
    },

    THANKS: {
        priority: 1,
        keywords: [
            'thanks', 'thank you', 'thankyou', 'ty', 'thnx',
            'dhanyawad', 'dhanyavaad', 'shukriya', 'ok thanks',
            'solved', 'resolved', 'done', 'got it', 'problem solved',
            'theek hai', 'thik hai', 'sahi hai', 'ho gaya',
            'ok', 'okay', 'accha', 'acha', 'thik'
        ]
    },

    TALK_TO_HUMAN: {
        priority: 9,
        keywords: [
            'talk to agent', 'talk to human', 'real person',
            'customer care', 'customer support', 'agent se baat',
            'insaan se baat', 'support team', 'call me',
            'phone number', 'speak to someone', 'admin se baat',
            'kisi se baat karao', 'agent connect karo'
        ]
    }
};

// ─── Keyword-Based Intent Detection (Tier 1) ───────────────

// Escape special regex characters in keywords
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectIntentKeywords(message) {
    if (!message || typeof message !== 'string') {
        return { intent: 'UNKNOWN', confidence: 0, matchedKeywords: [] };
    }

    const normalizedMsg = message.toLowerCase().trim()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ');

    let bestIntent = 'UNKNOWN';
    let bestScore = 0;
    let bestPriority = 0;
    let bestMatches = [];

    for (const [intentName, intentDef] of Object.entries(INTENTS)) {
        let score = 0;
        const matchedKeywords = [];

        for (const keyword of intentDef.keywords) {
            const normalizedKeyword = keyword.toLowerCase();

            // Use word boundary matching to prevent 'hi' matching inside 'nhi'
            const pattern = new RegExp(`(?:^|\\s|\\b)${escapeRegex(normalizedKeyword)}(?:\\s|\\b|$)`, 'i');

            if (pattern.test(normalizedMsg)) {
                const wordCount = normalizedKeyword.split(' ').length;
                score += wordCount * 2;
                matchedKeywords.push(keyword);
            }
        }

        if (score > bestScore || (score === bestScore && intentDef.priority > bestPriority)) {
            bestScore = score;
            bestPriority = intentDef.priority;
            bestIntent = intentName;
            bestMatches = matchedKeywords;
        }
    }

    const confidence = Math.min(1, bestScore / 6);

    return {
        intent: bestScore > 0 ? bestIntent : 'UNKNOWN',
        confidence,
        matchedKeywords: bestMatches
    };
}

// ─── Gemini AI Intent Detection (Tier 2 — Fallback) ────────

async function detectIntentAI(message) {
    try {
        const ai = getAI();

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: `${CLASSIFICATION_PROMPT}\n\nUser message: "${message}"`,
            config: {
                temperature: 0.1,
                maxOutputTokens: 30
            }
        });

        const text = response.text.trim().toUpperCase().replace(/[^A-Z_]/g, '');

        // Validate it's a known intent
        if (VALID_INTENTS.includes(text)) {
            return { intent: text, confidence: 0.85, source: 'gemini' };
        }

        console.log('[NLP] Gemini returned unrecognized intent:', text);
        return { intent: 'UNKNOWN', confidence: 0, source: 'gemini' };
    } catch (err) {
        console.error('[NLP] Gemini AI error:', err.message);
        return { intent: 'UNKNOWN', confidence: 0, source: 'gemini_error' };
    }
}

// ─── Main Detection Function (Two-Tier) ────────────────────

/**
 * Detect user intent from a message.
 * 
 * Tier 1: Keyword matching (instant, free)
 * Tier 2: Gemini AI (if keyword confidence < 0.4)
 * 
 * @param {string} message
 * @returns {Promise<{ intent: string, confidence: number, source: string }>}
 */
async function detectIntent(message) {
    // Tier 1: Keyword matching
    const keywordResult = detectIntentKeywords(message);

    // If keywords are confident enough, use them (fast path)
    if (keywordResult.confidence >= 0.4) {
        return {
            intent: keywordResult.intent,
            confidence: keywordResult.confidence,
            source: 'keywords'
        };
    }

    // Tier 2: Ask Gemini AI
    const aiResult = await detectIntentAI(message);

    // If AI found something, use it
    if (aiResult.intent !== 'UNKNOWN') {
        return aiResult;
    }

    // If keyword had some match (even low), prefer it over nothing
    if (keywordResult.intent !== 'UNKNOWN') {
        return {
            intent: keywordResult.intent,
            confidence: keywordResult.confidence,
            source: 'keywords_low'
        };
    }

    // Neither could classify
    return { intent: 'UNKNOWN', confidence: 0, source: 'none' };
}

module.exports = { detectIntent, detectIntentKeywords, INTENTS, VALID_INTENTS };
