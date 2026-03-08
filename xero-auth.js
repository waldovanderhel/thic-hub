// netlify/functions/xero-auth.js
// Redirects user to Xero OAuth login page

exports.handler = async (event) => {
  const CLIENT_ID = process.env.XERO_CLIENT_ID;
  const REDIRECT_URI = process.env.XERO_REDIRECT_URI;

  const scopes = [
    'openid',
    'profile',
    'email',
    'accounting.transactions',
    'accounting.transactions.read',
    'accounting.contacts',
    'accounting.contacts.read',
    'accounting.settings.read',
    'offline_access'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: scopes,
    state: 'salestrack'
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://login.xero.com/identity/connect/authorize?${params.toString()}`
    },
    body: ''
  };
};
