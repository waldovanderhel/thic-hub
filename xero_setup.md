# THIC SalesTrack - Xero Integration Setup

## Files to Add to Your Project

Copy into your project structure:
```
your-project/
  index.html
  _redirects          (replace existing)
  netlify.toml        (new)
  netlify/functions/
    xero-auth.js
    xero-callback.js
    xero-sync.js
```

## Step 1 - Netlify Environment Variables

Go to: Netlify > Site Settings > Environment Variables

Add these:

  XERO_CLIENT_ID      = 8C49B128B0A645C898AD49D014DD7844
  XERO_CLIENT_SECRET  = (your secret from Xero developer portal)
  XERO_REDIRECT_URI   = https://thic-sales-app.netlify.app/xero-callback
  SUPABASE_URL        = https://oykwunvvqsqsmbouwxjr.supabase.co
  SUPABASE_KEY        = (your Supabase anon key)

NEVER put the Client Secret in your HTML - it must only live as a Netlify env var.

## Step 2 - Xero Developer Portal

At developer.xero.com, verify your app has:
- Redirect URI: https://thic-sales-app.netlify.app/xero-callback
- Scopes: accounting.transactions, accounting.contacts, accounting.settings.read, offline_access

## Step 3 - Deploy

Zip the whole project folder (including netlify/ subfolder) and drag into Netlify Deploys.
Or push to Git if your site is connected to a repo.

## Step 4 - Connect in SalesTrack

1. Open Finance tab
2. Click "Connect Xero"
3. Log in and approve access
4. Return to SalesTrack - Xero is now connected
5. Click "Sync Now" to pull all data

## How It Works

Sync Now calls /.netlify/functions/xero-sync which:
- Loads tokens from Supabase
- Refreshes token if expired
- Fetches Bills (costs), Invoices (revenue), Contacts, Accounts
- Aggregates into monthly actuals
- Saves to Supabase app_config table
- Finance tab reads from Supabase and displays live

## Troubleshooting

"No Xero tokens" - click Connect Xero first
Token refresh failed - disconnect and reconnect
No data after sync - check Xero has 2026 invoices
Redirect URI mismatch - must match exactly in both Netlify and Xero portal
