exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};
  const clientId     = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const redirectUri  = process.env.XERO_REDIRECT_URI || 'https://thic-sales.netlify.app/xero-callback';
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY;

  const page = (msg, success) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Xero</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;
    background:#0f1117;color:#e2e8f0;margin:0}.box{text-align:center;padding:40px;background:#1a1f2e;
    border-radius:16px;border:1px solid #2d3748;max-width:400px}.icon{font-size:3rem;margin-bottom:16px}
    .msg{margin-bottom:24px;color:#94a3b8;font-size:.9rem}
    a{padding:12px 28px;background:#0a4fa6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}</style>
    </head><body><div class="box">
    <div class="icon">${success ? '✅' : '❌'}</div>
    <h2 style="margin:0 0 8px">${success ? 'Xero Connected!' : 'Connection Failed'}</h2>
    <div class="msg">${msg}</div>
    <a href="/">Back to SalesTrack</a>
    </div></body></html>`
  });

  if (error) return page('Xero returned: ' + error, false);
  if (!code)  return page('No authorisation code received.', false);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
      },
      body: 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(redirectUri)
    });

    if (!tokenRes.ok) return page('Token exchange failed: ' + await tokenRes.text(), false);
    const tokens = await tokenRes.json();

    // Get tenant ID
    const tenantsRes = await fetch('https://api.xero.com/connections', {
      headers: { 'Authorization': 'Bearer ' + tokens.access_token }
    });
    const tenants = await tenantsRes.json();
    if (!tenants.length) return page('No Xero organisation found.', false);

    const payload = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    Date.now() + tokens.expires_in * 1000,
      tenant_id:     tenants[0].tenantId,
      org_name:      tenants[0].tenantName,
      connected_at:  new Date().toISOString()
    };

    // Store tokens in Supabase
    await fetch(supabaseUrl + '/rest/v1/app_config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ id: 'xero_tokens', data: JSON.stringify(payload), updated_at: new Date().toISOString() })
    });

    return page('Connected to <strong>' + tenants[0].tenantName + '</strong>. Go back and click Sync Now.', true);
  } catch (e) {
    return page('Unexpected error: ' + e.message, false);
  }
};
