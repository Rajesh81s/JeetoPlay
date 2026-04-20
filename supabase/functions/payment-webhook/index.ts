import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zrucdzkgrmtwhykvplqs.supabase.co'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method === 'GET') return new Response('Webhook Active', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    // Merge query params and body
    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams)
    let bodyParams = {}
    try { bodyParams = await req.json() } catch { 
      try { 
        const text = await req.text()
        bodyParams = Object.fromEntries(new URLSearchParams(text))
      } catch {} 
    }
    const data = { ...queryParams, ...bodyParams }

    const txnId = data.order_id || data.transaction_id || data.orderId
    const rawStatus = data.status || data.txn_status || data.transaction_status

    console.log('Webhook received:', { txnId, rawStatus })

    if (!txnId) return jsonRes({ error: 'Missing order_id' }, 400)

    // Find transaction in Supabase
    let { data: txnData, error: txnErr } = await supa.from('transactions')
      .select('*').eq('id', txnId).single()

    // Fallback: search by tranzupi_order_id in description
    if (txnErr || !txnData) {
      const { data: allTxns } = await supa.from('transactions')
        .select('*')
        .eq('type', 'DEPOSIT')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(50)

      txnData = allTxns?.find(t => {
        try {
          const desc = JSON.parse(t.description || '{}')
          return desc.tranzupi_order_id === txnId
        } catch { return false }
      }) || null
    }

    if (!txnData) return jsonRes({ error: 'Transaction not found' }, 404)
    if (txnData.status === 'SUCCESS') return jsonRes({ success: true, message: 'Already processed' })

    // Check if payment succeeded
    const s = String(rawStatus || '').toLowerCase()
    const isSuccess = ['success', 'true', 'captured', 'completed'].includes(s)

    if (!isSuccess) {
      await supa.from('transactions').update({
        description: JSON.stringify({ ...safeParse(txnData.description), webhook_status: rawStatus })
      }).eq('id', txnData.id)
      return jsonRes({ success: false, message: 'Payment not successful' })
    }

    // Cross-verify with gateway
    const { data: payConfig } = await supa.from('platform_config').select('value').eq('key', 'payments').single()
    const config = payConfig?.value || {}
    const gateway = txnData.balance_type || ''

    if (gateway === 'tranzupi' && config.tranzupi_token) {
      try {
        const descData = safeParse(txnData.description)
        const tranzupiOrderId = descData.tranzupi_order_id || String(txnId).replace(/\D/g, '')
        
        const verifyRes = await fetch('https://tranzupi.com/api/check-order-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            user_token: config.tranzupi_token,
            order_id: tranzupiOrderId
          }).toString()
        })
        const verifyJson = await verifyRes.json()
        const tranzStatus = String(verifyJson?.status || '').toUpperCase()
        const innerStatus = String(verifyJson?.result?.status || verifyJson?.result?.txnStatus || '').toUpperCase()
        
        if (tranzStatus !== 'SUCCESS' && tranzStatus !== 'COMPLETED') {
          if (innerStatus !== 'SUCCESS' && innerStatus !== 'COMPLETED') {
            return jsonRes({ success: false, message: 'Payment not confirmed by gateway' })
          }
        }
      } catch (e) {
        console.warn('Cross-verify error:', e.message)
      }
    }

    // Credit the user's balance
    const userId = txnData.user_uid
    const amount = Math.abs(parseFloat(txnData.amount) || 0)
    if (amount <= 0) return jsonRes({ error: 'Invalid amount' }, 400)

    // Update transaction status
    await supa.from('transactions').update({
      status: 'SUCCESS',
      description: JSON.stringify({
        ...safeParse(txnData.description),
        gateway_response: data,
        verified_by: 'WEBHOOK_AUTO',
        processed_at: Date.now()
      })
    }).eq('id', txnData.id)

    // Credit deposit balance
    const { data: profile } = await supa.from('profiles')
      .select('deposit_balance, winning_balance')
      .eq('uid', userId).single()
    
    const newDeposit = (parseFloat(profile?.deposit_balance) || 0) + amount
    const newWallet = newDeposit + (parseFloat(profile?.winning_balance) || 0)

    await supa.from('profiles').update({
      deposit_balance: newDeposit
    }).eq('uid', userId)

    console.log(`✅ Credited ₹${amount} to ${userId}. New deposit: ${newDeposit}`)

    return jsonRes({ success: true, message: 'Balance updated' })

  } catch (error) {
    console.error('Webhook error:', error)
    return jsonRes({ error: error.message }, 500)
  }
})

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function safeParse(str: string | null): any {
  try { return JSON.parse(str || '{}') } catch { return {} }
}
