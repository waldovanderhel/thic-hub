// netlify/functions/xero-sync.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getTokens() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.xero_tokens&select=value`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const rows = await res.json();
  if (!rows.length) throw new Error('No Xero tokens. Connect Xero first.');
  return JSON.parse(rows[0].value);
}

async function refreshToken(refresh_token) {
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(process.env.XERO_CLIENT_ID + ':' + process.env.XERO_CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }).toString()
  });
  if (!res.ok) throw new Error('Token refresh failed');
  return res.json();
}

async function xeroGet(path, accessToken, tenantId) {
  const res = await fetch('https://api.xero.com/api.xro/2.0/' + path, {
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Xero-tenant-id': tenantId, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('Xero API ' + path + ' failed: ' + res.status);
  return res.json();
}

async function saveDB(id, value) {
  await fetch(SUPABASE_URL + '/rest/v1/app_config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, value: JSON.stringify(value) })
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    let tokens = await getTokens();
    if (Date.now() > tokens.expires_at - 60000) {
      const fresh = await refreshToken(tokens.refresh_token);
      tokens = { ...tokens, access_token: fresh.access_token, refresh_token: fresh.refresh_token || tokens.refresh_token, expires_at: Date.now() + fresh.expires_in * 1000 };
      await saveDB('xero_tokens', tokens);
    }

    const { access_token, tenant_id } = tokens;
    const since = encodeURIComponent('2026-01-01T00:00:00');

    const [billsData, invoicesData, contactsData, accountsData] = await Promise.all([
      xeroGet('Invoices?where=Type%3D%3D%22ACCPAY%22&ModifiedAfter=' + since + '&page=1', access_token, tenant_id),
      xeroGet('Invoices?where=Type%3D%3D%22ACCREC%22&ModifiedAfter=' + since + '&page=1', access_token, tenant_id),
      xeroGet('Contacts?where=IsSupplier%3D%3Dtrue', access_token, tenant_id),
      xeroGet('Accounts?where=Status%3D%3D%22ACTIVE%22', access_token, tenant_id)
    ]);

    const mapInv = (inv, type) => ({
      id: inv.InvoiceID, type,
      invNum: inv.InvoiceNumber,
      contact: inv.Contact ? inv.Contact.Name : 'Unknown',
      contactId: inv.Contact ? inv.Contact.ContactID : null,
      date: inv.Date ? inv.Date.split('T')[0] : null,
      dueDate: inv.DueDate ? inv.DueDate.split('T')[0] : null,
      status: inv.Status,
      amount: inv.Total || 0,
      amtDue: inv.AmountDue || 0,
      amtPaid: inv.AmountPaid || 0,
      currency: inv.CurrencyCode || 'EUR',
      lineItems: (inv.LineItems || []).map(li => ({ desc: li.Description, qty: li.Quantity, unitPrice: li.UnitAmount, amount: li.LineAmount, accountCode: li.AccountCode }))
    });

    const bills = (billsData.Invoices || []).map(i => mapInv(i, 'BILL'));
    const salesInvoices = (invoicesData.Invoices || []).map(i => mapInv(i, 'INVOICE'));
    const contacts = (contactsData.Contacts || []).map(c => ({ id: c.ContactID, name: c.Name, email: c.EmailAddress, isSupplier: c.IsSupplier, isCustomer: c.IsCustomer }));
    const accounts = (accountsData.Accounts || []).map(a => ({ code: a.Code, name: a.Name, type: a.Type, class: a.Class }));

    const monthlyActuals = {};
    bills.forEach(b => {
      if (!b.date || !b.date.startsWith('2026')) return;
      const mk = b.date.substring(0, 7);
      if (!monthlyActuals[mk]) monthlyActuals[mk] = { bills: [], invoices: [] };
      monthlyActuals[mk].bills.push(b);
    });
    salesInvoices.forEach(inv => {
      if (!inv.date || !inv.date.startsWith('2026')) return;
      const mk = inv.date.substring(0, 7);
      if (!monthlyActuals[mk]) monthlyActuals[mk] = { bills: [], invoices: [] };
      monthlyActuals[mk].invoices.push(inv);
    });

    const syncedAt = new Date().toISOString();
    await Promise.all([
      saveDB('xero_bills', { items: bills, syncedAt }),
      saveDB('xero_sales_invoices', { items: salesInvoices, syncedAt }),
      saveDB('xero_contacts', { items: contacts, syncedAt }),
      saveDB('xero_accounts', { items: accounts, syncedAt }),
      saveDB('xero_monthly_actuals', { data: monthlyActuals, syncedAt }),
      saveDB('xero_last_sync', { syncedAt, billCount: bills.length, invoiceCount: salesInvoices.length, contactCount: contacts.length })
    ]);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, syncedAt, counts: { bills: bills.length, invoices: salesInvoices.length, contacts: contacts.length } }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
