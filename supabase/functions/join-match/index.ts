import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zrucdzkgrmtwhykvplqs.supabase.co'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const { uid, matchId, ign, slotsToBook, gameId } = await req.json()
    if (!uid) return jsonRes({ error: 'uid required' }, 400)
    if (!matchId) return jsonRes({ error: 'matchId required' }, 400)
    if (!ign) return jsonRes({ error: 'IGN required' }, 400)

    // Sanitize IGN
    const sanitizeIgn = (val: any) => String(val || '').replace(/<[^>]*>/g, '').trim().substring(0, 30)
    const sanitizedIgn = Array.isArray(ign) ? ign.map(sanitizeIgn) : sanitizeIgn(ign)
    const primaryIgn = Array.isArray(sanitizedIgn) ? sanitizedIgn[0] : sanitizedIgn

    // Check user not banned
    const { data: profile } = await supa.from('profiles')
      .select('uid, deposit_balance, winning_balance, is_blocked, username, full_name')
      .eq('uid', uid).single()
    
    if (!profile) return jsonRes({ error: 'User not found' }, 404)
    if (profile.is_blocked) return jsonRes({ error: 'Account is blocked' }, 403)

    // Get match data
    const { data: match } = await supa.from('matches')
      .select('*').eq('id', matchId).single()
    
    if (!match) return jsonRes({ error: 'Match not found' }, 404)
    if (match.status !== 'UPCOMING') return jsonRes({ error: 'Match is not open for joining' }, 400)

    // Determine slots
    const isDuoSquad = Array.isArray(slotsToBook) && slotsToBook.length > 0
    const slotsCount = isDuoSquad ? slotsToBook.length : 1
    const entryFee = (match.entry_fee || 0) * slotsCount

    // Check current participants count
    const { count: currentCount } = await supa.from('match_participants')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', matchId)
    
    const maxSlots = match.max_participants || 100
    if ((currentCount || 0) + slotsCount > maxSlots) {
      return jsonRes({ error: 'Match is full' }, 400)
    }

    // Check if user already joined
    const { data: existing } = await supa.from('match_participants')
      .select('id').eq('match_id', matchId).eq('user_uid', uid).limit(1)
    
    if (existing && existing.length > 0) {
      return jsonRes({ error: 'Already joined this match' }, 400)
    }

    // Calculate balance deduction (deposit first, then winning)
    const depositBal = parseFloat(profile.deposit_balance) || 0
    const winningBal = parseFloat(profile.winning_balance) || 0
    const totalBal = depositBal + winningBal

    if (totalBal < entryFee) {
      return jsonRes({ error: `Insufficient balance. Entry fee: 🪙 ${entryFee}` }, 400)
    }

    const depositDeducted = Math.min(depositBal, entryFee)
    const winningDeducted = entryFee - depositDeducted
    const newDepositBalance = depositBal - depositDeducted
    const newWinningBalance = winningBal - winningDeducted

    // Deduct balance
    const { error: balErr } = await supa.from('profiles').update({
      deposit_balance: newDepositBalance,
      winning_balance: newWinningBalance
    }).eq('uid', uid)

    if (balErr) {
      console.error('Balance deduction error:', balErr)
      return jsonRes({ error: 'Failed to deduct balance' }, 500)
    }

    // Insert participant(s)
    const participants = []
    if (isDuoSquad) {
      for (let i = 0; i < slotsToBook.length; i++) {
        const slot = slotsToBook[i]
        participants.push({
          match_id: matchId,
          user_uid: uid + '_team' + slot.team + '_pos' + slot.position,
          username: Array.isArray(sanitizedIgn) ? sanitizedIgn[i] : primaryIgn,
          slot_number: slot.position,
          team_name: `Team ${slot.team}`,
          booked_by: uid,
          joined_at: new Date().toISOString()
        })
      }
    } else {
      participants.push({
        match_id: matchId,
        user_uid: uid,
        username: primaryIgn,
        slot_number: (currentCount || 0) + 1,
        booked_by: uid,
        joined_at: new Date().toISOString()
      })
    }

    const { error: partErr } = await supa.from('match_participants').insert(participants)
    if (partErr) {
      // Rollback balance
      await supa.from('profiles').update({
        deposit_balance: depositBal,
        winning_balance: winningBal
      }).eq('uid', uid)
      console.error('Participant insert error:', partErr)
      return jsonRes({ error: 'Failed to book slot: ' + partErr.message }, 500)
    }

    // Create transaction record
    const txnId = `join_${matchId}_${uid}_${Date.now()}`
    await supa.from('transactions').insert({
      id: txnId,
      user_uid: uid,
      type: 'DEBIT',
      amount: entryFee,
      status: 'SUCCESS',
      description: `${match.title || 'Match'} (${slotsCount} slot${slotsCount > 1 ? 's' : ''})`,
      balance_type: `dep:${depositDeducted},win:${winningDeducted}`,
      created_at: new Date().toISOString()
    })

    // Save IGN for this game
    if (gameId) {
      // Update game IGN in profiles JSONB or separate column
      const { data: currentProfile } = await supa.from('profiles')
        .select('spin_data').eq('uid', uid).single()
      // Store IGN in a simple way
      await supa.from('profiles').update({
        username: primaryIgn // Update username with latest IGN
      }).eq('uid', uid)
    }

    return jsonRes({
      success: true,
      depositDeducted,
      winningDeducted,
      newDepositBalance,
      newWinningBalance
    })

  } catch (error) {
    console.error('Join match error:', error)
    return jsonRes({ error: error.message }, 500)
  }
})

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
