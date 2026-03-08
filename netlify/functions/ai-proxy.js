
// --- THIC finance detail patch ---
function buildInvoiceTable(arr){
  if(!arr || !arr.length) return "No open supplier invoice lines are available in the current dataset.";
  return arr.map(i=>{
    const s=i.supplier||i.contact||"";
    const inv=i.invoice||i.number||"";
    const amt=i.amount||i.total||0;
    const due=i.due||i.due_date||"";
    return `${s} | ${inv} | €${amt} | ${due}`;
  }).join("\n");
}

function parseJsonBlock(systemText) {
  const m = systemText.match(/LIVE APP DATA \(budget\/forecast overrides from uploaded CSVs\):\s*([\s\S]*?)\n\nINSTRUCTIONS:/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch (e) { return null; }
}

function fmtEUR(n) {
  const val = Number(n || 0);
  return '€ ' + val.toLocaleString('en-GB', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function extractSectionLines(systemText, heading) {
  const re = new RegExp(heading + ':([\\s\\S]*?)(?:\\n\\n[A-Z][A-Z ():-]{3,}|$)');
  const m = systemText.match(re);
  if (!m) return [];
  return m[1].split('\n').map(s => s.trim()).filter(Boolean);
}

function extractTopSuppliers(systemText) {
  return extractSectionLines(systemText, 'TOP SUPPLIERS by total spend').filter(l => /^\d+\./.test(l)).map(line => {
    const clean = line.replace(/^\d+\.\s*/, '');
    const amountMatch = clean.match(/-\s*EUR\s*([\d,]+(?:\.\d+)?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g,'')) : 0;
    const name = clean.split(' - EUR ')[0].trim();
    return { name, amount, raw: line };
  });
}

function extractCostCategories(systemText) {
  return extractSectionLines(systemText, 'KEY COST CATEGORIES \(from bill descriptions\)').filter(l => /^-\s*/.test(l)).map(line => {
    const clean = line.replace(/^-\s*/, '');
    const amountMatch = clean.match(/EUR\s*([\d,]+(?:\.\d+)?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g,'')) : 0;
    const name = clean.split(': EUR')[0].trim();
    return { name, amount, raw: line };
  });
}

function parseDateFromText(text) {
  const m = String(text || '').match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const monMap = { jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3, may:4, jun:5, june:5, jul:6, july:6, aug:7, august:7, sep:8, sept:8, september:8, oct:9, october:9, nov:10, november:10, dec:11, december:11 };
  const mon = monMap[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (mon === undefined) return null;
  return new Date(Date.UTC(year, mon, day));
}

function agingTextFromRaw(raw) {
  const today = new Date(Date.UTC(2026, 2, 8));
  const overdueMatch = String(raw).match(/overdue\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i);
  if (overdueMatch) {
    const dt = parseDateFromText(overdueMatch[1]);
    if (dt) {
      const days = Math.max(0, Math.round((today - dt) / 86400000));
      return `${days} day${days === 1 ? '' : 's'} overdue`;
    }
    return 'overdue';
  }
  const dueMatch = String(raw).match(/due\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i);
  if (dueMatch) {
    const dt = parseDateFromText(dueMatch[1]);
    if (dt) {
      const days = Math.round((today - dt) / 86400000);
      if (days > 0) return `${days} day${days === 1 ? '' : 's'} overdue`;
      return 'current';
    }
    return 'current';
  }
  if (/older item/i.test(raw)) return 'older';
  return 'current';
}

function extractOutstandingBills(systemText) {
  return extractSectionLines(systemText, 'OUTSTANDING BILLS \(what THIC still needs to pay\)')
    .filter(l => /^-\s*/.test(l) && !/TOTAL OUTSTANDING/i.test(l))
    .map(line => {
      const raw = line.replace(/^-\s*/, '').trim();
      const m = raw.match(/^(.+?):\s*EUR\s*([\d,]+(?:\.\d+)?)(?:\s*\((.*)\))?$/i);
      return {
        supplier: m ? m[1].trim() : raw,
        amount: m ? parseFloat(m[2].replace(/,/g,'')) : 0,
        detail: m && m[3] ? m[3].trim() : '',
        raw,
        aging: agingTextFromRaw(raw),
        dueText: (raw.match(/(?:due|overdue)\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/i) || [''])[0]
      };
    });
}

function extractSalesInvoices(systemText) {
  return extractSectionLines(systemText, 'SALES INVOICES \(revenue owed to THIC\)')
    .filter(l => /^-\s*/.test(l) && !/TOTAL ACCOUNTS RECEIVABLE/i.test(l))
    .map(line => {
      const raw = line.replace(/^-\s*/, '').trim();
      const parts = raw.split('|').map(s => s.trim());
      const invoice = (parts[0] || '').replace(/:$/, '').trim();
      const customer = parts[1] || '';
      const amountMatch = raw.match(/EUR\s*([\d,]+(?:\.\d+)?)/i);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g,'')) : 0;
      const status = parts[parts.length - 1] || '';
      const dueText = (raw.match(/due\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/i) || [''])[0];
      return { invoice, customer, amount, status, raw, aging: agingTextFromRaw(raw), dueText };
    });
}

function tableHtml(headers, rows) {
  const th = headers.map(h => `<th style="padding:8px 10px;text-align:left;font-weight:600;color:#fff !important">${esc(h)}</th>`).join('');
  const tr = rows.map(r => `<tr style="border-bottom:1px solid #e5e7eb">${r.map(c => `<td style="padding:7px 10px">${c}</td>`).join('')}</tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:.82rem;margin-top:12px"><thead><tr style="background:#0a4fa6">${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function financeLocalAnswer(systemText, question) {
  const ctx = parseJsonBlock(systemText) || {};
  const q = String(question || '').toLowerCase();
  const costs = ctx.costs || {};
  const revenue = ctx.revenue || {};
  const monthly = Array.isArray(ctx.monthly) ? ctx.monthly : [];
  const recurring = ctx.recurring || {};
  const totalOutstanding = Number(costs.outstanding || 0);
  const totalCosts = Number(costs.total || 0);
  const totalRevenue = Number(revenue.total || 0);
  const netResult = Number(ctx.netResult || (totalRevenue - totalCosts));
  const monthsWithCosts = monthly.filter(m => Number(m.costs || 0) > 0);
  const avgBurn = monthsWithCosts.length ? monthsWithCosts.reduce((s,m)=>s+Number(m.costs||0),0)/monthsWithCosts.length : 0;
  const monthlyRecurring = Number(recurring.monthlyTotal || 0);
  const monthsRemaining = Number(recurring.monthsRemaining || 0);
  const forecastToDec = Number(recurring.forecastToDecember || 0);
  const projectedAnnual = totalCosts + forecastToDec;
  const outstandingBills = extractOutstandingBills(systemText);
  const salesInvoices = extractSalesInvoices(systemText);
  const amountFilter = (() => {
    const m = q.match(/above\s*[€eur\s]*([\d.,]+)/i) || q.match(/over\s*[€eur\s]*([\d.,]+)/i);
    return m ? parseFloat(m[1].replace(/,/g,'')) : null;
  })();

  if (q.includes('show all outstanding invoices') || q.includes('list all outstanding invoices')) {
    let bills = outstandingBills;
    if (!bills.length && /OUTSTANDING BILLS \(what THIC still needs to pay\):/i.test(systemText)) {
      const rawBlock = systemText.split(/OUTSTANDING BILLS \(what THIC still needs to pay\):/i)[1] || '';
      const slice = rawBlock.split(/\n\n(?:AGED PAYABLES|SALES INVOICES|PRODUCTS SOLD|LIVE APP DATA)/i)[0] || rawBlock;
      bills = slice.split('\n').map(s=>s.trim()).filter(s=>s.startsWith('- ')).map(line=>{
        const raw=line.replace(/^-\s*/, '').trim();
        const m = raw.match(/^(.+?):\s*EUR\s*([\d,]+(?:\.\d+)?)(?:\s*\((.*)\))?$/i);
        return {supplier:m?m[1].trim():raw, amount:m?parseFloat(m[2].replace(/,/g,'')):0, detail:m&&m[3]?m[3].trim():'', raw, aging: agingTextFromRaw(raw)};
      });
    }
    if (!bills.length) return `<b>Outstanding supplier invoices</b><br><b>Build:</b> FIN-AI-2026-03-08-D<br>No open supplier invoice lines are available in the current dataset.`;
    const rows = bills.map(i => [esc(i.supplier), esc(i.detail || 'Open item'), fmtEUR(i.amount), esc(i.aging)]);
    return `<b>Outstanding supplier invoices</b><br><b>Build:</b> FIN-AI-2026-03-08-D` + tableHtml(['Supplier', 'Description', 'Amount', 'Aging'], rows) + `<br><b>Total outstanding:</b> ${fmtEUR(totalOutstanding || bills.reduce((s,i)=>s+Number(i.amount||0),0))}`;
  }

  if (q.includes('suppliers are unpaid') || q.includes('unpaid suppliers') || q.includes('which suppliers are unpaid')) {
    if (!outstandingBills.length) return `<b>Unpaid suppliers:</b><br>No unpaid supplier lines are available in the current dataset.`;
    const rows = outstandingBills.sort((a,b)=>b.amount-a.amount).map(i => [esc(i.supplier), fmtEUR(i.amount), esc(i.aging)]);
    return `<b>Unpaid suppliers</b>` + tableHtml(['Supplier', 'Outstanding', 'Aging'], rows) + `<br><b>Total outstanding:</b> ${fmtEUR(totalOutstanding)}`;
  }

  if (q.includes('overdue invoices') || q.includes('which invoices are overdue') || q.includes('show overdue invoices')) {
    const overdue = outstandingBills.filter(i => /overdue|older/i.test(i.aging));
    if (!overdue.length) return `<b>Overdue supplier invoices</b><br>No overdue supplier invoices are shown in the current dataset.`;
    const rows = overdue.sort((a,b)=>b.amount-a.amount).map(i => [esc(i.supplier), esc(i.detail || 'Open item'), fmtEUR(i.amount), esc(i.aging)]);
    const total = overdue.reduce((s,i)=>s+i.amount,0);
    return `<b>Overdue supplier invoices</b>` + tableHtml(['Supplier', 'Description', 'Amount', 'Aging'], rows) + `<br><b>Total overdue:</b> ${fmtEUR(total)}`;
  }

  if ((q.includes('invoices above') || q.includes('invoice above') || q.includes('over €') || q.includes('above eur')) && amountFilter !== null) {
    const filtered = outstandingBills.filter(i => i.amount > amountFilter);
    if (!filtered.length) return `<b>Outstanding invoices above ${fmtEUR(amountFilter)}</b><br>No supplier invoices above that threshold are shown in the current dataset.`;
    const rows = filtered.sort((a,b)=>b.amount-a.amount).map(i => [esc(i.supplier), esc(i.detail || 'Open item'), fmtEUR(i.amount), esc(i.aging)]);
    const total = filtered.reduce((s,i)=>s+i.amount,0);
    return `<b>Outstanding invoices above ${fmtEUR(amountFilter)}</b>` + tableHtml(['Supplier', 'Description', 'Amount', 'Aging'], rows) + `<br><b>Total above threshold:</b> ${fmtEUR(total)}`;
  }

  if (q.includes('due this month')) {
    const dueThisMonth = outstandingBills.filter(i => /mar 2026/i.test(i.raw));
    if (!dueThisMonth.length) return `<b>Invoices due this month</b><br>No March 2026 due supplier invoice lines are shown in the current dataset.`;
    const rows = dueThisMonth.sort((a,b)=>b.amount-a.amount).map(i => [esc(i.supplier), esc(i.detail || 'Open item'), fmtEUR(i.amount), esc(i.aging)]);
    const total = dueThisMonth.reduce((s,i)=>s+i.amount,0);
    return `<b>Supplier invoices due this month</b>` + tableHtml(['Supplier', 'Description', 'Amount', 'Aging'], rows) + `<br><b>Total due this month:</b> ${fmtEUR(total)}`;
  }

  if (q.includes('customers still owe') || q.includes('outstanding customer') || q.includes('receivables') || q.includes('customer invoices')) {
    const unpaid = salesInvoices.filter(i => !/paid/i.test(i.status));
    if (!unpaid.length) return `<b>Outstanding customer invoices</b><br>No open customer invoices are shown in the current dataset.`;
    const rows = unpaid.map(i => [esc(i.customer), esc(i.invoice), fmtEUR(i.amount), esc(i.aging)]);
    const total = unpaid.reduce((s,i)=>s+i.amount,0);
    return `<b>Outstanding customer invoices</b>` + tableHtml(['Customer', 'Invoice', 'Amount', 'Aging'], rows) + `<br><b>Total receivables outstanding:</b> ${fmtEUR(total)}`;
  }

  if (q.includes('how much do i owe') || q === 'outstanding' || q.includes('payables')) {
    let html = `<b>Current outstanding payables:</b> ${fmtEUR(totalOutstanding)}<br>`;
    html += `This is what THIC currently still needs to pay based on the loaded finance data.`;
    const lines = outstandingBills.slice(0,8);
    if (lines.length) {
      html += '<br><br><b>Main outstanding supplier lines:</b><br>' + lines.map(l => '• ' + esc(l.raw)).join('<br>');
    }
    return html;
  }

  if (q.includes('burn rate') || q.includes('runway')) {
    let html = `<b>Average monthly burn:</b> ${fmtEUR(avgBurn)} per month<br>`;
    if (monthlyRecurring > 0) html += `<b>Recurring monthly cost base:</b> ${fmtEUR(monthlyRecurring)}<br>`;
    html += `<b>Total costs YTD:</b> ${fmtEUR(totalCosts)}<br>`;
    if (q.includes('runway')) {
      html += `Cash runway cannot be calculated yet because available cash or bank balance is not present in the current dataset.`;
    } else {
      html += `This burn rate is based on months with actual recorded costs in the finance dashboard.`;
    }
    return html;
  }

  if (q.includes('forecast') || q.includes('end of 2026') || q.includes('projected')) {
    let html = `<b>Projected 2026 costs:</b> ${fmtEUR(projectedAnnual)}<br>`;
    html += `<b>Current costs YTD:</b> ${fmtEUR(totalCosts)}<br>`;
    html += `<b>Forecast recurring costs to December:</b> ${fmtEUR(forecastToDec)} over ${monthsRemaining} remaining month${monthsRemaining===1?'':'s'}.`;
    return html;
  }

  if (q.includes('p&l') || q.includes('profit') || q.includes('loss') || q.includes('summary')) {
    return `<b>P&amp;L summary (${esc(ctx.period || 'current period')}):</b><br>` +
      `Revenue: ${fmtEUR(totalRevenue)}<br>` +
      `Costs: ${fmtEUR(totalCosts)}<br>` +
      `Net result: ${fmtEUR(netResult)}`;
  }

  if (q.includes('biggest cost categor')) {
    const cats = extractCostCategories(systemText).sort((a,b)=>b.amount-a.amount).slice(0,6);
    if (!cats.length) return null;
    return `<b>Biggest cost categories:</b><br>` + cats.map(c => `• ${esc(c.name)} — ${fmtEUR(c.amount)}`).join('<br>');
  }

  if (q.includes('supplier')) {
    const sups = extractTopSuppliers(systemText).slice(0,10);
    if (!sups.length) return null;
    return `<b>Top suppliers by amount:</b><br>` + sups.map(s => `• ${esc(s.name)} — ${fmtEUR(s.amount)}`).join('<br>');
  }

  if (q.includes('cash')) {
    return `The current finance dataset does not include a live cash or bank balance, so I cannot calculate cash position or runway precisely yet. I can calculate burn rate, total outstanding payables and projected costs.`;
  }

  return null;
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: { message: 'Method Not Allowed' } })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: { message: 'Missing ANTHROPIC_API_KEY in Netlify environment variables' } })
    };
  }

  try {
    const incoming = JSON.parse(event.body || '{}');

    const userQuestion = Array.isArray(incoming.messages) && incoming.messages[0] ? (incoming.messages[0].content || '') : '';
    const systemText = incoming.system || '';
    const looksLikeFinance = /CFO assistant|financial data|LIVE APP DATA|XERO DATA/i.test(systemText);
    if (looksLikeFinance) {
      const local = financeLocalAnswer(systemText, userQuestion);
      if (local) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ content: [{ type: 'text', text: local }] })
        };
      }
    }

    const payload = {
      model: incoming.model || 'claude-sonnet-4-6',
      max_tokens: incoming.max_tokens || 1000,
      messages: Array.isArray(incoming.messages) ? incoming.messages : []
    };

    if (incoming.system) payload.system = incoming.system;
    if (Array.isArray(incoming.tools)) payload.tools = incoming.tools;
    if (incoming.temperature !== undefined) payload.temperature = incoming.temperature;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    return {
      statusCode: res.status,
      headers,
      body: text
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: { message: err.message || 'Proxy failed' } })
    };
  }
};
