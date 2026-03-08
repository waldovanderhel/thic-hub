const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const XC_ID  = process.env.XERO_CLIENT_ID;
const XC_SEC = process.env.XERO_CLIENT_SECRET;

async function sbGet(id) {
  const r = await fetch(`${SB_URL}/rest/v1/app_config?id=eq.${id}&select=data`, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
  });
  const rows = await r.json();
  return rows[0]?.data ? JSON.parse(rows[0].data) : null;
}

async function sbSet(id, data) {
  await fetch(`${SB_URL}/rest/v1/app_config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, data: JSON.stringify(data), updated_at: new Date().toISOString() })
  });
}

async function getValidToken() {
  const tokens = await sbGet('xero_tokens');
  if (!tokens) throw new Error('Xero not connected. Please connect Xero first.');
  if (Date.now() >= tokens.expires_at - 60000) {
    const r = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(XC_ID + ':' + XC_SEC).toString('base64') },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(tokens.refresh_token)
    });
    if (!r.ok) throw new Error('Token refresh failed');
    const f = await r.json();
    const updated = { ...tokens, access_token: f.access_token, refresh_token: f.refresh_token || tokens.refresh_token, expires_at: Date.now() + f.expires_in * 1000 };
    await sbSet('xero_tokens', updated);
    return updated;
  }
  return tokens;
}

function xDate(d) {
  if (!d) return null;
  const m = d.match(/\/Date\((\d+)/);
  return m ? new Date(parseInt(m[1])).toISOString().split('T')[0] : d;
}

async function xeroFetch(path, token, tenantId) {
  const r = await fetch('https://api.xero.com/api.xro/2.0/' + path, {
    headers: { Authorization: 'Bearer ' + token, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }
  });
  if (!r.ok) throw new Error('Xero API ' + r.status);
  return r.json();
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const tokens = await getValidToken();
    const { access_token: tok, tenant_id: tid } = tokens;

    // Fetch bills (costs), sales invoices (revenue), contacts
    const [billsResp, invResp, contactsResp] = await Promise.all([
      xeroFetch('Invoices?Type=ACCPAY&Statuses=AUTHORISED,PAID&page=1', tok, tid),
      xeroFetch('Invoices?Type=ACCREC&Statuses=AUTHORISED,PAID&page=1', tok, tid),
      xeroFetch('Contacts?summaryOnly=true', tok, tid)
    ]);

    const bills = (billsResp.Invoices || []).map(inv => ({
      xero_id: inv.InvoiceID, invoice_num: inv.InvoiceNumber,
      contact: inv.Contact?.Name || '', date: xDate(inv.Date), due_date: xDate(inv.DueDate),
      status: inv.Status, total: inv.Total || 0, amount_paid: inv.AmountPaid || 0, amount_due: inv.AmountDue || 0,
      currency: inv.CurrencyCode || 'EUR',
      line_items: (inv.LineItems || []).map(li => ({ description: li.Description || '', account_code: li.AccountCode || '', line_amount: li.LineAmount || 0 }))
    }));

    const invoices = (invResp.Invoices || []).map(inv => ({
      xero_id: inv.InvoiceID, invoice_num: inv.InvoiceNumber,
      contact: inv.Contact?.Name || '', date: xDate(inv.Date), due_date: xDate(inv.DueDate),
      status: inv.Status, total: inv.Total || 0, amount_paid: inv.AmountPaid || 0, amount_due: inv.AmountDue || 0,
      currency: inv.CurrencyCode || 'EUR'
    }));

    const contacts = (contactsResp.Contacts || []).map(c => ({
      xero_id: c.ContactID, name: c.Name, email: c.EmailAddress || '',
      is_supplier: c.IsSupplier || false, is_customer: c.IsCustomer || false
    }));

    const result = { synced_at: new Date().toISOString(), org_name: tokens.org_name, bills, invoices, contacts };
    await sbSet('xero_sync_data', result);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, bills: bills.length, invoices: invoices.length, contacts: contacts.length, synced_at: result.synced_at }) };
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
