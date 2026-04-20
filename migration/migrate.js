/**
 * JeetoPlay Migration Script: Firebase RTDB → Supabase
 * 
 * Usage:
 * 1. Export Firebase data: firebase database:get / --project jeetoplay-325f1 > migration/firebase_export.json
 * 2. Set env vars: SUPABASE_URL and SUPABASE_SERVICE_KEY
 * 3. Run: node migration/migrate.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase connection (use SERVICE ROLE key, not anon key — for admin writes)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrucdzkgrmtwhykvplqs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Load Firebase export
const dataPath = path.join(__dirname, 'firebase_export.json');
if (!fs.existsSync(dataPath)) {
    console.error('❌ firebase_export.json not found! Run:');
    console.error('   firebase database:get / --project jeetoplay-325f1 > migration/firebase_export.json');
    process.exit(1);
}

console.log('📖 Loading Firebase export...');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

async function migrateGames() {
    const games = data.esports_games || {};
    const rows = Object.entries(games).map(([id, g]) => ({
        id,
        name: g.name || '',
        icon: g.icon || '',
        banner: g.banner || '',
        is_enabled: g.isEnabled !== false,
        sort_order: g.order || 0
    }));

    if (rows.length === 0) return console.log('⚠️  No games to migrate');

    const { error } = await supabase.from('games').upsert(rows);
    if (error) console.error('❌ Games error:', error.message);
    else console.log(`✅ Migrated ${rows.length} games`);
}

async function migrateProfiles() {
    const users = data.users || {};
    const rows = Object.entries(users).map(([uid, u]) => ({
        uid,
        username: u.username || u.fullName || '',
        full_name: u.fullName || '',
        email: u.email || '',
        phone: u.phone || '',
        avatar_url: u.avatarUrl || u.photoUrl || '',
        deposit_balance: parseFloat(u.depositBalance || 0),
        winning_balance: parseFloat(u.winningBalance || 0),
        total_matches: parseInt(u.totalMatches || 0),
        total_wins: parseInt(u.totalWins || 0),
        referral_code: u.referralCode || null,
        referred_by: u.referredBy || null,
        is_blocked: u.isBlocked === true,
        is_vip: u.isVip === true,
        vip_data: u.vip || {},
        spin_data: u.spinData || {},
        daily_reward: u.dailyReward || {},
        theme_preference: u.themePreference || 'dark'
    }));

    // Insert in batches of 500
    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from('profiles').upsert(batch);
        if (error) console.error(`❌ Profiles batch ${i} error:`, error.message);
        else console.log(`✅ Migrated profiles ${i + 1}-${Math.min(i + 500, rows.length)} of ${rows.length}`);
    }
}

async function migrateMatches() {
    const matches = data.esports_matches || {};
    const matchRows = [];
    const participantRows = [];

    Object.entries(matches).forEach(([id, m]) => {
        matchRows.push({
            id,
            game_id: m.gameId || null,
            title: m.title || '',
            type: m.type || 'SOLO',
            status: m.status || 'UPCOMING',
            entry_fee: parseFloat(m.entryFee || 0),
            prize_pool: parseFloat(m.prizePool || 0),
            per_kill: parseFloat(m.perKill || 0),
            max_participants: parseInt(m.maxParticipants || 100),
            date_time: m.dateTime ? new Date(m.dateTime).toISOString() : null,
            room_id: m.roomId || null,
            room_password: m.roomPassword || null,
            map: m.map || null,
            version: m.version || null,
            created_by: m.createdBy || null,
            created_at: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString()
        });

        // Extract participants
        if (m.participants) {
            Object.entries(m.participants).forEach(([pKey, p]) => {
                if (typeof p === 'object') {
                    participantRows.push({
                        match_id: id,
                        user_uid: p.bookedBy || p.uid || pKey,
                        username: p.username || p.name || '',
                        slot_number: p.slotNumber || null,
                        kills: parseInt(p.kills || 0),
                        placement: p.placement || null,
                        prize_amount: parseFloat(p.prizeAmount || 0),
                        booked_by: p.bookedBy || null,
                        team_name: p.teamName || null
                    });
                } else {
                    // Legacy format: uid as key, value is simple
                    participantRows.push({
                        match_id: id,
                        user_uid: pKey,
                        username: '',
                        slot_number: null,
                        kills: 0
                    });
                }
            });
        }
    });

    // Insert matches in batches
    for (let i = 0; i < matchRows.length; i += 200) {
        const batch = matchRows.slice(i, i + 200);
        const { error } = await supabase.from('matches').upsert(batch);
        if (error) console.error(`❌ Matches batch ${i} error:`, error.message);
        else console.log(`✅ Migrated matches ${i + 1}-${Math.min(i + 200, matchRows.length)} of ${matchRows.length}`);
    }

    // Insert participants in batches
    for (let i = 0; i < participantRows.length; i += 500) {
        const batch = participantRows.slice(i, i + 500);
        const { error } = await supabase.from('match_participants').upsert(batch, { onConflict: 'match_id,user_uid' });
        if (error) console.error(`❌ Participants batch ${i} error:`, error.message);
        else console.log(`✅ Migrated participants ${i + 1}-${Math.min(i + 500, participantRows.length)} of ${participantRows.length}`);
    }
}

async function migrateTransactions() {
    const txns = data.wallet_transactions || {};
    const rows = Object.entries(txns).map(([id, t]) => ({
        id,
        user_uid: t.uid || t.userId || '',
        type: t.type || 'unknown',
        amount: parseFloat(t.amount || 0),
        balance_type: t.balanceType || null,
        description: t.description || '',
        match_id: t.matchId || null,
        status: t.status || 'completed',
        from_deposit: parseFloat(t.fromDeposit || 0),
        from_winning: parseFloat(t.fromWinning || 0),
        created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString()
    }));

    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from('transactions').upsert(batch);
        if (error) console.error(`❌ Transactions batch ${i} error:`, error.message);
        else console.log(`✅ Migrated transactions ${i + 1}-${Math.min(i + 500, rows.length)} of ${rows.length}`);
    }
}

async function migrateDeposits() {
    const deps = data.deposits || {};
    const rows = Object.entries(deps).map(([id, d]) => ({
        id,
        user_uid: d.uid || d.userId || '',
        amount: parseFloat(d.amount || 0),
        status: d.status || 'PENDING',
        payment_method: d.method || d.paymentMethod || null,
        transaction_id: d.transactionId || null,
        created_at: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString()
    }));

    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from('deposits').upsert(batch);
        if (error) console.error(`❌ Deposits batch ${i} error:`, error.message);
        else console.log(`✅ Migrated deposits ${i + 1}-${Math.min(i + 500, rows.length)} of ${rows.length}`);
    }
}

async function migrateWithdrawals() {
    const wds = data.withdrawals || {};
    const rows = Object.entries(wds).map(([id, w]) => ({
        id,
        user_uid: w.uid || w.userId || '',
        amount: parseFloat(w.amount || 0),
        net_amount: parseFloat(w.netAmount || w.amount || 0),
        fee_amount: parseFloat(w.feeAmount || 0),
        status: w.status || 'pending',
        upi_id: w.upiId || null,
        admin_note: w.adminNote || null,
        processed_by: w.processedBy || null,
        created_at: w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString(),
        processed_at: w.processedAt ? new Date(w.processedAt).toISOString() : null
    }));

    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from('withdrawals').upsert(batch);
        if (error) console.error(`❌ Withdrawals batch ${i} error:`, error.message);
        else console.log(`✅ Migrated withdrawals ${i + 1}-${Math.min(i + 500, rows.length)} of ${rows.length}`);
    }
}

async function migrateReferralStats() {
    const stats = data.referral_stats || {};
    const rows = Object.entries(stats).map(([uid, s]) => ({
        uid,
        total_referrals: parseInt(s.totalReferrals || 0),
        total_earned: parseFloat(s.totalEarned || 0)
    }));

    if (rows.length === 0) return;
    const { error } = await supabase.from('referral_stats').upsert(rows);
    if (error) console.error('❌ Referral stats error:', error.message);
    else console.log(`✅ Migrated ${rows.length} referral stats`);
}

async function migrateLudoMatches() {
    const ludo = data.ludo_matches || {};
    const rows = Object.entries(ludo).map(([id, m]) => ({
        id,
        creator_uid: m.creator?.uid || '',
        creator_username: m.creator?.username || '',
        acceptor_uid: m.acceptor?.uid || null,
        acceptor_username: m.acceptor?.username || null,
        amount: parseFloat(m.amount || 0),
        status: m.status || 'waiting',
        winner_uid: m.winnerUid || null,
        room_code: m.roomCode || null,
        creator_result: m.creatorResult || null,
        acceptor_result: m.acceptorResult || null,
        created_at: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString()
    }));

    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from('ludo_matches').upsert(batch);
        if (error) console.error(`❌ Ludo batch ${i} error:`, error.message);
        else console.log(`✅ Migrated ludo matches ${i + 1}-${Math.min(i + 500, rows.length)} of ${rows.length}`);
    }
}

async function migratePlatformConfig() {
    const config = data.platform_config || {};
    const rows = Object.entries(config).map(([key, value]) => ({
        key,
        value: typeof value === 'object' ? value : { value }
    }));

    if (rows.length === 0) return;
    const { error } = await supabase.from('platform_config').upsert(rows);
    if (error) console.error('❌ Config error:', error.message);
    else console.log(`✅ Migrated ${rows.length} config entries`);
}

async function migrateAnnouncements() {
    const bar = data.announcement_bar;
    if (bar) {
        const { error } = await supabase.from('announcements').upsert([{
            id: 1,
            text: bar.text || '',
            is_active: bar.isActive === true,
            link: bar.link || null
        }]);
        if (error) console.error('❌ Announcement error:', error.message);
        else console.log('✅ Migrated announcement bar');
    }
}

async function migrateSlider() {
    const slider = data.home_slider || {};
    const rows = Object.entries(slider).map(([id, s]) => ({
        id,
        image: s.image || s.url || '',
        link: s.link || null,
        sort_order: s.order || 0,
        is_active: true
    }));

    if (rows.length === 0) return;
    const { error } = await supabase.from('home_slider').upsert(rows);
    if (error) console.error('❌ Slider error:', error.message);
    else console.log(`✅ Migrated ${rows.length} slider images`);
}

// ============ RUN MIGRATION ============
async function main() {
    console.log('🚀 Starting JeetoPlay Migration: Firebase → Supabase\n');
    
    try {
        await migrateGames();
        await migrateProfiles();
        await migrateMatches();
        await migrateTransactions();
        await migrateDeposits();
        await migrateWithdrawals();
        await migrateReferralStats();
        await migrateLudoMatches();
        await migratePlatformConfig();
        await migrateAnnouncements();
        await migrateSlider();
        
        console.log('\n🎉 Migration complete!');
        console.log('Next steps:');
        console.log('1. Verify data in Supabase Dashboard → Table Editor');
        console.log('2. Update client JS to use Supabase');
        console.log('3. Test all features');
        console.log('4. Switch over');
    } catch (err) {
        console.error('\n💥 Migration failed:', err.message);
        process.exit(1);
    }
}

main();
