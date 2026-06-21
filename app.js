/* =======================================================
   Vider Finance – Main Application Logic
   Business Rules:
   - Loan interest: 20% per 10 days
   - Pawn interest: 5% per 10 days
   Data stored in localStorage (no backend required)
   ======================================================= */

'use strict';

// ============================================================
// Constants & Config
// ============================================================
const LOAN_RATE = 0.20;   // 20% per 10 days
const PAWN_RATE = 0.05;   // 5% per 10 days
const PERIOD_DAYS = 10;

// ============================================================
// Data Store (localStorage)
// ============================================================
const DB = {
  get: (key) => JSON.parse(localStorage.getItem('vider_' + key) || '[]'),
  set: (key, val) => localStorage.setItem('vider_' + key, JSON.stringify(val)),
  getOne: (key) => JSON.parse(localStorage.getItem('vider_' + key) || 'null'),
  setOne: (key, val) => localStorage.setItem('vider_' + key, JSON.stringify(val)),
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Helpers
function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(d1, d2) {
  const ms = new Date(d2) - new Date(d1);
  return Math.floor(ms / 86400000);
}

function formatMoney(n) {
  return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d) {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${parseInt(day)}/${parseInt(m)}/${parseInt(y) + 543}`;
}

/** Calculate accrued interest for a contract (total periods elapsed) */
function calcAccruedInterest(startDate, rate, principal) {
  const days = daysBetween(startDate, today());
  if (days <= 0) return 0;
  const periods = Math.floor(days / PERIOD_DAYS);
  return periods * (principal * rate);
}

/** Calculate periods elapsed since contract start */
function calcPeriods(startDate) {
  const days = daysBetween(startDate, today());
  return Math.max(0, Math.floor(days / PERIOD_DAYS));
}

/**
 * Calculate UNPAID interest = (elapsed - paid) * principal * rate
 * paidPeriods defaults to 0 for legacy records
 */
function calcUnpaidInterest(item) {
  const elapsed = calcPeriods(item.date);
  const paid = item.paidPeriods || 0;
  const unpaid = Math.max(0, elapsed - paid);
  const rate = item.rate || (item._loanDefault ? LOAN_RATE : PAWN_RATE);
  return unpaid * item.amount * rate;
}

/**
 * Derive live status from paidPeriods vs elapsed periods.
 * Only call for active/overdue contracts — closed statuses pass through.
 */
function getContractStatus(item) {
  // Terminal states pass through
  if (['paid', 'redeemed', 'forfeited'].includes(item.status)) return item.status;
  const elapsed = calcPeriods(item.date);
  const paid = item.paidPeriods || 0;
  if (elapsed === 0) return 'active';          // hasn't been 10 days yet
  return elapsed > paid ? 'overdue' : 'active'; // unpaid periods = overdue
}

/** Next due date based on paid periods */
function nextDueDate(item) {
  const paid = item.paidPeriods || 0;
  // Next due = start + (paid + 1) * 10 days
  return addDays(item.date, (paid + 1) * PERIOD_DAYS);
}

// ============================================================
// Toast Notification
// ============================================================
function showToast(msg, type = 'success') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = `${icons[type] || ''} ${msg}`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ============================================================
// Navigation
// ============================================================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl = document.getElementById('nav-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: 'แดชบอร์ด',
    customers: 'จัดการลูกค้า',
    loans: 'จัดการเงินกู้ 10 วัน',
    daily: 'จัดการเงินกู้รายวัน',
    pawns: 'จัดการจำนำ',
    transactions: 'รายการทั้งหมด',
    reports: 'รายงาน',
  };
  document.getElementById('topbarTitle').textContent = titles[page] || page;

  // Refresh the relevant page
  if (page === 'dashboard') renderDashboard();
  else if (page === 'customers') renderCustomers();
  else if (page === 'loans') renderLoans();
  else if (page === 'daily') renderDaily();
  else if (page === 'pawns') renderPawns();
  else if (page === 'transactions') renderTransactions();
  else if (page === 'reports') initReportPage();

  updateBadges();
}

// ============================================================
// Sidebar
// ============================================================
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');

document.getElementById('sidebarToggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  mainContent.classList.toggle('sidebar-collapsed');
});

document.getElementById('menuBtn').addEventListener('click', () => {
  sidebar.classList.toggle('mobile-open');
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
    if (window.innerWidth < 1024) sidebar.classList.remove('mobile-open');
  });
});

// ============================================================
// Dashboard
// ============================================================
function renderDashboard() {
  const loans = DB.get('loans').filter(l => !['paid'].includes(l.status));
  const pawns = DB.get('pawns').filter(p => !['redeemed','forfeited'].includes(p.status));
  const dailyLoans = DB.get('daily_loans').filter(d => d.status !== 'paid');
  const txs = DB.get('transactions');

  // Totals
  const totalLoan = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalPawn = pawns.reduce((s, p) => s + (p.amount || 0), 0);
  const totalDaily = dailyLoans.reduce((s, d) => s + (d.amount || 0), 0);

  // Unpaid interest (what's outstanding right now)
  const loanInterest = loans.reduce((s, l) => s + calcUnpaidInterest({ ...l, _loanDefault: true }), 0);
  const pawnInterest = pawns.reduce((s, p) => s + calcUnpaidInterest(p), 0);
  
  // Unpaid interest for daily loans = total interest - paid interest
  const dailyInterest = dailyLoans.reduce((s, d) => {
    const totalInt = d.amount * d.rate;
    const paidInt = (d.paidAmount || 0) * (totalInt / d.totalAmount);
    return s + (totalInt - paidInt);
  }, 0);
  const totalInterest = loanInterest + pawnInterest + dailyInterest;

  // Actual collected interest from transactions
  const collectedInterest = txs.filter(t => t.type === 'interest').reduce((s, t) => s + t.amount, 0);
  const collectedDailyInterest = txs.filter(t => t.type === 'daily_payment').reduce((s, t) => s + (t.interestAmount || 0), 0);
  const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const profit = collectedInterest + collectedDailyInterest - expenses;

  document.getElementById('kpi-profit').textContent = formatMoney(profit);
  document.getElementById('kpi-income').textContent = formatMoney(totalInterest);
  document.getElementById('kpi-income-sub').textContent = 'ดอกค้างรับทั้งหมด';
  document.getElementById('kpi-loans').textContent = formatMoney(totalLoan + totalDaily);
  document.getElementById('kpi-loans-count').textContent = `${loans.length + dailyLoans.length} สัญญา`;
  document.getElementById('kpi-pawns').textContent = formatMoney(totalPawn);
  document.getElementById('kpi-pawns-count').textContent = `${pawns.length} รายการ`;

  document.getElementById('dashDate').textContent = formatDate(today());

  // Due items: contracts where next-due is within 3 days OR already overdue
  const dueList = document.getElementById('dueList');
  const dueCount = document.getElementById('due-count');
  const customers = DB.get('customers');
  const dueItems = [];

  [
    ...loans.map(l => ({ ...l, _type: 'loan' })),
    ...pawns.map(p => ({ ...p, _type: 'pawn' }))
  ].forEach(item => {
    const due = nextDueDate(item);
    const daysLeft = daysBetween(today(), due);
    const liveStatus = getContractStatus(item);
    if (daysLeft <= 3 || liveStatus === 'overdue') {
      dueItems.push({ ...item, due, daysLeft, liveStatus });
    }
  });

  dailyLoans.forEach(item => {
    const elapsedDays = daysBetween(item.date, today());
    // calculate expected paid up to yesterday (to not penalize today prematurely) or today
    // Let's use elapsedDays. If it's day 1 (tomorrow), elapsedDays = 1.
    const expectedPaid = Math.min(item.totalAmount, elapsedDays * item.dailyInstallment);
    const actualPaid = item.paidAmount || 0;
    
    if (actualPaid < expectedPaid || elapsedDays >= 0 && actualPaid < item.totalAmount) {
      const isOverdue = actualPaid < expectedPaid;
      const daysLeft = Math.max(0, item.durationDays - elapsedDays);
      const dueInterest = expectedPaid - actualPaid; // Amount needed to catch up
      
      // If overdue or due today
      if (dueInterest > 0 || (elapsedDays >= 0 && actualPaid < item.totalAmount)) {
         dueItems.push({
           ...item,
           _type: 'daily',
           due: addDays(item.date, elapsedDays), 
           daysLeft: isOverdue ? -1 : 0,
           liveStatus: isOverdue ? 'overdue' : 'active',
           displayAmount: dueInterest > 0 ? dueInterest : item.dailyInstallment
         });
      }
    }
  });

  dueCount.textContent = `${dueItems.length} รายการ`;
  if (dueItems.length === 0) {
    dueList.innerHTML = '<div class="empty-state">ไม่มีรายการที่ครบกำหนดใน 3 วัน</div>';
  } else {
    dueList.innerHTML = dueItems.map(item => {
      const cust = customers.find(c => c.id === item.customerId);
      const name = cust ? cust.name : 'ไม่ระบุ';
      const rate = item.rate || (item._type === 'loan' ? LOAN_RATE : PAWN_RATE);
      let dueAmount = 0;
      let typeLabel = '';
      if (item._type === 'daily') {
        typeLabel = 'กู้รายวัน';
        dueAmount = item.displayAmount;
      } else {
        typeLabel = item._type === 'loan' ? 'เงินกู้' : 'จำนำ';
        dueAmount = calcUnpaidInterest({ ...item, _loanDefault: item._type === 'loan' }) || item.amount * rate;
      }
      const overdue = item.liveStatus === 'overdue';
      return `
        <div class="due-item ${overdue ? 'overdue' : ''}">
          <div>
            <div class="name">${name} – ${typeLabel}</div>
            <div class="info">
              ${item._type === 'pawn' ? item.item + ' | ' : ''}
              ${item._type === 'daily' ? 'รายวัน' : `ครบ: ${formatDate(item.due)}`}
              ${overdue
                ? `<span style="color:var(--accent-rose)">(ค้างชำระ)</span>`
                : (item._type === 'daily' ? '' : `(อีก ${item.daysLeft} วัน)`)
              }
            </div>
          </div>
          <div class="amount">${formatMoney(dueAmount)}</div>
        </div>`;
    }).join('');
  }

  // Recent transactions
  const recentList = document.getElementById('recentList');
  const recent = [...txs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty-state">ยังไม่มีรายการ</div>';
  } else {
    const typeLabels = { interest: 'รับดอก', daily_payment: 'รับรายวัน', loan_payment: 'คืนเงินกู้', pawn_redeem: 'ไถ่จำนำ', expense: 'รายจ่าย' };
    const typeBadges = { interest: 'badge-interest', daily_payment: 'badge-loan', loan_payment: 'badge-loan', pawn_redeem: 'badge-pawn', expense: 'badge-expense' };
    recentList.innerHTML = recent.map(tx => {
      const cust = customers.find(c => c.id === tx.customerId);
      return `
        <div class="recent-item">
          <div>
            <span class="type-badge ${typeBadges[tx.type] || ''}">${typeLabels[tx.type] || tx.type}</span>
            ${cust ? ' ' + cust.name : ''}
          </div>
          <span style="color:${tx.type === 'expense' ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight:600">
            ${tx.type === 'expense' ? '-' : '+'}${formatMoney(tx.amount)}
          </span>
        </div>`;
    }).join('');
  }

  // Portfolio bars
  const total = totalLoan + totalPawn + totalDaily || 1;
  const loanPct = Math.round((totalLoan / total) * 100);
  const pawnPct = Math.round((totalPawn / total) * 100);
  const dailyPct = Math.round((totalDaily / total) * 100);
  document.getElementById('loanBar').style.width = loanPct + '%';
  document.getElementById('pawnBar').style.width = pawnPct + '%';
  document.getElementById('dailyBar').style.width = dailyPct + '%';
  document.getElementById('loanBarAmount').textContent = formatMoney(totalLoan);
  document.getElementById('pawnBarAmount').textContent = formatMoney(totalPawn);
  document.getElementById('dailyBarAmount').textContent = formatMoney(totalDaily);
}

// ============================================================
// Badges
// ============================================================
function updateBadges() {
  const loans = DB.get('loans').filter(l => !['paid'].includes(l.status));
  const dailyLoans = DB.get('daily_loans').filter(d => d.status !== 'paid');
  const pawns = DB.get('pawns').filter(p => !['redeemed','forfeited'].includes(p.status));
  const customers = DB.get('customers');

  document.getElementById('badge-customers').textContent = customers.length;
  document.getElementById('badge-loans').textContent = loans.length;
  document.getElementById('badge-daily').textContent = dailyLoans.length;
  document.getElementById('badge-pawns').textContent = pawns.length;
}

// ============================================================
// Customers
// ============================================================
function renderCustomers(filter = '') {
  let customers = DB.get('customers');
  const loans = DB.get('loans');
  const pawns = DB.get('pawns');
  const dailyLoans = DB.get('daily_loans');

  if (filter) {
    const q = filter.toLowerCase();
    customers = customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.idCard || '').includes(q)
    );
  }

  const tbody = document.getElementById('customerTableBody');
  if (customers.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">ยังไม่มีลูกค้า</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map((c, i) => {
    const cLoans = loans.filter(l => l.customerId === c.id && (l.status === 'active' || l.status === 'overdue'));
    const cPawns = pawns.filter(p => p.customerId === c.id && (p.status === 'active' || p.status === 'overdue'));
    const cDaily = dailyLoans.filter(d => d.customerId === c.id && d.status !== 'paid');
    
    const loanTotal = cLoans.reduce((s, l) => s + l.amount, 0);
    const pawnTotal = cPawns.reduce((s, p) => s + p.amount, 0);
    const dailyTotal = cDaily.reduce((s, d) => s + d.amount, 0);
    
    const hasActive = cLoans.length > 0 || cPawns.length > 0 || cDaily.length > 0;
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${c.name}</strong></td>
        <td>${c.phone || '-'}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.address || ''}">${c.address || '-'}</td>
        <td>${c.idCard || '-'}</td>
        <td style="color:var(--accent-rose);font-weight:600">${loanTotal > 0 ? formatMoney(loanTotal) : '-'}</td>
        <td style="color:var(--accent-blue);font-weight:600">${pawnTotal > 0 ? formatMoney(pawnTotal) : '-'}</td>
        <td style="color:var(--accent-purple);font-weight:600">${dailyTotal > 0 ? formatMoney(dailyTotal) : '-'}</td>
        <td><span class="type-badge ${hasActive ? 'badge-active' : 'badge-paid'}">${hasActive ? 'มีสัญญา' : 'ไม่มีสัญญา'}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-icon edit" title="แก้ไข" onclick="editCustomer('${c.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deleteCustomer('${c.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('customerSearch').addEventListener('input', (e) => {
  renderCustomers(e.target.value);
});

document.getElementById('addCustomerBtn').addEventListener('click', () => openCustomerModal());

function openCustomerModal(data = null) {
  const modal = document.getElementById('customerModal');
  document.getElementById('customerModalTitle').textContent = data ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า';
  document.getElementById('customerId').value = data?.id || '';
  document.getElementById('customerName').value = data?.name || '';
  document.getElementById('customerPhone').value = data?.phone || '';
  document.getElementById('customerIdCard').value = data?.idCard || '';
  document.getElementById('customerLine').value = data?.line || '';
  document.getElementById('customerAddress').value = data?.address || '';
  document.getElementById('customerNote').value = data?.note || '';
  modal.showModal();
}

document.getElementById('closeCustomerModal').addEventListener('click', () => document.getElementById('customerModal').close());
document.getElementById('cancelCustomer').addEventListener('click', () => document.getElementById('customerModal').close());

document.getElementById('customerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('customerId').value || genId();
  const customers = DB.get('customers');
  const existing = customers.findIndex(c => c.id === id);
  const data = {
    id,
    name: document.getElementById('customerName').value.trim(),
    phone: document.getElementById('customerPhone').value.trim(),
    idCard: document.getElementById('customerIdCard').value.trim(),
    line: document.getElementById('customerLine').value.trim(),
    address: document.getElementById('customerAddress').value.trim(),
    note: document.getElementById('customerNote').value.trim(),
    createdAt: existing >= 0 ? customers[existing].createdAt : Date.now(),
  };

  if (!data.name || !data.phone) { showToast('กรุณากรอกชื่อและเบอร์โทร', 'error'); return; }

  if (existing >= 0) customers[existing] = data;
  else customers.push(data);
  DB.set('customers', customers);

  document.getElementById('customerModal').close();
  renderCustomers();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขข้อมูลลูกค้าแล้ว' : 'เพิ่มลูกค้าแล้ว');
});

function editCustomer(id) {
  const c = DB.get('customers').find(c => c.id === id);
  if (c) openCustomerModal(c);
}

function deleteCustomer(id) {
  openConfirm('ต้องการลบข้อมูลลูกค้านี้ใช่ไหม?', () => {
    const customers = DB.get('customers').filter(c => c.id !== id);
    DB.set('customers', customers);
    renderCustomers();
    updateBadges();
    showToast('ลบลูกค้าแล้ว');
  });
}

// ============================================================
// Loans
// ============================================================
function renderLoans(filter = '', statusFilter = '') {
  let loans = DB.get('loans');
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    loans = loans.filter(l => {
      const c = customers.find(c => c.id === l.customerId);
      return (c?.name || '').toLowerCase().includes(q) || l.id.includes(q);
    });
  }

  // Compute live status before filtering
  loans = loans.map(l => ({ ...l, _liveStatus: getContractStatus(l) }));

  if (statusFilter) loans = loans.filter(l => l._liveStatus === statusFilter);

  const tbody = document.getElementById('loanTableBody');
  if (loans.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">ยังไม่มีสัญญากู้</td></tr>';
    return;
  }

  tbody.innerHTML = loans.map((l, i) => {
    const cust = customers.find(c => c.id === l.customerId);
    const rate = l.rate || LOAN_RATE;
    const interest = l.amount * rate;                   // ดอก/รอบ
    const unpaid = calcUnpaidInterest({ ...l, _loanDefault: true });
    const elapsed = calcPeriods(l.date);
    const paid = l.paidPeriods || 0;
    const due = nextDueDate(l);
    const liveStatus = l._liveStatus;
    const statusLabel = { active: 'กำลังดำเนินการ', overdue: 'เกินกำหนด', paid: 'ชำระแล้ว' };
    const statusBadge = { active: 'badge-active', overdue: 'badge-overdue', paid: 'badge-paid' };

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${cust?.name || 'ไม่ระบุ'}</strong></td>
        <td style="color:var(--accent-rose);font-weight:600">${formatMoney(l.amount)}</td>
        <td style="color:var(--accent-gold)">${formatMoney(interest)} <small style="color:var(--text-muted)">(${(rate*100).toFixed(1)}%)</small></td>
        <td>${formatDate(l.date)}</td>
        <td>${formatDate(due)}</td>
        <td style="color:${unpaid > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:600">${formatMoney(unpaid)}</td>
        <td><span style="color:var(--text-secondary)">${paid}/${elapsed} รอบ</span></td>
        <td><span class="type-badge ${statusBadge[liveStatus] || 'badge-active'}">${statusLabel[liveStatus] || liveStatus}</span></td>
        <td>
          <div class="action-btns">
            ${liveStatus !== 'paid' ? `<button class="btn-icon pay" title="รับดอก" onclick="openPayInterest('loan','${l.id}')">💵</button>` : ''}
            ${liveStatus !== 'paid' ? `<button class="btn-icon redeem" title="ชำระครบ" onclick="markLoanPaid('${l.id}')">✅</button>` : ''}
            <button class="btn-icon edit" title="แก้ไข" onclick="editLoan('${l.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deleteLoan('${l.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('loanSearch').addEventListener('input', (e) => {
  renderLoans(e.target.value, document.getElementById('loanStatusFilter').value);
});
document.getElementById('loanStatusFilter').addEventListener('change', (e) => {
  renderLoans(document.getElementById('loanSearch').value, e.target.value);
});
document.getElementById('addLoanBtn').addEventListener('click', () => openLoanModal());

function populateCustomerDropdowns() {
  const customers = DB.get('customers');
  const opts = '<option value="">-- เลือกลูกค้า --</option>' +
    customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');
  const txOpts = '<option value="">-- ไม่ระบุ --</option>' +
    customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');

  document.getElementById('loanCustomer').innerHTML = opts;
  document.getElementById('dailyCustomer').innerHTML = opts;
  document.getElementById('pawnCustomer').innerHTML = opts;
  document.getElementById('txCustomer').innerHTML = txOpts;
}

function openLoanModal(data = null) {
  populateCustomerDropdowns();
  const modal = document.getElementById('loanModal');
  document.getElementById('loanModalTitle').textContent = data ? 'แก้ไขสัญญากู้' : 'เพิ่มสัญญาเงินกู้';
  document.getElementById('loanId').value = data?.id || '';
  document.getElementById('loanCustomer').value = data?.customerId || '';
  document.getElementById('loanAmount').value = data?.amount || '';
  // Convert stored decimal rate → percentage for the input (e.g. 0.20 → 20)
  document.getElementById('loanRate').value = data?.rate != null ? +(data.rate * 100).toFixed(2) : 20;
  document.getElementById('loanDate').value = data?.date || today();
  document.getElementById('loanNote').value = data?.note || '';
  updateLoanPreview();
  modal.showModal();
}

function updateLoanPreview() {
  const amount = parseFloat(document.getElementById('loanAmount').value) || 0;
  const ratePct = parseFloat(document.getElementById('loanRate').value) || 20;
  const date = document.getElementById('loanDate').value || today();
  document.getElementById('loanInterestPreview').textContent = formatMoney(amount * (ratePct / 100));
  document.getElementById('loanDueDate').value = addDays(date, PERIOD_DAYS);
}

document.getElementById('loanAmount').addEventListener('input', updateLoanPreview);
document.getElementById('loanRate').addEventListener('input', updateLoanPreview);
document.getElementById('loanDate').addEventListener('change', updateLoanPreview);
document.getElementById('closeLoanModal').addEventListener('click', () => document.getElementById('loanModal').close());
document.getElementById('cancelLoan').addEventListener('click', () => document.getElementById('loanModal').close());

document.getElementById('loanForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('loanId').value || genId();
  const loans = DB.get('loans');
  const existing = loans.findIndex(l => l.id === id);

  const ratePct = parseFloat(document.getElementById('loanRate').value);
  if (!ratePct || ratePct <= 0) { showToast('กรุณากรอกอัตราดอกเบี้ย', 'error'); return; }

  const amount = parseFloat(document.getElementById('loanAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const data = {
    id,
    customerId: document.getElementById('loanCustomer').value,
    amount,
    rate: ratePct / 100,         // store as decimal e.g. 0.20
    date: document.getElementById('loanDate').value,
    note: document.getElementById('loanNote').value,
    status: existing >= 0 ? loans[existing].status : 'active',
    paidPeriods: existing >= 0 ? (loans[existing].paidPeriods || 0) : 0,
    createdAt: existing >= 0 ? loans[existing].createdAt : Date.now(),
  };

  if (!data.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }

  if (existing >= 0) loans[existing] = data;
  else loans.push(data);
  DB.set('loans', loans);

  document.getElementById('loanModal').close();
  renderLoans();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขสัญญาแล้ว' : 'เพิ่มสัญญากู้แล้ว');
});

function editLoan(id) {
  const l = DB.get('loans').find(l => l.id === id);
  if (l) openLoanModal(l);
}

function deleteLoan(id) {
  openConfirm('ต้องการลบสัญญากู้นี้ใช่ไหม?', () => {
    DB.set('loans', DB.get('loans').filter(l => l.id !== id));
    renderLoans();
    updateBadges();
    showToast('ลบสัญญาแล้ว');
  });
}

function markLoanPaid(id) {
  openConfirm('ยืนยันว่าลูกค้าชำระคืนเงินกู้ครบถ้วนแล้ว?', () => {
    const loans = DB.get('loans');
    const idx = loans.findIndex(l => l.id === id);
    if (idx >= 0) {
      const loan = loans[idx];
      loans[idx].status = 'paid';
      DB.set('loans', loans);

      // Log transaction
      const txs = DB.get('transactions');
      txs.push({
        id: genId(),
        date: today(),
        type: 'loan_payment',
        customerId: loan.customerId,
        amount: loan.amount,
        note: `คืนเงินกู้ครบ ${formatMoney(loan.amount)}`,
        createdAt: Date.now(),
      });
      DB.set('transactions', txs);

      renderLoans();
      updateBadges();
      showToast('บันทึกชำระเงินกู้แล้ว');
    }
  });
}

// ============================================================
// Pawns
// ============================================================
function renderPawns(filter = '', statusFilter = '') {
  let pawns = DB.get('pawns');
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    pawns = pawns.filter(p => {
      const c = customers.find(c => c.id === p.customerId);
      return (c?.name || '').toLowerCase().includes(q) ||
        (p.item || '').toLowerCase().includes(q);
    });
  }

  // Compute live status before filtering
  pawns = pawns.map(p => ({ ...p, _liveStatus: getContractStatus(p) }));

  if (statusFilter) pawns = pawns.filter(p => p._liveStatus === statusFilter);

  const tbody = document.getElementById('pawnTableBody');
  if (pawns.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="11">ยังไม่มีรายการจำนำ</td></tr>';
    return;
  }

  tbody.innerHTML = pawns.map((p, i) => {
    const cust = customers.find(c => c.id === p.customerId);
    const rate = p.rate || PAWN_RATE;
    const interest = p.amount * rate;
    const unpaid = calcUnpaidInterest(p);
    const elapsed = calcPeriods(p.date);
    const paid = p.paidPeriods || 0;
    const due = nextDueDate(p);
    const liveStatus = p._liveStatus;
    const statusLabel = { active: 'กำลังดำเนินการ', overdue: 'เกินกำหนด', redeemed: 'ไถ่ถอนแล้ว', forfeited: 'หลุดจำนำ' };
    const statusBadge = { active: 'badge-active', overdue: 'badge-overdue', redeemed: 'badge-redeemed', forfeited: 'badge-forfeited' };

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${cust?.name || 'ไม่ระบุ'}</strong></td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.item}">${p.item}</td>
        <td style="color:var(--accent-blue);font-weight:600">${formatMoney(p.amount)}</td>
        <td style="color:var(--accent-gold)">${formatMoney(interest)} <small style="color:var(--text-muted)">(${(rate*100).toFixed(1)}%)</small></td>
        <td>${formatDate(p.date)}</td>
        <td>${formatDate(due)}</td>
        <td style="color:${unpaid > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:600">${formatMoney(unpaid)}</td>
        <td><span style="color:var(--text-secondary)">${paid}/${elapsed} รอบ</span></td>
        <td><span class="type-badge ${statusBadge[liveStatus] || 'badge-active'}">${statusLabel[liveStatus] || liveStatus}</span></td>
        <td>
          <div class="action-btns">
            ${liveStatus === 'active' || liveStatus === 'overdue' ? `<button class="btn-icon pay" title="รับดอก" onclick="openPayInterest('pawn','${p.id}')">💵</button>` : ''}
            ${liveStatus === 'active' || liveStatus === 'overdue' ? `<button class="btn-icon redeem" title="ไถ่ถอน" onclick="markPawnRedeemed('${p.id}')">✅</button>` : ''}
            ${liveStatus === 'active' || liveStatus === 'overdue' ? `<button class="btn-icon forfeited" title="หลุดจำนำ" onclick="markPawnForfeited('${p.id}')">🔒</button>` : ''}
            <button class="btn-icon edit" title="แก้ไข" onclick="editPawn('${p.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deletePawn('${p.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('pawnSearch').addEventListener('input', (e) => {
  renderPawns(e.target.value, document.getElementById('pawnStatusFilter').value);
});
document.getElementById('pawnStatusFilter').addEventListener('change', (e) => {
  renderPawns(document.getElementById('pawnSearch').value, e.target.value);
});
document.getElementById('addPawnBtn').addEventListener('click', () => openPawnModal());

function openPawnModal(data = null) {
  populateCustomerDropdowns();
  const modal = document.getElementById('pawnModal');
  document.getElementById('pawnModalTitle').textContent = data ? 'แก้ไขรายการจำนำ' : 'เพิ่มรายการจำนำ';
  document.getElementById('pawnId').value = data?.id || '';
  document.getElementById('pawnCustomer').value = data?.customerId || '';
  document.getElementById('pawnAmount').value = data?.amount || '';
  document.getElementById('pawnItem').value = data?.item || '';
  // Convert stored decimal → percentage
  document.getElementById('pawnRate').value = data?.rate != null ? +(data.rate * 100).toFixed(2) : 5;
  document.getElementById('pawnDate').value = data?.date || today();
  document.getElementById('pawnNote').value = data?.note || '';
  updatePawnPreview();
  modal.showModal();
}

function updatePawnPreview() {
  const amount = parseFloat(document.getElementById('pawnAmount').value) || 0;
  const ratePct = parseFloat(document.getElementById('pawnRate').value) || 5;
  const date = document.getElementById('pawnDate').value || today();
  document.getElementById('pawnInterestPreview').textContent = formatMoney(amount * (ratePct / 100));
  document.getElementById('pawnDueDate').value = addDays(date, PERIOD_DAYS);
}

document.getElementById('pawnAmount').addEventListener('input', updatePawnPreview);
document.getElementById('pawnRate').addEventListener('input', updatePawnPreview);
document.getElementById('pawnDate').addEventListener('change', updatePawnPreview);
document.getElementById('closePawnModal').addEventListener('click', () => document.getElementById('pawnModal').close());
document.getElementById('cancelPawn').addEventListener('click', () => document.getElementById('pawnModal').close());

document.getElementById('pawnForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('pawnId').value || genId();
  const pawns = DB.get('pawns');
  const existing = pawns.findIndex(p => p.id === id);
  const amount = parseFloat(document.getElementById('pawnAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกมูลค่าจำนำ', 'error'); return; }

  const item = document.getElementById('pawnItem').value.trim();
  if (!item) { showToast('กรุณากรอกรายการของ', 'error'); return; }

  const ratePct = parseFloat(document.getElementById('pawnRate').value);
  if (!ratePct || ratePct <= 0) { showToast('กรุณากรอกอัตราดอกเบี้ย', 'error'); return; }

  const data = {
    id,
    customerId: document.getElementById('pawnCustomer').value,
    amount,
    item,
    rate: ratePct / 100,
    date: document.getElementById('pawnDate').value,
    note: document.getElementById('pawnNote').value,
    status: existing >= 0 ? pawns[existing].status : 'active',
    paidPeriods: existing >= 0 ? (pawns[existing].paidPeriods || 0) : 0,
    createdAt: existing >= 0 ? pawns[existing].createdAt : Date.now(),
  };

  if (!data.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }

  if (existing >= 0) pawns[existing] = data;
  else pawns.push(data);
  DB.set('pawns', pawns);

  document.getElementById('pawnModal').close();
  renderPawns();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขรายการจำนำแล้ว' : 'เพิ่มรายการจำนำแล้ว');
});

function editPawn(id) {
  const p = DB.get('pawns').find(p => p.id === id);
  if (p) openPawnModal(p);
}

function deletePawn(id) {
  openConfirm('ต้องการลบรายการจำนำนี้ใช่ไหม?', () => {
    DB.set('pawns', DB.get('pawns').filter(p => p.id !== id));
    renderPawns();
    updateBadges();
    showToast('ลบรายการจำนำแล้ว');
  });
}

function markPawnRedeemed(id) {
  openConfirm('ยืนยันว่าลูกค้าไถ่ถอนของคืนแล้ว?', () => {
    const pawns = DB.get('pawns');
    const idx = pawns.findIndex(p => p.id === id);
    if (idx >= 0) {
      const pawn = pawns[idx];
      pawns[idx].status = 'redeemed';
      DB.set('pawns', pawns);

      const txs = DB.get('transactions');
      txs.push({
        id: genId(),
        date: today(),
        type: 'pawn_redeem',
        customerId: pawn.customerId,
        amount: pawn.amount,
        note: `ไถ่คืน: ${pawn.item} (${formatMoney(pawn.amount)})`,
        createdAt: Date.now(),
      });
      DB.set('transactions', txs);

      renderPawns();
      updateBadges();
      showToast('บันทึกการไถ่ถอนแล้ว');
    }
  });
}

function markPawnForfeited(id) {
  openConfirm('ยืนยันว่าของชิ้นนี้หลุดจำนำ (ไม่มีการไถ่ถอน)?', () => {
    const pawns = DB.get('pawns');
    const idx = pawns.findIndex(p => p.id === id);
    if (idx >= 0) {
      pawns[idx].status = 'forfeited';
      DB.set('pawns', pawns);
      renderPawns();
      updateBadges();
      showToast('บันทึกหลุดจำนำแล้ว');
    }
  });
}

// ============================================================
// Pay Interest Modal
// ============================================================
let _payContext = null;

function openPayInterest(type, id) {
  const customers = DB.get('customers');
  let item;

  if (type === 'loan') {
    item = DB.get('loans').find(l => l.id === id);
  } else {
    item = DB.get('pawns').find(p => p.id === id);
  }

  if (!item) return;

  const rate = item.rate || (type === 'loan' ? LOAN_RATE : PAWN_RATE);
  const cust = customers.find(c => c.id === item.customerId);
  const interestPerPeriod = item.amount * rate;
  const elapsed = calcPeriods(item.date);
  const paid = item.paidPeriods || 0;
  const unpaidPeriods = Math.max(0, elapsed - paid);
  const unpaidAmount = unpaidPeriods * interestPerPeriod;
  const due = nextDueDate(item);

  _payContext = { type, id, item, rate, elapsed, paid, unpaidPeriods, interestPerPeriod };

  document.getElementById('payDetail').innerHTML = `
    <strong>ลูกค้า:</strong> ${cust?.name || 'ไม่ระบุ'}<br>
    <strong>เงินต้น:</strong> ${formatMoney(item.amount)}<br>
    <strong>อัตราดอก:</strong> ${(rate*100).toFixed(1)}% / 10 วัน → ${formatMoney(interestPerPeriod)}/รอบ<br>
    <strong>รอบที่ผ่านมา:</strong> ${elapsed} รอบ | <strong>จ่ายแล้ว:</strong> ${paid} รอบ<br>
    <strong>รอบค้างชำระ:</strong> <span style="color:var(--accent-rose);font-weight:700">${unpaidPeriods} รอบ</span><br>
    <strong>ยอดค้างทั้งหมด:</strong> <span style="color:var(--accent-gold);font-weight:700">${formatMoney(unpaidAmount)}</span><br>
    ${type === 'pawn' ? `<strong>ของ:</strong> ${item.item}<br>` : ''}
    <strong>ครบกำหนดรอบถัดไป:</strong> ${formatDate(due)}
  `;

  // Default = all unpaid, or 1 period if nothing overdue
  document.getElementById('payAmount').value = unpaidAmount > 0 ? unpaidAmount : interestPerPeriod;
  document.getElementById('payNote').value = '';
  document.getElementById('payInterestModal').showModal();
}

document.getElementById('closePayInterestModal').addEventListener('click', () => document.getElementById('payInterestModal').close());
document.getElementById('cancelPayInterest').addEventListener('click', () => document.getElementById('payInterestModal').close());

document.getElementById('confirmPayInterest').addEventListener('click', () => {
  if (!_payContext) return;
  const amount = parseFloat(document.getElementById('payAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนดอก', 'error'); return; }

  const { type, id, item, interestPerPeriod, unpaidPeriods } = _payContext;

  // Figure out how many periods this payment covers (round down)
  const periodsBeingPaid = interestPerPeriod > 0
    ? Math.max(1, Math.round(amount / interestPerPeriod))
    : 1;

  // Advance paidPeriods
  const collection = type === 'loan' ? 'loans' : 'pawns';
  const records = DB.get(collection);
  const idx = records.findIndex(r => r.id === id);
  if (idx >= 0) {
    const currentPaid = records[idx].paidPeriods || 0;
    const elapsed = calcPeriods(records[idx].date);
    // Cap at elapsed so we don't overshoot
    records[idx].paidPeriods = Math.min(elapsed, currentPaid + periodsBeingPaid);
    DB.set(collection, records);
  }

  // Log transaction
  const txs = DB.get('transactions');
  const cust = DB.get('customers').find(c => c.id === item.customerId);
  txs.push({
    id: genId(),
    date: today(),
    type: 'interest',
    customerId: item.customerId,
    amount,
    note: document.getElementById('payNote').value ||
      `รับดอก${type === 'loan' ? 'เงินกู้' : 'จำนำ'} ${periodsBeingPaid} รอบ – ${cust?.name || ''}`,
    subType: type,
    refId: id,
    createdAt: Date.now(),
  });
  DB.set('transactions', txs);

  document.getElementById('payInterestModal').close();
  showToast(`รับดอกเบี้ย ${formatMoney(amount)} (${periodsBeingPaid} รอบ) แล้ว`, 'success');

  if (type === 'loan') renderLoans();
  else renderPawns();
  renderDashboard();
});

// ============================================================
// Transactions
// ============================================================
function renderTransactions(filter = '', typeFilter = '') {
  let txs = DB.get('transactions').sort((a, b) => b.createdAt - a.createdAt);
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    txs = txs.filter(t => {
      const c = customers.find(c => c.id === t.customerId);
      return (c?.name || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q);
    });
  }
  if (typeFilter) txs = txs.filter(t => t.type === typeFilter);

  const tbody = document.getElementById('txTableBody');
  if (txs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">ยังไม่มีรายการ</td></tr>';
    return;
  }

  const typeLabels = { interest: 'รับดอกเบี้ย', loan_payment: 'รับคืนเงินกู้', pawn_redeem: 'ไถ่จำนำ', expense: 'รายจ่าย' };
  const typeBadges = { interest: 'badge-interest', loan_payment: 'badge-loan', pawn_redeem: 'badge-pawn', expense: 'badge-expense' };

  tbody.innerHTML = txs.map((t, i) => {
    const cust = customers.find(c => c.id === t.customerId);
    const isIncome = t.type !== 'expense';
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${formatDate(t.date)}</td>
        <td><span class="type-badge ${typeBadges[t.type] || ''}">${typeLabels[t.type] || t.type}</span></td>
        <td>${cust?.name || '-'}</td>
        <td style="color:var(--text-secondary);font-size:0.8rem">${t.note || '-'}</td>
        <td style="color:${isIncome ? 'var(--accent-emerald)' : 'var(--accent-rose)'};font-weight:600">
          ${isIncome ? '+' : '-'}${formatMoney(t.amount)}
        </td>
        <td>
          <button class="btn-icon delete" title="ลบ" onclick="deleteTransaction('${t.id}')">🗑️</button>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('txSearch').addEventListener('input', (e) => {
  renderTransactions(e.target.value, document.getElementById('txTypeFilter').value);
});
document.getElementById('txTypeFilter').addEventListener('change', (e) => {
  renderTransactions(document.getElementById('txSearch').value, e.target.value);
});
document.getElementById('addTransactionBtn').addEventListener('click', () => openTxModal());

function openTxModal() {
  populateCustomerDropdowns();
  document.getElementById('txDate').value = today();
  document.getElementById('txType').value = '';
  document.getElementById('txAmount').value = '';
  document.getElementById('txNote').value = '';
  document.getElementById('transactionModal').showModal();
}

document.getElementById('closeTxModal').addEventListener('click', () => document.getElementById('transactionModal').close());
document.getElementById('cancelTx').addEventListener('click', () => document.getElementById('transactionModal').close());

document.getElementById('txForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('txAmount').value);
  const type = document.getElementById('txType').value;
  if (!type) { showToast('กรุณาเลือกประเภท', 'error'); return; }
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const txs = DB.get('transactions');
  txs.push({
    id: genId(),
    date: document.getElementById('txDate').value,
    type,
    customerId: document.getElementById('txCustomer').value,
    amount,
    note: document.getElementById('txNote').value,
    createdAt: Date.now(),
  });
  DB.set('transactions', txs);

  document.getElementById('transactionModal').close();
  renderTransactions();
  renderDashboard();
  showToast('บันทึกรายการแล้ว');
});

function deleteTransaction(id) {
  openConfirm('ต้องการลบรายการและดึงข้อมูลกลับใช่ไหม?', () => {
    const txs = DB.get('transactions');
    const tx = txs.find(t => t.id === id);
    if (!tx) return;

    if (tx.refId) {
      if (tx.type === 'interest') {
        const key = tx.subType === 'loan' ? 'loans' : 'pawns';
        const items = DB.get(key);
        const idx = items.findIndex(item => item.id === tx.refId);
        if (idx >= 0 && items[idx].paidPeriods > 0) {
          items[idx].paidPeriods -= 1;
          DB.set(key, items);
        }
      } else if (tx.type === 'loan_payment') {
        const loans = DB.get('loans');
        const idx = loans.findIndex(l => l.id === tx.refId);
        if (idx >= 0) {
          loans[idx].status = 'active';
          DB.set('loans', loans);
        }
      } else if (tx.type === 'pawn_redeem') {
        const pawns = DB.get('pawns');
        const idx = pawns.findIndex(p => p.id === tx.refId);
        if (idx >= 0) {
          pawns[idx].status = 'active';
          DB.set('pawns', pawns);
        }
      } else if (tx.type === 'daily_payment') {
        const daily = DB.get('daily_loans');
        const idx = daily.findIndex(d => d.id === tx.refId);
        if (idx >= 0) {
          daily[idx].paidAmount = Math.max(0, (daily[idx].paidAmount || 0) - tx.amount);
          if (daily[idx].paidAmount < daily[idx].totalAmount) {
             daily[idx].status = 'active';
          }
          DB.set('daily_loans', daily);
        }
      }
    }

    DB.set('transactions', txs.filter(t => t.id !== id));
    renderTransactions();
    renderDashboard();
    updateBadges();
    showToast('ลบและคืนค่าข้อมูลแล้ว');
  });
}

// ============================================================
// Reports
// ============================================================
function initReportPage() {
  const now = new Date();
  document.getElementById('reportMonth').value = now.getMonth();
  document.getElementById('reportYear').value = now.getFullYear() + 543;
}

document.getElementById('generateReport').addEventListener('click', () => {
  const month = parseInt(document.getElementById('reportMonth').value);
  const thYear = parseInt(document.getElementById('reportYear').value);
  const year = thYear - 543;

  const txs = DB.get('transactions').filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const customers = DB.get('customers');
  const income = txs.filter(t => t.type !== 'expense').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const loanInterest = txs.filter(t => t.type === 'interest' && t.subType === 'loan').reduce((s, t) => s + t.amount, 0);
  const pawnInterest = txs.filter(t => t.type === 'interest' && t.subType === 'pawn').reduce((s, t) => s + t.amount, 0);

  document.getElementById('report-income').textContent = formatMoney(income);
  document.getElementById('report-expense').textContent = formatMoney(expense);
  document.getElementById('report-profit').textContent = formatMoney(income - expense);
  document.getElementById('report-loan-interest').textContent = formatMoney(loanInterest);
  document.getElementById('report-pawn-interest').textContent = formatMoney(pawnInterest);

  const typeLabels = { interest: 'รับดอกเบี้ย', loan_payment: 'รับคืนเงินกู้', pawn_redeem: 'ไถ่จำนำ', expense: 'รายจ่าย' };
  const typeBadges = { interest: 'badge-interest', loan_payment: 'badge-loan', pawn_redeem: 'badge-pawn', expense: 'badge-expense' };

  const tbody = document.getElementById('reportTxBody');
  if (txs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">ไม่มีรายการในช่วงนี้</td></tr>';
    return;
  }

  tbody.innerHTML = txs.sort((a, b) => b.createdAt - a.createdAt).map(t => {
    const cust = customers.find(c => c.id === t.customerId);
    const isIncome = t.type !== 'expense';
    return `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td><span class="type-badge ${typeBadges[t.type] || ''}">${typeLabels[t.type] || t.type}</span></td>
        <td>${cust?.name || '-'}</td>
        <td style="color:var(--text-secondary);font-size:0.8rem">${t.note || '-'}</td>
        <td style="color:${isIncome ? 'var(--accent-emerald)' : 'var(--accent-rose)'};font-weight:600">
          ${isIncome ? '+' : '-'}${formatMoney(t.amount)}
        </td>
      </tr>`;
  }).join('');
});

// ============================================================

// ============================================================
// Daily Loans
// ============================================================
function renderDaily(filter = '', statusFilter = '') {
  let dailyLoans = DB.get('daily_loans');
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    dailyLoans = dailyLoans.filter(l => {
      const c = customers.find(c => c.id === l.customerId);
      return (c?.name || '').toLowerCase().includes(q) || l.id.includes(q);
    });
  }

  // Compute live status
  dailyLoans = dailyLoans.map(d => {
    let liveStatus = d.status;
    if (liveStatus !== 'paid') {
      const elapsedDays = daysBetween(d.date, today());
      const expectedPaid = Math.min(d.totalAmount, elapsedDays * d.dailyInstallment);
      const actualPaid = d.paidAmount || 0;
      if (actualPaid < expectedPaid) liveStatus = 'overdue';
      else liveStatus = 'active';
    }
    return { ...d, _liveStatus: liveStatus };
  });

  if (statusFilter) dailyLoans = dailyLoans.filter(l => l._liveStatus === statusFilter);

  const tbody = document.getElementById('dailyTableBody');
  if (dailyLoans.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">ยังไม่มีสัญญากู้รายวัน</td></tr>';
    return;
  }

  tbody.innerHTML = dailyLoans.map((d, i) => {
    const cust = customers.find(c => c.id === d.customerId);
    const paid = d.paidAmount || 0;
    const remaining = d.totalAmount - paid;
    const liveStatus = d._liveStatus;
    const statusLabel = { active: 'กำลังดำเนินการ', overdue: 'ค้างชำระ', paid: 'ชำระครบแล้ว' };
    const statusBadge = { active: 'badge-active', overdue: 'badge-overdue', paid: 'badge-paid' };

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${cust?.name || 'ไม่ระบุ'}</strong></td>
        <td style="color:var(--accent-rose);font-weight:600">${formatMoney(d.amount)}</td>
        <td style="color:var(--accent-gold);font-weight:600">${formatMoney(d.totalAmount)}</td>
        <td>${d.durationDays} วัน</td>
        <td style="color:var(--accent-blue)">${formatMoney(d.dailyInstallment)}</td>
        <td style="color:var(--text-secondary)">${formatMoney(paid)}</td>
        <td style="color:${remaining > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:600">${formatMoney(remaining)}</td>
        <td><span class="type-badge ${statusBadge[liveStatus] || 'badge-active'}">${statusLabel[liveStatus] || liveStatus}</span></td>
        <td>
          <div class="action-btns">
            ${liveStatus !== 'paid' ? `<button class="btn-icon pay" title="รับเงิน" onclick="openPayDaily('${d.id}')">💵</button>` : ''}
            <button class="btn-icon edit" title="แก้ไข" onclick="editDaily('${d.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deleteDaily('${d.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('dailySearch').addEventListener('input', (e) => {
  renderDaily(e.target.value, document.getElementById('dailyStatusFilter').value);
});
document.getElementById('dailyStatusFilter').addEventListener('change', (e) => {
  renderDaily(document.getElementById('dailySearch').value, e.target.value);
});
document.getElementById('addDailyBtn').addEventListener('click', () => openDailyModal());

function openDailyModal(data = null) {
  populateCustomerDropdowns();
  const modal = document.getElementById('dailyModal');
  document.getElementById('dailyModalTitle').textContent = data ? 'แก้ไขเงินกู้รายวัน' : 'เพิ่มเงินกู้รายวัน';
  document.getElementById('dailyId').value = data?.id || '';
  document.getElementById('dailyCustomer').value = data?.customerId || '';
  document.getElementById('dailyAmount').value = data?.amount || '';
  document.getElementById('dailyRate').value = data?.rate != null ? +(data.rate * 100).toFixed(2) : 20;
  document.getElementById('dailyDuration').value = data?.durationDays || 12;
  document.getElementById('dailyDate').value = data?.date || today();
  document.getElementById('dailyNote').value = data?.note || '';
  updateDailyPreview();
  modal.showModal();
}

function updateDailyPreview() {
  const amount = parseFloat(document.getElementById('dailyAmount').value) || 0;
  const ratePct = parseFloat(document.getElementById('dailyRate').value) || 0;
  const duration = parseInt(document.getElementById('dailyDuration').value) || 1;
  const totalAmount = amount + (amount * (ratePct / 100));
  const dailyInstallment = totalAmount / duration;
  document.getElementById('dailyPreview').textContent = `${formatMoney(dailyInstallment)} / ${formatMoney(totalAmount)}`;
}

document.getElementById('dailyAmount').addEventListener('input', updateDailyPreview);
document.getElementById('dailyRate').addEventListener('input', updateDailyPreview);
document.getElementById('dailyDuration').addEventListener('input', updateDailyPreview);
document.getElementById('closeDailyModal').addEventListener('click', () => document.getElementById('dailyModal').close());
document.getElementById('cancelDaily').addEventListener('click', () => document.getElementById('dailyModal').close());

document.getElementById('dailyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('dailyId').value || genId();
  const dailyLoans = DB.get('daily_loans');
  const existing = dailyLoans.findIndex(l => l.id === id);

  const ratePct = parseFloat(document.getElementById('dailyRate').value);
  if (!ratePct || ratePct <= 0) { showToast('กรุณากรอกอัตราดอกเบี้ย', 'error'); return; }

  const amount = parseFloat(document.getElementById('dailyAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงินกู้', 'error'); return; }

  const duration = parseInt(document.getElementById('dailyDuration').value);
  if (!duration || duration <= 0) { showToast('กรุณากรอกระยะเวลา', 'error'); return; }

  const totalAmount = amount + (amount * (ratePct / 100));
  const dailyInstallment = totalAmount / duration;

  const data = {
    id,
    customerId: document.getElementById('dailyCustomer').value,
    amount,
    rate: ratePct / 100,
    durationDays: duration,
    totalAmount,
    dailyInstallment,
    date: document.getElementById('dailyDate').value,
    note: document.getElementById('dailyNote').value,
    status: existing >= 0 ? dailyLoans[existing].status : 'active',
    paidAmount: existing >= 0 ? (dailyLoans[existing].paidAmount || 0) : 0,
    createdAt: existing >= 0 ? dailyLoans[existing].createdAt : Date.now(),
  };

  if (!data.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }

  if (existing >= 0) dailyLoans[existing] = data;
  else dailyLoans.push(data);
  DB.set('daily_loans', dailyLoans);

  document.getElementById('dailyModal').close();
  renderDaily();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขสัญญาแล้ว' : 'เพิ่มเงินกู้รายวันแล้ว');
});

function editDaily(id) {
  const l = DB.get('daily_loans').find(l => l.id === id);
  if (l) openDailyModal(l);
}

function deleteDaily(id) {
  openConfirm('ต้องการลบเงินกู้รายวันนี้ใช่ไหม?', () => {
    DB.set('daily_loans', DB.get('daily_loans').filter(l => l.id !== id));
    renderDaily();
    updateBadges();
    showToast('ลบรายการแล้ว');
  });
}

let _payDailyContext = null;

function openPayDaily(id) {
  const item = DB.get('daily_loans').find(l => l.id === id);
  if (!item) return;
  const cust = DB.get('customers').find(c => c.id === item.customerId);
  const paid = item.paidAmount || 0;
  const remaining = item.totalAmount - paid;
  const elapsedDays = daysBetween(item.date, today());
  const expectedPaid = Math.min(item.totalAmount, elapsedDays * item.dailyInstallment);
  const overdueAmount = Math.max(0, expectedPaid - paid);

  _payDailyContext = { id, item, remaining };

  document.getElementById('payDailyDetail').innerHTML = `
    <strong>ลูกค้า:</strong> ${cust?.name || 'ไม่ระบุ'}<br>
    <strong>ยอดกู้รวมดอก:</strong> ${formatMoney(item.totalAmount)}<br>
    <strong>ยอดส่งต่อวัน:</strong> ${formatMoney(item.dailyInstallment)}<br>
    <strong>ส่งแล้ว:</strong> ${formatMoney(paid)} | <strong>คงเหลือ:</strong> <span style="color:var(--accent-rose)">${formatMoney(remaining)}</span><br>
    ${overdueAmount > 0 ? `<strong style="color:var(--accent-rose)">ยอดที่ควรส่งถึงวันนี้:</strong> ${formatMoney(expectedPaid)} (ค้าง ${formatMoney(overdueAmount)})<br>` : ''}
  `;

  document.getElementById('payDailyAmount').value = overdueAmount > 0 ? overdueAmount : item.dailyInstallment;
  document.getElementById('payDailyNote').value = '';
  document.getElementById('payDailyModal').showModal();
}

document.getElementById('closePayDailyModal').addEventListener('click', () => document.getElementById('payDailyModal').close());
document.getElementById('cancelPayDaily').addEventListener('click', () => document.getElementById('payDailyModal').close());

document.getElementById('confirmPayDaily').addEventListener('click', () => {
  if (!_payDailyContext) return;
  const amount = parseFloat(document.getElementById('payDailyAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const { id, item, remaining } = _payDailyContext;
  if (amount > remaining) {
    showToast(`รับเงินได้สูงสุดไม่เกินยอดคงเหลือ (${formatMoney(remaining)})`, 'error');
    return;
  }

  // Update loan
  const dailyLoans = DB.get('daily_loans');
  const idx = dailyLoans.findIndex(l => l.id === id);
  if (idx >= 0) {
    dailyLoans[idx].paidAmount = (dailyLoans[idx].paidAmount || 0) + amount;
    if (dailyLoans[idx].paidAmount >= dailyLoans[idx].totalAmount) {
      dailyLoans[idx].status = 'paid';
    }
    DB.set('daily_loans', dailyLoans);
  }

  // Log transaction
  const txs = DB.get('transactions');
  const cust = DB.get('customers').find(c => c.id === item.customerId);
  
  // Calculate proportional interest
  const totalInterest = item.totalAmount - item.amount;
  const interestRatio = totalInterest / item.totalAmount;
  const interestAmount = amount * interestRatio;
  
  txs.push({
    id: genId(),
    date: today(),
    type: 'daily_payment',
    customerId: item.customerId,
    amount,
    interestAmount, // explicit field for profit calculation
    note: document.getElementById('payDailyNote').value || `รับกู้รายวัน – ${cust?.name || ''}`,
    subType: 'daily',
    refId: id,
    createdAt: Date.now(),
  });
  DB.set('transactions', txs);

  document.getElementById('payDailyModal').close();
  showToast(`รับเงินรายวัน ${formatMoney(amount)} แล้ว`, 'success');

  renderDaily();
  renderDashboard();
});

// Quick Add Modal
// ============================================================
document.getElementById('quickAddBtn').addEventListener('click', () => {
  document.getElementById('quickAddModal').showModal();
});
document.getElementById('closeQuickAdd').addEventListener('click', () => document.getElementById('quickAddModal').close());

document.getElementById('qa-customer').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('customers');
  setTimeout(() => openCustomerModal(), 200);
});
document.getElementById('qa-loan').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('loans');
  setTimeout(() => openLoanModal(), 200);
});
document.getElementById('qa-daily').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('daily');
  setTimeout(() => openDailyModal(), 200);
});
document.getElementById('qa-pawn').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('pawns');
  setTimeout(() => openPawnModal(), 200);
});
document.getElementById('qa-tx').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('transactions');
  setTimeout(() => openTxModal(), 200);
});

// ============================================================
// Confirm Dialog
// ============================================================
let _confirmCallback = null;

function openConfirm(msg, cb) {
  document.getElementById('confirmMessage').textContent = msg;
  _confirmCallback = cb;
  document.getElementById('confirmModal').showModal();
}

document.getElementById('cancelConfirm').addEventListener('click', () => {
  document.getElementById('confirmModal').close();
  _confirmCallback = null;
});

document.getElementById('confirmDelete').addEventListener('click', () => {
  document.getElementById('confirmModal').close();
  if (_confirmCallback) _confirmCallback();
  _confirmCallback = null;
});

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
});

// ============================================================
// Date & Init
// ============================================================
function updateCurrentDate() {
  const d = new Date();
  const thDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  document.getElementById('currentDate').textContent =
    `${thDays[d.getDay()]} ${d.getDate()} ${thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// ============================================================
// App Init
// ============================================================
function init() {
  updateCurrentDate();
  navigateTo('dashboard');
  updateBadges();

  // Auto-refresh date every minute
  setInterval(updateCurrentDate, 60000);

  console.log('%c💰 Vider Finance Dashboard', 'font-size:18px;font-weight:bold;color:#f59e0b');
  console.log('%cLoan rate: 20% / 10 days | Pawn rate: 5% / 10 days', 'color:#94a3b8');
}

init();
