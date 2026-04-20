/**
 * Supabase Helper for Cloud Functions
 * Provides dual-write capability: RTDB + Supabase
 * This ensures data stays in sync during migration period.
 */

const functions = require('firebase-functions');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://zrucdzkgrmtwhykvplqs.supabase.co';
const SUPABASE_SERVICE_KEY = functions.config().supabase?.service_key || '';
if (!SUPABASE_SERVICE_KEY) {
    console.warn('[Supabase] service_key not set. Run: firebase functions:config:set supabase.service_key="YOUR_KEY"');
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Sync a match to Supabase (upsert)
 * Call this after any RTDB match write
 */
async function syncMatch(matchId, matchData) {
    try {
        await supa.from('matches').upsert({
            id: matchId,
            game_id: matchData.gameId || null,
            title: matchData.title || null,
            type: matchData.type || 'SOLO',
            status: matchData.status || 'UPCOMING',
            entry_fee: matchData.entryFee || 0,
            prize_pool: matchData.prizePool || 0,
            per_kill: matchData.perKill || 0,
            max_participants: matchData.maxParticipants || 100,
            date_time: matchData.dateTime || null,
            room_id: matchData.roomId || null,
            room_password: matchData.roomPassword || null,
            map: matchData.map || null,
            version: matchData.version || null,
            created_by: matchData.createdBy || null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (e) {
        console.error('[Supabase] syncMatch error:', e.message);
    }
}

/**
 * Sync a participant to Supabase (upsert)
 */
async function syncParticipant(matchId, userUid, participantData) {
    try {
        await supa.from('match_participants').upsert({
            match_id: matchId,
            user_uid: userUid,
            username: participantData.username || null,
            slot_number: participantData.slotNumber || null,
            kills: participantData.kills || 0,
            placement: participantData.placement || null,
            prize_amount: participantData.prizeAmount || 0,
            booked_by: participantData.bookedBy || userUid,
            team_name: participantData.teamName || null,
            joined_at: new Date().toISOString()
        }, { onConflict: 'match_id, user_uid' });
    } catch (e) {
        console.error('[Supabase] syncParticipant error:', e.message);
    }
}

/**
 * Sync a transaction to Supabase (upsert)
 */
async function syncTransaction(txnId, txnData) {
    try {
        await supa.from('transactions').upsert({
            id: txnId,
            user_uid: txnData.userId || null,
            type: txnData.type || 'DEBIT',
            amount: txnData.amount || 0,
            balance_type: txnData.walletType || null,
            description: txnData.reason || txnData.description || null,
            match_id: txnData.matchId || null,
            status: txnData.status || 'completed',
            from_deposit: txnData.fromDeposit || txnData.depositDeducted || 0,
            from_winning: txnData.fromWinning || txnData.winningDeducted || 0,
            created_at: txnData.timestamp ? new Date(txnData.timestamp).toISOString() : new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (e) {
        console.error('[Supabase] syncTransaction error:', e.message);
    }
}

/**
 * Sync user profile/balance to Supabase
 */
async function syncUserProfile(uid, userData) {
    try {
        await supa.from('profiles').upsert({
            uid: uid,
            username: userData.username || null,
            full_name: userData.fullName || null,
            email: userData.email || null,
            phone: userData.phone || null,
            deposit_balance: userData.depositBalance || 0,
            winning_balance: userData.winningBalance || 0,
            total_matches: userData.totalMatches || 0,
            total_wins: userData.totalWins || 0,
            is_blocked: userData.isBlocked || false,
            is_vip: userData.isVip || false
        }, { onConflict: 'uid' });
    } catch (e) {
        console.error('[Supabase] syncUserProfile error:', e.message);
    }
}

/**
 * Sync withdrawal to Supabase
 */
async function syncWithdrawal(withdrawalId, data) {
    try {
        await supa.from('withdrawals').upsert({
            id: withdrawalId,
            user_uid: data.userId || null,
            amount: data.amount || 0,
            net_amount: data.payoutAmount || data.amount || 0,
            fee_amount: data.feeAmount || 0,
            status: (data.status || 'pending').toLowerCase(),
            upi_id: data.upiId || null,
            admin_note: data.adminNote || null,
            processed_by: data.processedBy || null,
            created_at: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (e) {
        console.error('[Supabase] syncWithdrawal error:', e.message);
    }
}

/**
 * Sync match status update (e.g. UPCOMING → LIVE → COMPLETED)
 */
async function syncMatchStatus(matchId, status) {
    try {
        await supa.from('matches').update({ 
            status: status,
            updated_at: new Date().toISOString() 
        }).eq('id', matchId);
    } catch (e) {
        console.error('[Supabase] syncMatchStatus error:', e.message);
    }
}

/**
 * Sync match results (kills, placement, prizes for all participants)
 */
async function syncMatchResults(matchId, participants) {
    try {
        const updates = Object.entries(participants).map(([uid, p]) => ({
            match_id: matchId,
            user_uid: uid,
            kills: p.kills || 0,
            placement: p.placement || null,
            prize_amount: p.prizeAmount || 0
        }));

        for (const update of updates) {
            await supa.from('match_participants')
                .update({ kills: update.kills, placement: update.placement, prize_amount: update.prize_amount })
                .eq('match_id', matchId)
                .eq('user_uid', update.user_uid);
        }
    } catch (e) {
        console.error('[Supabase] syncMatchResults error:', e.message);
    }
}

module.exports = {
    supa,
    syncMatch,
    syncParticipant,
    syncTransaction,
    syncUserProfile,
    syncWithdrawal,
    syncMatchStatus,
    syncMatchResults
};
