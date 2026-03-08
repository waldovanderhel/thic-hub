exports.handler = async (event) => {
  const clientId = process.env.XERO_CLIENT_ID;
  const redirectUri = process.env.XERO_REDIRECT_URI || 'https://thic-sales.netlify.app/xero-callback';

  if (!clientId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'XERO_CLIENT_ID not configured in Netlify environment variables' })
    };
  }

  const scopes = [
    'openid', 'profile', 'email',
    'accounting.transactions',
    'accounting.contacts',
    'accounting.settings',
    'offline_access'
  ].join(' ');

  const state = Math.random().toString(36).substring(2, 15);

  const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  return {
    statusCode: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': `xero_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    },
    body: ''
  };
};
