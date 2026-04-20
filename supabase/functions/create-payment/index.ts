import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zrucdzkgrmtwhykvplqs.supabase.co'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const REDIRECT_URL = 'https://jeetoplay-325f1.web.app/payment-callback.html'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const { amount, mobile, order_id, gateway_type, userId } = await req.json()
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Validate
    const parsedAmount = parseInt(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      return jsonResponse({ error: 'Invalid amount', status: false }, 400)
    }
    if (!order_id) return jsonResponse({ error: 'Missing order_id', status: false }, 400)
    if (!userId) return jsonResponse({ error: 'Missing userId', status: false }, 400)

    // Get payment config from Supabase
    const { data: payConfig } = await supa.from('platform_config').select('value').eq('key', 'payments').single()
    const config = payConfig?.value || {}

    const minDeposit = config.min_deposit || 1
    const maxDeposit = config.max_deposit || 9999
    if (parsedAmount < minDeposit) return jsonResponse({ error: `Minimum deposit is ₹${minDeposit}`, status: false }, 400)
    if (parsedAmount > maxDeposit) return jsonResponse({ error: `Maximum deposit is ₹${maxDeposit}`, status: false }, 400)

    // Create pending transaction in Supabase
    await supa.from('transactions').upsert({
      id: String(order_id),
      user_uid: userId,
      type: 'DEPOSIT',
      amount: parsedAmount,
      status: 'PENDING',
      description: 'Deposit',
      balance_type: gateway_type || 'tranzupi',
      created_at: new Date().toISOString()
    })

    // ─── TranzUPI Gateway ───
    if (gateway_type === 'tranzupi') {
      const tranzupi_token = config.tranzupi_token
      if (!tranzupi_token) return jsonResponse({ error: 'TranzUPI token not configured', status: false }, 400)

      const sanitizedMobile = String(mobile || '9999999999').replace(/\D/g, '').slice(-10) || '9999999999'
      const tranzupiOrderId = String(order_id).replace(/\D/g, '') || String(Date.now())

      // Update transaction with tranzupi order id
      await supa.from('transactions').update({ 
        balance_type: 'tranzupi',
        description: JSON.stringify({ tranzupi_order_id: tranzupiOrderId })
      }).eq('id', String(order_id))

      const body = new URLSearchParams({
        customer_mobile: sanitizedMobile,
        user_token: tranzupi_token,
        amount: String(parsedAmount) + '.00',
        order_id: tranzupiOrderId,
        redirect_url: REDIRECT_URL,
        remark1: 'deposit',
        remark2: String(order_id)
      })

      const res = await fetch('https://tranzupi.com/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })
      const json = await res.json()
      json._internalTxnId = order_id
      json._tranzupiOrderId = tranzupiOrderId
      return jsonResponse(json)
    }

    // ─── ZapUPI Gateway ───
    if (gateway_type === 'zapupi') {
      const token_key = config.zapupi_token
      const secret_key = config.zapupi_secret || ''
      if (!token_key) return jsonResponse({ error: 'ZapUPI token not configured', status: false }, 400)

      const body = new URLSearchParams({
        token_key, secret_key,
        amount: String(parsedAmount),
        order_id: String(order_id),
        customer_mobile: mobile || '9999999999',
        redirect_url: REDIRECT_URL,
        remark1: 'deposit', remark2: 'jeetoplay'
      })

      const res = await fetch('https://api.zapupi.com/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })
      return jsonResponse(await res.json())
    }

    return jsonResponse({ error: 'Unknown gateway_type', status: false }, 400)

  } catch (error) {
    console.error('Create payment error:', error)
    return jsonResponse({ error: error.message, status: false }, 500)
  }
})

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
