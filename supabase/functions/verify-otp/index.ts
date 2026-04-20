import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts'
import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Import RSA key from PEM for signing JWTs
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binaryKey = base64Decode(pemContents)
  return crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

// Create Firebase custom token (same as admin.auth().createCustomToken)
async function createCustomToken(uid: string, saEmail: string, privateKey: CryptoKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: saEmail,
    sub: saEmail,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: uid,
  }

  const enc = new TextEncoder()
  const headerB64 = base64url(enc.encode(JSON.stringify(header)))
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`
  
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    enc.encode(signingInput)
  )
  const sigB64 = base64url(new Uint8Array(signature))
  return `${headerB64}.${payloadB64}.${sigB64}`
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)

  try {
    const { phone, accessToken } = await req.json()
    
    // Validate inputs
    const cleanPhone = (phone || '').toString().replace(/\D/g, '')
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return jsonRes({ error: 'Invalid phone number' }, 400)
    }
    if (!accessToken) {
      return jsonRes({ error: 'Access token required' }, 400)
    }

    // Get MSG91 auth key from Supabase config
    const supaUrl = Deno.env.get('SUPABASE_URL') || 'https://zrucdzkgrmtwhykvplqs.supabase.co'
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supa = createClient(supaUrl, supaKey)

    const { data: configRow } = await supa.from('platform_config')
      .select('value').eq('key', 'sms_api_key').single()
    const authKey = configRow?.value
    
    if (!authKey) {
      return jsonRes({ error: 'OTP service not configured' }, 500)
    }

    // Verify MSG91 access token server-side
    const verifyResponse = await fetch('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authkey: authKey, 'access-token': accessToken })
    })
    const verifyResult = await verifyResponse.json()
    console.log('[OTP] MSG91 verify result:', JSON.stringify(verifyResult))

    if (verifyResult.type !== 'success') {
      return jsonRes({ error: 'OTP verification failed. Please try again.' }, 403)
    }

    // Load Firebase service account
    const saKeyB64 = Deno.env.get('FIREBASE_SA_KEY_B64')
    if (!saKeyB64) {
      return jsonRes({ error: 'Firebase auth not configured' }, 500)
    }
    const saKey = JSON.parse(new TextDecoder().decode(base64Decode(saKeyB64)))
    const projectId = saKey.project_id
    const saEmail = saKey.client_email
    const privateKey = await importPrivateKey(saKey.private_key)

    // Get Google access token for Firebase Auth API
    const googleToken = await getGoogleAccessToken(saEmail, saKey.private_key)

    // Find or create Firebase Auth user
    const fullPhone = '+91' + cleanPhone
    let firebaseUid: string

    // Try to find existing user
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${googleToken}`
        },
        body: JSON.stringify({ phoneNumber: [fullPhone] })
      }
    )

    // Use Admin SDK REST API instead
    const listRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${googleToken}`
        },
        body: JSON.stringify({ phoneNumber: [fullPhone] })
      }
    )
    const listData = await listRes.json()

    if (listData.users && listData.users.length > 0) {
      firebaseUid = listData.users[0].localId
      console.log('[OTP] Existing user:', firebaseUid)
    } else {
      // Create new user
      const createRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${googleToken}`
          },
          body: JSON.stringify({ phoneNumber: fullPhone })
        }
      )
      const createData = await createRes.json()
      if (createData.error) {
        console.error('[OTP] Create user error:', createData.error)
        return jsonRes({ error: 'Failed to create user' }, 500)
      }
      firebaseUid = createData.localId
      console.log('[OTP] New user created:', firebaseUid)
    }

    // Create Firebase custom token
    const customToken = await createCustomToken(firebaseUid, saEmail, privateKey)
    console.log('[OTP] Custom token generated for:', firebaseUid)

    return jsonRes({ success: true, token: customToken })

  } catch (error) {
    console.error('[OTP] Error:', error)
    return jsonRes({ error: 'Authentication failed. Please try again.' }, 500)
  }
})

// Get Google OAuth2 access token using service account
async function getGoogleAccessToken(email: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }

  const key = await importPrivateKey(privateKeyPem)
  const enc = new TextEncoder()
  const headerB64 = base64url(enc.encode(JSON.stringify(header)))
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`
  
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput))
  const sigB64 = base64url(new Uint8Array(signature))
  const jwt = `${headerB64}.${payloadB64}.${sigB64}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  })
  const tokenData = await tokenRes.json()
  if (tokenData.error) {
    throw new Error(`Google token error: ${tokenData.error_description || tokenData.error}`)
  }
  return tokenData.access_token
}

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
