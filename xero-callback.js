// netlify/functions/xero-callback.js
// Handles OAuth return from Xero, exchanges code for tokens, stores in Supabase

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};
  const APP_URL = process.env.URL || 'https://thic-sales-app.netlify.app';

  if (error) {
    return redirect(`${APP_URL}/#xero-error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return redirect(`${APP_URL}/#xero-error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI
      }).toString()
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', err);
      return redirect(`${APP_URL}/#xero-error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    // tokens: { access_token, refresh_token, expires_in, token_type }

    // Get tenant/org ID
    const tenantsRes = await fetch('https://api.xero.com/connections', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    const tenants = await tenantsRes.json();
    const tenantId = tenants[0]?.tenantId;

    if (!tenantId) {
      return redirect(`${APP_URL}/#xero-error=no_tenant`);
    }

    // Store tokens in Supabase
    const expiresAt = Date.now() + (tokens.expires_in * 1000);
    const payload = {
      id: 'xero_tokens',
      value: JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        tenant_id: tenantId,
        connected_at: new Date().toISOString()
      })
    };

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/app_config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    return redirect(`${APP_URL}/#xero-connected=true`);

  } catch (err) {
    console.error('Xero callback error:', err);
    return redirect(`${APP_URL}/#xero-error=${encodeURIComponent(err.message)}`);
  }
};

function redirect(url) {
  return {
    statusCode: 302,
    headers: { Location: url },
    body: ''
  };
}
