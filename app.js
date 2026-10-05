/* ==========================================================================
   app.js — ELGAZZAR INSTITUTES | أكاديمية الجزار — Async / Supabase edition
   ========================================================================== */
 
let session = null;
let activeGroupFilter = 'all';
let activeTeacherFilter = 'all';
let activeBranchFilter = 'all';
let html5QrInstance = null;
let confirmResolver = null;
let pendingEditId = null;
let editingTeacherId = null;
let editingStudentFinanceId = null;
let lastTiltEl = null;
let currentPage = 'dashboard';
let scannerBusy = false;
let flashCardStudentId = null; // لو مضبوطة، شاشة الاستقبال تعرض كارت هذا الطالب فقط (وضع الـ Flash Card من الباركود)
let addStudentGroupsCart = []; // سلة المجموعات (تعدد المواد) عند إضافة طالب جديد — { groupId, label }
let editStudentEnrollTarget = null;
let editingGroupId = null;
let editingSecretaryId = null;
let teacherCurrentGroupId = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => Number(n || 0).toLocaleString('ar-EG');

// دالة جلب التاريخ المحلي الصحيح (توقيت مصر) لمنع مشاكل جرينتش
function getLocalDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// دالة تحويل الوقت من 24 لـ 12 ساعة (ص/م)
function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? 'م' : 'ص';
  h = h % 12;
  h = h ? h : 12; // الصفر (منتصف الليل) يتحول لـ 12
  return `${h}:${m} ${ampm}`;
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ==========================================================================
   Branch helpers
   ========================================================================== */
function branchName(branchId) {
  return DB.getBranchById(branchId)?.name || '—';
}
function matchBranch(item, filterValue) {
  return !filterValue || filterValue === 'all' || String(item?.branch_id) === String(filterValue);
}
/** يملأ فلتر فرع (مع خيار "كل الفروع") ويحافظ على الاختيار الحالي */
function fillBranchFilter(sel) {
  if (!sel) return;
  const cur = sel.value || 'all';
  sel.innerHTML = '<option value="all">كل الفروع</option>' +
    DB.getBranches().map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
}
/** يملأ select فرع داخل مودال: الاختيار الافتراضي = المحدد، أو الفرع النشط، أو الفرع الوحيد */
function fillBranchSelect(sel, selectedId) {
  if (!sel) return;
  const branches = DB.getBranches();
  sel.innerHTML = '<option value="">— اختر —</option>' +
    branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  let def = selectedId || DB.getActiveBranchId() || (branches.length === 1 ? branches[0].id : '');
  sel.value = def ? String(def) : '';
  if (sel.value !== String(def || '')) sel.value = '';
}
async function loadLoginBranches() {
  const sel = $('#loginBranchSelect');
  if (!sel) return;
  try {
    await DB.refreshBranches();
    const branches = DB.getBranches();
    sel.innerHTML = '<option value="">— حسب حساب المستخدم —</option>' +
      branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">— تعذر تحميل الفروع —</option>';
  }
}

/* ==========================================================================
   Theme
   ========================================================================== */
function initTheme() {
  const saved = localStorage.getItem('elgazzar_theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('elgazzar_theme', theme);
  $$('.switch-icon').forEach(i => i.textContent = theme === 'dark' ? '☀️' : '🌙');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ==========================================================================
   3D tilt
   ========================================================================== */
function initTilt() {
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.tilt');
    if (el !== lastTiltEl && lastTiltEl) lastTiltEl.style.transform = '';
    if (el) {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (0.5 - py) * 8;
      const ry = (px - 0.5) * 8;
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
    }
    lastTiltEl = el;
  });
  document.addEventListener('mouseleave', () => {
    if (lastTiltEl) { lastTiltEl.style.transform = ''; lastTiltEl = null; }
  });
}

/* ==========================================================================
   Toasts / Confirm
   ========================================================================== */
function toast(message, type = '') {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 2700);
}
function askConfirm(title, message) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmModal').classList.remove('hidden');
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function closeConfirm(result) {
  $('#confirmModal').classList.add('hidden');
  if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}
function setSyncStatus(state) {
  const badge = $('#syncBadge');
  if (!badge) return;
  badge.classList.remove('online', 'offline', 'syncing');
  if (state === 'syncing') { badge.classList.add('syncing'); badge.innerHTML = '<i class="dot"></i>جاري المزامنة...'; }
  else if (state === 'offline') { badge.classList.add('offline'); badge.innerHTML = '<i class="dot"></i>غير متصل'; }
  else { badge.classList.add('online'); badge.innerHTML = '<i class="dot"></i>متصل'; }
}

/* ==========================================================================
   Login (username / password) — async against Supabase
   ========================================================================== */
function initLogin() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    const chosenBranch = $('#loginBranchSelect').value;
    const submitBtn = $('.login-submit');
    const errEl = $('#loginError');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري التحقق...';
    try {
      const user = await DB.login(username, password);
      if (!user) {
        errEl.textContent = '⚠ بيانات الدخول غير صحيحة';
        errEl.classList.remove('hidden');
        return;
      }
      // مستخدم مربوط بفرع: لازم الفرع المختار (لو اتحدد) يطابق فرعه
      if (user.branch_id && chosenBranch && String(user.branch_id) !== String(chosenBranch)) {
        errEl.textContent = '⚠ هذا الحساب غير تابع للفرع المختار';
        errEl.classList.remove('hidden');
        DB.setActiveBranch(null);
        return;
      }
      // مستخدم غير مربوط بفرع (مدير عام): الفرع المختار يحدد نطاق الداتا، أو الكل لو فاضي
      if (!user.branch_id) DB.setActiveBranch(chosenBranch || null);

      errEl.classList.add('hidden');
      session = user;
      // حفظ جلسة الدخول محلياً حتى لا يضطر المستخدم لإعادة تسجيل الدخول بعد الـ Refresh
      localStorage.setItem('elgazzar_session', JSON.stringify(user));
      $('#loginUsername').value = ''; $('#loginPassword').value = '';
      await enterApp();
    } catch (err) {
      toast('⚠️ تعذر الاتصال بقاعدة البيانات', 'error');
      console.error(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'دخول';
    }
  });
}
function roleLabel(role) {
  return role === 'admin' ? 'مدير الأكاديمية' : role === 'teacher' ? 'مدرس' : 'سكرتارية';
}
function updateActiveBranchLabel() {
  const el = $('#activeBranchLabel');
  if (!el) return;
  const id = DB.getActiveBranchId();
  el.textContent = id ? `🏢 ${branchName(id)}` : '🏢 كل الفروع';
}
async function enterApp() {
  setSyncStatus('syncing');
  try {
    await DB.refreshAll();
    setSyncStatus('online');
  } catch (err) {
    setSyncStatus('offline');
    toast('⚠️ حدث خطأ أثناء تحميل البيانات', 'error');
  }

  applyCenterBranding();
  $('#loginModal').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#userRoleBadge').textContent = roleLabel(session.role);
  $('#userNameLabel').textContent = session.full_name || session.username;
  updateActiveBranchLabel();

  $$('.side-link').forEach(link => {
    const roles = (link.dataset.roles || '').split(',');
    link.classList.toggle('hidden', !roles.includes(session.role));
  });

  const defaultPage = session.role === 'admin' ? 'dashboard' : session.role === 'secretary' ? 'reception' : 'teacherPortal';
  await goToPage(defaultPage);
  refreshSideBadge();
  DB.initRealtimeSync(); // تفعيل المزامنة اللحظية بعد الدخول (مرة واحدة فقط)
}
function logout() {
  session = null;
  // مسح الجلسة من الـ localStorage فقط عند الضغط الصريح على "تسجيل الخروج"
  localStorage.removeItem('elgazzar_session');
  DB.setActiveBranch(null);
  $('#app').classList.add('hidden');
  $('#loginModal').classList.remove('hidden');
  loadLoginBranches();
}
function applyCenterBranding() {
  const info = DB.getCenterInfo();
  $$('.login-brand').forEach(el => el.innerHTML = `${info.nameEn.split(' ')[0]} <span>${info.nameEn.split(' ').slice(1).join(' ')}</span>`);
  document.title = 'أكاديمية الجزار التعليمية';
}

/* ==========================================================================
   Sidebar navigation
   ========================================================================== */
const PAGE_TITLES = {
  dashboard: ['لوحة التحكم', 'نظرة عامة على الأكاديمية'],
  students: ['شؤون الطلاب', 'إدارة بيانات الطلاب والمديونيات'],
  teachers: ['إدارة المدرسين', 'حسابات وبيانات المدرسين'],
  groups: ['المجموعات', 'إدارة مجموعات المواد والمعلمين'],
  gradeLevels: ['المراحل والمواد', 'إدارة السنوات الدراسية والمواد المرتبطة بها'],
  secretaries: ['إدارة السكرتارية', 'حسابات دخول موظفي الاستقبال'],
  approvals: ['طابور الاعتماد', 'مراجعة واعتماد السجلات اليومية'],
  finance: ['التقارير المالية', 'الأرباح، الخسائر، والمستحقات'],
  master: ['الشيت المجمع', 'كل بيانات الطالب في مكان واحد'],
  reception: ['استقبال وحضور', 'تسجيل الحضور والمدفوعات'],
  teacherPortal: ['لوحة المدرس', 'رصد الدرجات والملاحظات'],
  branches: ['إدارة الفروع', 'إضافة وتعديل فروع الأكاديمية'],
  settings: ['الإعدادات', 'بيانات السنتر والمظهر'],
};
async function goToPage(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.add('hidden'));
  const target = $(`#page-${page}`);
  if (target) target.classList.remove('hidden');
  $$('.side-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  const [title, sub] = PAGE_TITLES[page] || ['', ''];
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = sub;
  closeMobileSidebar();
  await renderPage(page);
}
async function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  else if (page === 'students') renderStudentsDirectory();
  else if (page === 'teachers') renderTeachersDirectory();
  else if (page === 'groups') renderGroupsPage();
  else if (page === 'gradeLevels') renderGradeLevelsPage();
  else if (page === 'secretaries') renderSecretariesPage();
  else if (page === 'approvals') renderApprovalsPage();
  else if (page === 'finance') renderFinancePage();
  else if (page === 'master') renderMasterTable();
  else if (page === 'reception') { renderGroupChips(); renderStudentsList(); }
  else if (page === 'teacherPortal') renderTeacherPortalRoot();
  else if (page === 'branches') renderBranchesPage();
  else if (page === 'settings') renderSettingsPage();
}
function initSidebar() {
  $$('.side-link').forEach(link => {
    link.addEventListener('click', () => goToPage(link.dataset.page));
  });
  $$('[data-goto]').forEach(btn => btn.addEventListener('click', () => goToPage(btn.dataset.goto)));

  $('#sidebarToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
    $('#sidebarToggle').textContent = $('#sidebar').classList.contains('collapsed') ? '»' : '«';
  });
  $('#mobileMenuBtn').addEventListener('click', () => {
    $('#sidebar').classList.add('mobile-open');
    $('#sidebarBackdrop').classList.remove('hidden');
  });
  $('#sidebarBackdrop').addEventListener('click', closeMobileSidebar);
}
function closeMobileSidebar() {
  $('#sidebar').classList.remove('mobile-open');
  $('#sidebarBackdrop').classList.add('hidden');
}
function refreshSideBadge() {
  const count = DB.getPendingRecords().length;
  $('#sideApprovalBadge').textContent = count;
  const pageBadge = $('#approvalsPageBadge');
  if (pageBadge) pageBadge.textContent = count;
}

/* ==========================================================================
   Branches page (admin)
   ========================================================================== */
function renderBranchesPage() {
  const branches = DB.getBranches();
  const grid = $('#branchesGrid');
  grid.innerHTML = '';
  $('#branchesEmpty').classList.toggle('hidden', branches.length > 0);

  branches.forEach(b => {
    const studentsCount = DB.cache.students.filter(s => String(s.branch_id) === String(b.id)).length;
    const teachersCount = DB.cache.teachers.filter(t => String(t.branch_id) === String(b.id)).length;
    const groupsCount = DB.cache.groups.filter(g => String(g.branch_id) === String(b.id)).length;
    const isActive = String(DB.getActiveBranchId()) === String(b.id);
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">🏢</div>
        <div>
          <div class="dir-name">${escapeHtml(b.name)}</div>
          <div class="dir-role">${isActive ? '✅ الفرع النشط حالياً' : 'فرع'}</div>
        </div>
      </div>
      <div class="dir-stats-row">
        <div class="dir-stat"><b>${studentsCount}</b><span>طالب</span></div>
        <div class="dir-stat"><b>${teachersCount}</b><span>مدرس</span></div>
        <div class="dir-stat"><b>${groupsCount}</b><span>مجموعة</span></div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-branch="${b.id}">✏️ تعديل الاسم</button>
        <button class="ghost-btn danger" data-delete-branch="${b.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-branch]').forEach(btn => btn.addEventListener('click', async () => {
    const b = DB.getBranchById(btn.dataset.editBranch);
    if (!b) return;
    const newName = prompt('اسم الفرع:', b.name);
    if (!newName || !newName.trim() || newName.trim() === b.name) return;
    const res = await DB.updateBranch(b.id, { name: newName });
    if (!res || res.message) { toast('⚠️ تعذر تعديل الفرع', 'error'); return; }
    toast('✅ تم تعديل اسم الفرع', 'success');
    updateActiveBranchLabel();
    renderBranchesPage();
  }));
  grid.querySelectorAll('[data-delete-branch]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف الفرع؟', 'سيتم حذف الفرع. لو عليه بيانات مرتبطة قد يرفض النظام الحذف.');
    if (!ok) return;
    const res = await DB.deleteBranch(btn.dataset.deleteBranch);
    if (res && res.error) { toast('⚠️ تعذر الحذف: ' + res.error, 'error'); return; }
    if (String(DB.getActiveBranchId()) === String(btn.dataset.deleteBranch)) DB.setActiveBranch(null);
    toast('🗑️ تم حذف الفرع');
    updateActiveBranchLabel();
    renderBranchesPage();
  }));
}
function initBranchesPage() {
  $('#addBranchBtn').addEventListener('click', async () => {
    const input = $('#newBranchName');
    const name = input.value.trim();
    if (!name) { toast('⚠️ أدخل اسم الفرع', 'error'); return; }
    const res = await DB.addBranch({ name });
    if (res && res.error) { toast('⚠️ ' + res.error, 'error'); return; }
    input.value = '';
    toast('✅ تم إضافة الفرع', 'success');
    renderBranchesPage();
  });
}
/* ربط فلاتر الفروع/المراحل الثابتة في الصفحات بإعادة الرسم */
function initPageFilters() {
  ['studentsDirBranchFilter', 'studentsDirGradeFilter', 'teachersBranchFilter',
   'groupsBranchFilter', 'groupsGradeFilter', 'groupsTeacherFilter',
   'secretariesBranchFilter', 'gradeLevelsBranchFilter', 'finBranchFilter'
  ].forEach(id => $('#' + id)?.addEventListener('change', () => renderPage(currentPage)));

  $('#receptionBranchFilter')?.addEventListener('change', (e) => {
    activeBranchFilter = e.target.value;
    flashCardStudentId = null;
    renderStudentsList();
  });
}

/* ==========================================================================
   Dashboard
   ========================================================================== */
function renderDashboard() {
  const stats = DB.getStats();
  $('#statTotalStudents').textContent = stats.totalStudents;
  $('#statActiveGroups').textContent = stats.activeGroups;
  $('#statTotalTeachers').textContent = stats.totalTeachers;
  $('#statTotalSecretaries').textContent = stats.totalSecretaries;
  $('#statPendingApprovals').textContent = stats.pendingApprovals;
  $('#statApprovedToday').textContent = stats.approvedToday;

  const fin = DB.getFinanceSummary();
  $('#dashNetProfit').textContent = fmt(fin.netProfit);
  $('#dashCollected').textContent = fmt(fin.totalCollected);
  $('#dashOutstanding').textContent = fmt(fin.totalOutstanding);

  const pending = DB.getPendingRecords().slice(0, 6);
  const list = $('#dashPendingPreview');
  $('#dashNoApprovals').classList.toggle('hidden', pending.length > 0);
  list.innerHTML = '';
  pending.forEach(r => list.appendChild(buildApprovalCard(r)));
  refreshSideBadge();
}

/* ==========================================================================
   Students Directory (admin)
   ========================================================================== */
function renderStudentsDirFilterOptions() {
  fillBranchFilter($('#studentsDirBranchFilter'));

  const gradeSel = $('#studentsDirGradeFilter');
  const curGrade = gradeSel.value || 'all';
  const uniqueGrades = [...new Set(DB.getGradeLevels())];
  gradeSel.innerHTML = '<option value="all">كل المراحل</option>' + uniqueGrades.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  gradeSel.value = uniqueGrades.includes(curGrade) ? curGrade : 'all';

  const sel = $('#studentsDirGroupFilter');
  const current = sel.value;
  const branchF = $('#studentsDirBranchFilter').value;
  const groups = DB.getGroups().filter(g => matchBranch(g, branchF));
  sel.innerHTML = '<option value="all">كل المجموعات</option>' + groups.map(g => {
    const teacher = DB.getTeacherById(g.teacher_id);
    const label = `${g.grade_level || ''} — ${teacher ? teacher.name : 'بدون مدرس'}`;
    return `<option value="${g.id}">${escapeHtml(label)}</option>`;
  }).join('');
  sel.value = [...sel.options].some(o => o.value === current) ? current : 'all';
}
function debtBadgeHtml(debt) {
  const d = Number(debt) || 0;
  if (d > 0) {
    return `<span class="debt-badge" style="background:var(--danger-bg);color:var(--danger); direction:ltr; display:inline-block;">-${fmt(d)} ج</span>`;
  } else if (d < 0) {
    return `<span class="debt-badge" style="background:var(--success-bg);color:var(--success); direction:ltr; display:inline-block;">+${fmt(Math.abs(d))} ج</span>`;
  }
  return `<span class="debt-badge zero">0 ج</span>`;
}
function renderStudentsDirectory() {
  renderStudentsDirFilterOptions();
  const search = ($('#studentsDirSearch').value || '').trim().toLowerCase();
  const branchFilter = $('#studentsDirBranchFilter').value;
  const gradeFilter = $('#studentsDirGradeFilter').value;
  const groupFilter = $('#studentsDirGroupFilter').value;
  const debtFilter = $('#studentsDirPayFilter').value;

  let students = DB.getStudents();
  if (branchFilter !== 'all') students = students.filter(s => matchBranch(s, branchFilter));
  if (gradeFilter !== 'all') students = students.filter(s => s.grade_level === gradeFilter);
  if (groupFilter !== 'all') {
    students = students.filter(s => DB.getStudentGroupIds(s.id).some(gid => String(gid) === String(groupFilter)));
  }
  if (search) students = students.filter(s => s.name.toLowerCase().includes(search) || String(s.student_code).toLowerCase().includes(search));
  if (debtFilter === 'clear') students = students.filter(s => (Number(s.total_debt) || 0) <= 0);
  if (debtFilter === 'debt') students = students.filter(s => (Number(s.total_debt) || 0) > 0);

  const body = $('#studentsDirBody');
  body.innerHTML = '';
  $('#studentsDirEmpty').classList.toggle('hidden', students.length > 0);

  students.forEach(s => {
    const groupIds = DB.getStudentGroupIds(s.id);
    const groupLabels = groupIds.map(gid => {
      const g = DB.getGroupById(gid);
      if (!g) return null;
      const teacher = DB.getTeacherById(g.teacher_id);
      return teacher ? teacher.name : g.grade_level;
    }).filter(Boolean);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${escapeHtml(s.name)}</b></td>
      <td>#${escapeHtml(s.student_code)}</td>
      <td>${escapeHtml(branchName(s.branch_id))}</td>
      <td>${escapeHtml(s.grade_level || '—')}</td>
      <td>${groupLabels.length ? escapeHtml(groupLabels.join('، ')) : '—'}</td>
      <td>${escapeHtml(s.parent_phone || '—')}</td>
      <td>${debtBadgeHtml(s.total_debt)}</td>
      <td><button class="row-action-btn" data-edit-student="${s.id}" title="تعديل">✏️</button></td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('[data-edit-student]').forEach(btn => {
    btn.addEventListener('click', () => openStudentFinanceModal(btn.dataset.editStudent));
  });
}
function initStudentsDirectoryFilters() {
  $('#studentsDirSearch').addEventListener('input', renderStudentsDirectory);
  $('#studentsDirGroupFilter').addEventListener('change', renderStudentsDirectory);
  $('#studentsDirPayFilter').addEventListener('change', renderStudentsDirectory);
}

/* ==========================================================================
   Shared cascading helpers (فرع → مرحلة → مادة → معلم → مجموعة)
   ========================================================================== */
function fillSubjectSelect(selectEl, selectedId, gradeLevelId) {
  if (!gradeLevelId) {
    selectEl.innerHTML = '<option value="">— اختر المرحلة أولاً —</option>';
    selectEl.disabled = true;
    return;
  }
  const subjects = DB.getSubjectsByGradeLevel(gradeLevelId);
  selectEl.innerHTML = '<option value="">— اختر —</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  selectEl.disabled = false;
  if (selectedId) selectEl.value = selectedId;
}
/** branchId === undefined → كل المراحل بدون منطق فرع. غير ذلك: المراحل التابعة للفرع (أو "اختر الفرع أولاً") */
function fillGradeLevelSelectDynamic(selectEl, selectedId, branchId) {
  if (branchId !== undefined && DB.getBranches().length > 0 && !branchId) {
    selectEl.innerHTML = '<option value="">— اختر الفرع أولاً —</option>';
    selectEl.disabled = true;
    return;
  }
  let levels = DB.getGradeLevelRows();
  if (branchId) levels = levels.filter(l => !l.branch_id || String(l.branch_id) === String(branchId));
  selectEl.innerHTML = '<option value="">— اختر —</option>' + levels.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  selectEl.disabled = false;
  if (selectedId) selectEl.value = selectedId;
}

/** ربط سلسلة الاختيارات الهرمية (تستخدم في إضافة طالب + تعديل طالب) */
function bindEnrollCascade(ids) {
  const br = $(ids.branch), gs = $(ids.grade), ss = $(ids.subject), ts = $(ids.teacher), grp = $(ids.group);
  const clear = (sel, text) => { sel.innerHTML = `<option value="">${text}</option>`; sel.disabled = true; };

  br.addEventListener('change', () => {
    clear(ss, '— اختر المرحلة أولاً —'); clear(ts, '— اختر المادة أولاً —'); clear(grp, '— اختر المعلم أولاً —');
    fillGradeLevelSelectDynamic(gs, '', br.value);
  });

  gs.addEventListener('change', () => {
    const gradeLevelId = gs.value;
    clear(ts, '— اختر المادة أولاً —'); clear(grp, '— اختر المعلم أولاً —');
    if (!gradeLevelId) { clear(ss, '— اختر المرحلة أولاً —'); return; }
    fillSubjectSelect(ss, '', gradeLevelId);
    ss.dataset.gradeLevelName = DB.getGradeLevelById(gradeLevelId)?.name || '';
  });

  ss.addEventListener('change', () => {
    const gradeLevelName = ss.dataset.gradeLevelName || '';
    const subjectId = ss.value;
    clear(grp, '— اختر المعلم أولاً —');
    if (!subjectId) { clear(ts, '— اختر المادة أولاً —'); return; }
    const matching = DB.getGroupsByGradeLevel(gradeLevelName)
      .filter(g => String(g.subject_id) === String(subjectId) && matchBranch(g, br.value));
    const teacherIds = [...new Set(matching.map(g => String(g.teacher_id)))];
    const teachers = DB.getTeachers().filter(t => teacherIds.includes(String(t.id)));
    ts.innerHTML = '<option value="">— اختر —</option>' + teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    ts.disabled = false;
  });

  ts.addEventListener('change', () => {
    const gradeLevelName = ss.dataset.gradeLevelName || '';
    const subjectId = ss.value;
    const teacherId = ts.value;
    if (!teacherId) { clear(grp, '— اختر المعلم أولاً —'); return; }
    const matching = DB.getGroupsByGradeLevel(gradeLevelName)
      .filter(g => String(g.subject_id) === String(subjectId) && String(g.teacher_id) === String(teacherId) && matchBranch(g, br.value));
    grp.innerHTML = '<option value="">— اختر —</option>' + matching.map(g => `<option value="${g.id}">${escapeHtml(g.day_of_week || '')} ${escapeHtml(g.time_start ? formatTime12h(g.time_start) : '')}</option>`).join('');
    grp.disabled = false;
  });
}
function resetEnrollCascade(ids) {
  const br = $(ids.branch), gs = $(ids.grade), ss = $(ids.subject), ts = $(ids.teacher), grp = $(ids.group);
  fillBranchSelect(br);
  ss.innerHTML = '<option value="">— اختر المرحلة أولاً —</option>'; ss.disabled = true;
  ts.innerHTML = '<option value="">— اختر المادة أولاً —</option>'; ts.disabled = true;
  grp.innerHTML = '<option value="">— اختر المعلم أولاً —</option>'; grp.disabled = true;
  fillGradeLevelSelectDynamic(gs, '', br.value);
}
const STUDENT_CASCADE_IDS = { branch: '#newStudentBranch', grade: '#newStudentGradeLevel', subject: '#newStudentSubject', teacher: '#newStudentTeacherSelect', group: '#newStudentGroupSelect' };
const SF_CASCADE_IDS = { branch: '#sfEnrollBranch', grade: '#sfEnrollGradeLevel', subject: '#sfEnrollSubject', teacher: '#sfEnrollTeacher', group: '#sfEnrollGroup' };

/* ---- Student finance edit modal ---- */
function openStudentFinanceModal(studentId) {
  const student = DB.getStudentById(studentId);
  if (!student) return;
  editingStudentFinanceId = student.id;
  $('#sfStudentName').textContent = `${student.name} — #${student.student_code}`;
  const sd = Number(student.total_debt) || 0;
  $('#sfCurrentDebt').innerHTML = sd > 0 ? `<span style="color:var(--danger); font-weight:bold;">عليه ${fmt(sd)}</span>` : sd < 0 ? `<span style="color:var(--success); font-weight:bold;">له ${fmt(Math.abs(sd))}</span>` : '0';
  $('#sfStudentCode').value = student.student_code || '';
  $('#sfEditStudentName').value = student.name || '';
  $('#sfDebt').value = student.total_debt || 0;
  $('#sfGradeLevel').value = student.grade_level || '';
  $('#sfParentPhone').value = student.parent_phone || '';
  renderSfGroupsChips(student.id);
  resetSfEnrollCascade(student.branch_id);
  $('#studentFinanceModal').classList.remove('hidden');
}
/* عرض المواد المشترك بها الطالب حالياً + زر "❌ إلغاء الاشتراك" لكل مادة — تعدد المواد */
function renderSfGroupsChips(studentId) {
  const container = $('#sfGroupsChips');
  const groups = DB.getGroupsForStudent(studentId);
  container.innerHTML = groups.length
    ? groups.map(g => `<span class="subject-chip">${escapeHtml(groupCartLabel(g.id))}<button data-unenroll-group="${g.id}" title="إلغاء الاشتراك">✕</button></span>`).join('')
    : '<span class="sub">لا يوجد اشتراكات حالياً</span>';

  container.querySelectorAll('[data-unenroll-group]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('إلغاء الاشتراك؟', 'سيتم إلغاء اشتراك الطالب في هذه المادة نهائياً.');
    if (!ok) return;
    await DB.unenrollStudentFromGroup(studentId, btn.dataset.unenrollGroup);
    toast('❌ تم إلغاء الاشتراك');
    renderSfGroupsChips(studentId);
    renderStudentsDirectory();
    if (currentPage === 'reception') renderStudentsList();
  }));
}
function resetSfEnrollCascade(studentBranchId) {
  resetEnrollCascade(SF_CASCADE_IDS);
  // لو الطالب تابع لفرع، نضبط الفرع عليه تلقائياً
  if (studentBranchId && !$('#sfEnrollBranch').value) {
    fillBranchSelect($('#sfEnrollBranch'), studentBranchId);
    fillGradeLevelSelectDynamic($('#sfEnrollGradeLevel'), '', $('#sfEnrollBranch').value);
  }
}
function initSfEnrollCascadingSelects() {
  bindEnrollCascade(SF_CASCADE_IDS);

  $('#sfAddGroupBtn').addEventListener('click', async () => {
    const groupId = $('#sfEnrollGroup').value;
    if (!groupId || !editingStudentFinanceId) { toast('⚠️ من فضلك أكمل اختيار المجموعة', 'error'); return; }
    const already = DB.getStudentGroupIds(editingStudentFinanceId).some(gid => String(gid) === String(groupId));
    if (already) { toast('⚠️ الطالب مسجل بالفعل في هذه المادة', 'error'); return; }
    await DB.enrollStudentInGroup(editingStudentFinanceId, groupId);
    toast('✅ تم تسجيل الطالب في المادة الجديدة', 'success');
    renderSfGroupsChips(editingStudentFinanceId);
    resetSfEnrollCascade(DB.getStudentById(editingStudentFinanceId)?.branch_id);
    renderStudentsDirectory();
    if (currentPage === 'reception') renderStudentsList();
  });
}
function initStudentFinanceModal() {
  $('#studentFinanceModalClose').addEventListener('click', () => $('#studentFinanceModal').classList.add('hidden'));
  $('#sfSaveBtn').addEventListener('click', async () => {
    if (!editingStudentFinanceId) return;
    await DB.updateStudent(editingStudentFinanceId, {
      name: $('#sfEditStudentName').value.trim(),
      studentCode: $('#sfStudentCode').value.trim(),
      totalDebt: Number($('#sfDebt').value) || 0,
      gradeLevel: $('#sfGradeLevel').value.trim(),
      parentPhone: $('#sfParentPhone').value.trim(),
    });
    $('#studentFinanceModal').classList.add('hidden');
    toast('✅ تم حفظ بيانات الطالب', 'success');
    renderStudentsDirectory();
    if (currentPage === 'finance') renderFinancePage();
    if (currentPage === 'dashboard') renderDashboard();
  });
  $('#sfDeleteBtn').addEventListener('click', async () => {
    if (!editingStudentFinanceId) return;
    const ok = await askConfirm('حذف الطالب؟', 'سيتم حذف بيانات الطالب نهائياً.');
    if (ok) {
      await DB.deleteStudent(editingStudentFinanceId);
      $('#studentFinanceModal').classList.add('hidden');
      toast('🗑️ تم حذف الطالب');
      renderStudentsDirectory();
    }
  });
}

/* ==========================================================================
   Teachers Directory (admin)
   ========================================================================== */
function renderTeachersDirectory() {
  fillBranchFilter($('#teachersBranchFilter'));
  const branchF = $('#teachersBranchFilter').value;
  const teachers = DB.getTeachers().filter(t => matchBranch(t, branchF));
  const grid = $('#teachersGrid');
  grid.innerHTML = '';
  $('#teachersEmpty').classList.toggle('hidden', teachers.length > 0);

  teachers.forEach(t => {
    const subject = DB.getSubjects().find(sub => String(sub.id) === String(t.subject_id));
    const studentsCount = DB.getStudentsCountForTeacher(t.id);
    const groupsCount = DB.getGroupsByTeacher(t.id).length;

    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">${initials(t.name)}</div>
        <div>
          <div class="dir-name">${escapeHtml(t.name)}</div>
          <div class="dir-role">📖 ${escapeHtml(subject?.name || 'بدون مادة')}</div>
          <div class="dir-role" style="margin-top:4px;">🏢 ${escapeHtml(branchName(t.branch_id))}</div>
          <div class="dir-role" style="margin-top:4px; font-size:12px; font-weight:600; color:var(--ink-soft);">المراحل: ${escapeHtml(t.grade_level || '—')}</div>
          <div class="dir-role" style="margin-top:4px;">📞 ${escapeHtml(t.phone || '—')}</div>
        </div>
      </div>
      <div class="dir-stats-row">
        <div class="dir-stat"><b>${studentsCount}</b><span>طالب</span></div>
        <div class="dir-stat"><b>${groupsCount}</b><span>مجموعة</span></div>
        <div class="dir-stat"><b>${t.profit_percentage || 0}%</b><span>نسبة الربح</span></div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-teacher="${t.id}">✏️ تعديل</button>
        <button class="ghost-btn danger" data-delete-teacher="${t.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-teacher]').forEach(btn => btn.addEventListener('click', () => openTeacherModal(btn.dataset.editTeacher)));
  grid.querySelectorAll('[data-delete-teacher]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف المدرس؟', 'سيتم حذف بيانات المدرس وحسابه المرتبط.');
    if (ok) { await DB.deleteTeacher(btn.dataset.deleteTeacher); toast('🗑️ تم حذف المدرس'); renderTeachersDirectory(); }
  }));
}
function renderTeacherGradeCheckboxes(branchId, checkedNames) {
  let levels = DB.getGradeLevelRows();
  if (branchId) levels = levels.filter(l => !l.branch_id || String(l.branch_id) === String(branchId));
  const container = $('#teacherGradeLevelsCheckboxes');
  container.innerHTML = levels.map(g => {
    const isChecked = checkedNames.includes(g.name) ? 'checked' : '';
    return `<label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:600; font-size:13px;">
              <input type="checkbox" value="${escapeHtml(g.name)}" class="teacher-grade-cb" ${isChecked}>
              ${escapeHtml(g.name)}
            </label>`;
  }).join('') || '<span class="sub">لا توجد مراحل لهذا الفرع</span>';
}
function openTeacherModal(teacherId) {
  editingTeacherId = teacherId || null;
  const t = teacherId ? DB.getTeacherById(teacherId) : null;
  $('#teacherModalTitle').textContent = t ? '✏️ تعديل بيانات المدرس' : '➕ إضافة مدرس جديد';
  $('#teacherName').value = t?.name || '';
  $('#teacherPhone').value = t?.phone || '';
  $('#teacherProfitPercentage').value = t?.profit_percentage ?? 50;

  fillBranchSelect($('#teacherBranchSelect'), t?.branch_id);

  // 1. جلب كل المواد بدون تكرار الأسماء
  const uniqueSubjects = [];
  const seenNames = new Set();
  DB.getSubjects().forEach(s => {
    if (!seenNames.has(s.name)) { seenNames.add(s.name); uniqueSubjects.push(s); }
  });
  const subjSelect = $('#teacherSubjectSelect');
  subjSelect.innerHTML = '<option value="">— اختر المادة —</option>' +
    uniqueSubjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (t?.subject_id) subjSelect.value = t.subject_id;

  // 2. مربعات اختيار المراحل (حسب الفرع)
  const teacherGrades = t?.grade_level ? t.grade_level.split('،').map(g => g.trim()) : [];
  renderTeacherGradeCheckboxes($('#teacherBranchSelect').value, teacherGrades);

  const existingUser = t ? DB.getUsers().find(u => String(u.teacher_id) === String(t.id)) : null;
  $('#teacherUsername').value = existingUser?.username || '';
  $('#teacherPassword').value = existingUser?.password_hash || '';
  $('#teacherModal').classList.remove('hidden');
}
function initTeacherModal() {
  $('#addTeacherBtn').addEventListener('click', () => openTeacherModal(null));
  $('#teacherModalClose').addEventListener('click', () => $('#teacherModal').classList.add('hidden'));
  $('#teacherBranchSelect').addEventListener('change', () => {
    const checked = $$('.teacher-grade-cb:checked').map(cb => cb.value);
    renderTeacherGradeCheckboxes($('#teacherBranchSelect').value, checked);
  });

  $('#saveTeacherBtn').addEventListener('click', async () => {
    const name = $('#teacherName').value.trim();
    const subjectId = $('#teacherSubjectSelect').value || null;
    const username = $('#teacherUsername').value.trim();
    const password = $('#teacherPassword').value.trim();
    const branchId = $('#teacherBranchSelect').value || null;

    const selectedGrades = $$('.teacher-grade-cb:checked').map(cb => cb.value);
    const gradeLevelString = selectedGrades.join('، ');

    if (!name) { toast('⚠️ من فضلك أدخل اسم المدرس', 'error'); return; }
    if (DB.getBranches().length > 0 && !branchId && !DB.getActiveBranchId()) { toast('⚠️ من فضلك اختر الفرع', 'error'); return; }
    if (!subjectId) { toast('⚠️ من فضلك اختر المادة', 'error'); return; }
    if (selectedGrades.length === 0) { toast('⚠️ يجب اختيار مرحلة دراسية واحدة على الأقل', 'error'); return; }
    if (!username || !password) { toast('⚠️ اسم المستخدم وكلمة المرور إجباريان', 'error'); return; }

    const payload = {
      name,
      subjectId,
      gradeLevel: gradeLevelString,
      gradeLevelId: null,
      phone: $('#teacherPhone').value.trim(),
      profitPercentage: Number($('#teacherProfitPercentage').value) || 0,
      branchId,
    };

    let teacher;
    if (editingTeacherId) teacher = await DB.updateTeacher(editingTeacherId, payload);
    else teacher = await DB.addTeacher(payload);
    if (!teacher) { toast('⚠️ تعذر حفظ بيانات المدرس', 'error'); return; }

    const existing = DB.getUsers().find(u => String(u.teacher_id) === String(teacher.id));
    if (existing) await DB.updateUser(existing.id, { username, password, name: teacher.name, branchId: teacher.branch_id });
    else {
      const res = await DB.addUser({ username, password, role: 'teacher', name: teacher.name, teacherId: teacher.id, branchId: teacher.branch_id });
      if (res && res.error) { toast('⚠️ اسم المستخدم مستخدم بالفعل', 'error'); return; }
    }

    $('#teacherModal').classList.add('hidden');
    toast('✅ تم حفظ بيانات المدرس وحساب الدخول', 'success');
    renderTeachersDirectory();
  });
}

/* ==========================================================================
   Groups page (admin) — مع دعم الإضافة والتعديل الكامل
   ========================================================================== */
function renderGroupsPage() {
  const grid = $('#groupsGrid');

  // 1. تعبئة الفلاتر الثابتة (فرع → مرحلة → مدرس) مع الاحتفاظ بالاختيار الحالي
  fillBranchFilter($('#groupsBranchFilter'));
  const branchF = $('#groupsBranchFilter').value;
  const teacherSel = $('#groupsTeacherFilter');
  const gradeSel = $('#groupsGradeFilter');
  const curTeacher = teacherSel.value || 'all';
  const curGrade = gradeSel.value || 'all';

  const teachersList = DB.getTeachers().filter(t => matchBranch(t, branchF));
  teacherSel.innerHTML = '<option value="all">كل المدرسين</option>' + teachersList.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  teacherSel.value = [...teacherSel.options].some(o => o.value === curTeacher) ? curTeacher : 'all';

  const uniqueGrades = [...new Set(DB.getGradeLevels())];
  gradeSel.innerHTML = '<option value="all">كل المراحل</option>' + uniqueGrades.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  gradeSel.value = uniqueGrades.includes(curGrade) ? curGrade : 'all';

  // 2. فلترة المجموعات
  let groups = DB.getGroups().filter(g => matchBranch(g, branchF));
  if (gradeSel.value !== 'all') groups = groups.filter(g => g.grade_level === gradeSel.value);
  if (teacherSel.value !== 'all') groups = groups.filter(g => String(g.teacher_id) === String(teacherSel.value));

  // 3. رسم المجموعات
  grid.innerHTML = '';
  $('#groupsEmpty').classList.toggle('hidden', groups.length > 0);

  groups.forEach(g => {
    const teacher = DB.getTeacherById(g.teacher_id);
    const subject = DB.getSubjects().find(s => String(s.id) === String(g.subject_id));
    const studentsCount = DB.getStudentsByGroup(g.id).length;
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">${initials(teacher?.name || 'مج')}</div>
        <div>
          <div class="dir-name">${escapeHtml(g.grade_level || '—')}</div>
          <div class="dir-role">${escapeHtml(teacher?.name || 'بدون مدرس')} · ${escapeHtml(subject?.name || 'بدون مادة')}</div>
          <div class="dir-role" style="margin-top:4px;">🏢 ${escapeHtml(branchName(g.branch_id))}</div>
        </div>
      </div>
      <div class="group-meta-row">
        <span class="group-meta-pill">📅 ${escapeHtml(g.day_of_week || '—')}</span>
        <span class="group-meta-pill">⏰ ${g.time_start ? formatTime12h(g.time_start) : '—'}</span>
        <span class="group-meta-pill">💵 ${fmt(g.price_per_session)} ج/حصة</span>
        <span class="group-meta-pill">🏛️ ${DB.getCenterPercentage(g)}% سنتر</span>
      </div>
      <div class="dir-stats-row">
        <div class="dir-stat"><b>${studentsCount}</b><span>طالب مسجل</span></div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-group="${g.id}">✏️ تعديل المجموعة</button>
        <button class="ghost-btn danger" data-delete-group="${g.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-group]').forEach(btn => {
    btn.addEventListener('click', () => openGroupModal(btn.dataset.editGroup));
  });

  grid.querySelectorAll('[data-delete-group]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف المجموعة؟', 'سيتم حذف المجموعة (الطلاب المسجلين بها لن يُحذفوا).');
    if (ok) { await DB.deleteGroup(btn.dataset.deleteGroup); toast('🗑️ تم حذف المجموعة'); renderGroupsPage(); }
  }));
}

function fillGroupModalTeacherSelect(branchId, selectedId) {
  const sel = $('#groupTeacher');
  const teachers = DB.getTeachers().filter(t => matchBranch(t, branchId));
  sel.innerHTML = '<option value="">— اختر —</option>' + teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  sel.disabled = false;
  if (selectedId) sel.value = selectedId;
}

function openGroupModal(groupId = null) {
  editingGroupId = groupId;
  const g = groupId ? DB.getGroupById(groupId) : null;

  const titleEl = $('#groupModal .panel-header h2');
  if (titleEl) titleEl.textContent = g ? '✏️ تعديل المجموعة' : '➕ إنشاء مجموعة جديدة';

  fillBranchSelect($('#groupBranch'), g?.branch_id);
  const bv = $('#groupBranch').value;
  fillGradeLevelSelectDynamic($('#groupGradeLevel'), g?.grade_level_id, bv);
  fillSubjectSelect($('#groupSubject'), g?.subject_id, $('#groupGradeLevel').value);
  fillGroupModalTeacherSelect(bv, g?.teacher_id);

  $('#groupDayOfWeek').value = g?.day_of_week || 'السبت';
  $('#groupTimeStart').value = g?.time_start || '';
  $('#groupPricePerSession').value = g?.price_per_session ?? '';
  $('#groupCenterPercentage').value = g ? DB.getCenterPercentage(g) : 30;

  $('#groupModal').classList.remove('hidden');
}

function initGroupModal() {
  $('#addGroupBtn').addEventListener('click', () => openGroupModal(null));
  $('#groupModalClose').addEventListener('click', () => $('#groupModal').classList.add('hidden'));

  $('#groupBranch').addEventListener('change', () => {
    const bv = $('#groupBranch').value;
    fillGradeLevelSelectDynamic($('#groupGradeLevel'), '', bv);
    fillSubjectSelect($('#groupSubject'), '', '');
    fillGroupModalTeacherSelect(bv, '');
  });
  $('#groupGradeLevel').addEventListener('change', () => {
    fillSubjectSelect($('#groupSubject'), '', $('#groupGradeLevel').value);
  });

  $('#saveGroupBtn').addEventListener('click', async () => {
    const gradeLevelId = $('#groupGradeLevel').value;
    const gradeLevel = DB.getGradeLevelById(gradeLevelId);
    const subjectId = $('#groupSubject').value;
    const teacherId = $('#groupTeacher').value;
    const dayOfWeek = $('#groupDayOfWeek').value;
    const timeStart = $('#groupTimeStart').value;
    const pricePerSession = $('#groupPricePerSession').value;
    const branchId = $('#groupBranch').value || null;
    const rawPct = $('#groupCenterPercentage').value.trim();
    const pct = rawPct === '' ? 30 : Number(rawPct);

    if (!gradeLevelId || !subjectId || !teacherId) {
      toast('⚠️ من فضلك أكمل اختيار المرحلة والمادة والمدرس', 'error');
      return;
    }
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast('⚠️ نسبة الأكاديمية لازم تكون بين 0 و 100', 'error');
      return;
    }

    const payload = {
      teacherId,
      subjectId,
      gradeLevel: gradeLevel?.name || '',
      gradeLevelId,
      dayOfWeek,
      timeStart,
      pricePerSession,
      centerPercentage: pct,
      branchId,
    };

    let group;
    if (editingGroupId) {
      group = await DB.updateGroup(editingGroupId, payload);
    } else {
      group = await DB.addGroup(payload);
    }

    if (!group) {
      toast('⚠️ تعذر حفظ بيانات المجموعة', 'error');
      return;
    }

    $('#groupModal').classList.add('hidden');
    toast(editingGroupId ? '✅ تم تعديل بيانات المجموعة بنجاح' : '✅ تم إنشاء المجموعة بنجاح', 'success');
    renderGroupsPage();
  });
}

/* ==========================================================================
   Grade Levels & Subjects page (admin)
   ========================================================================== */
function renderGradeLevelsPage() {
  fillBranchFilter($('#gradeLevelsBranchFilter'));
  const branchF = $('#gradeLevelsBranchFilter').value;
  const levels = DB.getGradeLevelRows().filter(l => matchBranch(l, branchF));
  const list = $('#gradeLevelsList');
  list.innerHTML = '';
  $('#gradeLevelsEmpty').classList.toggle('hidden', levels.length > 0);

  levels.forEach(level => {
    const subjects = DB.getSubjectsByGradeLevel(level.id);
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel shine grade-level-card';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">📘</div>
        <div>
          <div class="dir-name">${escapeHtml(level.name)}</div>
          <div class="dir-role">${subjects.length} مادة مرتبطة · 🏢 ${escapeHtml(branchName(level.branch_id))}</div>
        </div>
      </div>
      <div class="subjects-chip-row" id="subjectsRow-${level.id}">
        ${subjects.map(s => `<span class="subject-chip">${escapeHtml(s.name)}<button data-delete-subject="${s.id}" title="حذف المادة">✕</button></span>`).join('') || '<span class="sub">لا توجد مواد بعد</span>'}
      </div>
      <div class="form-row grade-level-add-row">
        <input type="text" class="field" placeholder="اسم مادة جديدة" data-new-subject-name="${level.id}">
        <button class="ghost-btn" data-add-subject="${level.id}">➕ إضافة مادة</button>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn danger" data-delete-grade="${level.id}">🗑️ حذف السنة الدراسية</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-add-subject]').forEach(btn => btn.addEventListener('click', async () => {
    const levelId = btn.dataset.addSubject;
    const input = list.querySelector(`[data-new-subject-name="${levelId}"]`);
    const name = input.value.trim();
    if (!name) { toast('⚠️ أدخل اسم المادة', 'error'); return; }
    const res = await DB.addSubject({ name, gradeLevelId: levelId });
    if (res && res.error) { toast('⚠️ ' + res.error, 'error'); return; }
    toast('✅ تم إضافة المادة', 'success');
    renderGradeLevelsPage();
  }));
  list.querySelectorAll('[data-delete-subject]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف المادة؟', 'سيتم حذف المادة نهائياً.');
    if (ok) { await DB.deleteSubject(btn.dataset.deleteSubject); toast('🗑️ تم حذف المادة'); renderGradeLevelsPage(); }
  }));
  list.querySelectorAll('[data-delete-grade]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف السنة الدراسية؟', 'سيتم حذف السنة الدراسية وكل موادها المرتبطة.');
    if (ok) { await DB.deleteGradeLevel(btn.dataset.deleteGrade); toast('🗑️ تم حذف السنة الدراسية'); renderGradeLevelsPage(); }
  }));
}
function initGradeLevelsPage() {
  $('#addGradeLevelBtn').addEventListener('click', async () => {
    const input = $('#newGradeLevelName');
    const name = input.value.trim();
    if (!name) { toast('⚠️ أدخل اسم السنة الدراسية', 'error'); return; }
    const filterVal = $('#gradeLevelsBranchFilter').value;
    const branchId = filterVal !== 'all' ? filterVal : (DB.getActiveBranchId() || null);
    if (DB.getBranches().length > 1 && !branchId) {
      toast('⚠️ اختر الفرع من القائمة أولاً قبل إضافة السنة الدراسية', 'error');
      return;
    }
    const res = await DB.addGradeLevel({ name, branchId: branchId || (DB.getBranches()[0]?.id ?? null) });
    if (res && res.error) { toast('⚠️ ' + res.error, 'error'); return; }
    input.value = '';
    toast('✅ تم إضافة السنة الدراسية', 'success');
    renderGradeLevelsPage();
  });
}

/* ==========================================================================
   Secretaries management page (admin)
   ========================================================================== */
function renderSecretariesPage() {
  fillBranchFilter($('#secretariesBranchFilter'));
  const branchF = $('#secretariesBranchFilter').value;
  const secretaries = DB.getSecretaries().filter(s => matchBranch(s, branchF));
  const grid = $('#secretariesGrid');
  grid.innerHTML = '';
  $('#secretariesEmpty').classList.toggle('hidden', secretaries.length > 0);

  secretaries.forEach(sec => {
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">${initials(sec.full_name || sec.username)}</div>
        <div>
          <div class="dir-name">${escapeHtml(sec.full_name || sec.username)}</div>
          <div class="dir-role">👤 ${escapeHtml(sec.username)} · ${escapeHtml(sec.phone || '—')}</div>
          <div class="dir-role" style="margin-top:4px;">🏢 ${escapeHtml(branchName(sec.branch_id))}</div>
        </div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-secretary="${sec.id}">✏️ تعديل</button>
        <button class="ghost-btn danger" data-delete-secretary="${sec.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-secretary]').forEach(btn => btn.addEventListener('click', () => openSecretaryModal(btn.dataset.editSecretary)));
  grid.querySelectorAll('[data-delete-secretary]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف حساب السكرتير؟', 'سيتم حذف الحساب نهائياً ولن يستطيع الدخول بعد الآن.');
    if (ok) { await DB.deleteSecretary(btn.dataset.deleteSecretary); toast('🗑️ تم حذف الحساب'); renderSecretariesPage(); }
  }));
}
function openSecretaryModal(secretaryId) {
  editingSecretaryId = secretaryId || null;
  const sec = secretaryId ? DB.getUsers().find(u => String(u.id) === String(secretaryId)) : null;
  $('#secretaryModalTitle').textContent = sec ? '✏️ تعديل حساب سكرتير' : '➕ إضافة سكرتير جديد';
  $('#secretaryName').value = sec?.full_name || '';
  $('#secretaryUsername').value = sec?.username || '';
  $('#secretaryPassword').value = sec?.password_hash || '';
  $('#secretaryPhone').value = sec?.phone || '';
  fillBranchSelect($('#secretaryBranchSelect'), sec?.branch_id);
  $('#secretaryModal').classList.remove('hidden');
}
function initSecretariesPage() {
  $('#addSecretaryBtn').addEventListener('click', () => openSecretaryModal(null));
  $('#secretaryModalClose').addEventListener('click', () => $('#secretaryModal').classList.add('hidden'));
  $('#saveSecretaryBtn').addEventListener('click', async () => {
    const name = $('#secretaryName').value.trim();
    const username = $('#secretaryUsername').value.trim();
    const password = $('#secretaryPassword').value.trim();
    const phone = $('#secretaryPhone').value.trim();
    const branchId = $('#secretaryBranchSelect').value || null;
    if (!name || !username || !password) { toast('⚠️ الاسم واسم المستخدم وكلمة المرور إجبارية', 'error'); return; }
    if (DB.getBranches().length > 0 && !branchId && !DB.getActiveBranchId()) { toast('⚠️ من فضلك اختر الفرع', 'error'); return; }

    let res;
    if (editingSecretaryId) res = await DB.updateSecretary(editingSecretaryId, { username, password, name, phone, branchId });
    else res = await DB.addSecretary({ username, password, name, phone, branchId });
    if (res && res.error) { toast('⚠️ ' + (res.error.message || res.error), 'error'); return; }

    $('#secretaryModal').classList.add('hidden');
    toast('✅ تم حفظ حساب السكرتير', 'success');
    renderSecretariesPage();
    if (currentPage === 'dashboard') renderDashboard();
  });
}

/* ==========================================================================
   Finance page (admin)
   ========================================================================== */
function renderFinanceFilterOptions() {
  fillBranchFilter($('#finBranchFilter'));
  const branchF = $('#finBranchFilter').value || 'all';
  const teacherSel = $('#finTeacherFilter');
  const groupSel = $('#finGroupFilter');
  const curTeacher = teacherSel.value || 'all';
  const curGroup = groupSel.value || 'all';

  teacherSel.innerHTML = '<option value="all">كل المدرسين</option>' +
    DB.getTeachers().filter(t => matchBranch(t, branchF)).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  teacherSel.value = [...teacherSel.options].some(o => o.value === curTeacher) ? curTeacher : 'all';

  let groups = teacherSel.value !== 'all' ? DB.getGroupsByTeacher(teacherSel.value) : DB.getGroups();
  groups = groups.filter(g => matchBranch(g, branchF));
  groupSel.innerHTML = '<option value="all">كل المجموعات</option>' + groups.map(g => {
    const subject = DB.getSubjects().find(s => String(s.id) === String(g.subject_id));
    const label = `${g.grade_level || 'بدون مرحلة'} — ${subject?.name || 'مادة'} — ${g.day_of_week || ''} (${g.time_start ? formatTime12h(g.time_start) : 'بدون موعد'})`;
    return `<option value="${g.id}">${escapeHtml(label)}</option>`;
  }).join('');
  groupSel.value = [...groupSel.options].some(o => o.value === curGroup) ? curGroup : 'all';
}

function renderFinancePage() {
  renderFinanceFilterOptions();
  const fromDate = $('#finFromDate').value || null;
  const toDate = $('#finToDate').value || null;
  const branchId = $('#finBranchFilter').value || 'all';
  const teacherId = $('#finTeacherFilter').value || 'all';
  const groupId = $('#finGroupFilter').value || 'all';
  const debtSearch = ($('#finStudentDebtSearch')?.value || '').trim().toLowerCase();

  const fin = DB.getFinanceSummary(fromDate, toDate, teacherId, groupId, branchId);
  $('#finCollected').textContent = fmt(fin.totalCollected);
  $('#finOutstanding').textContent = fmt(fin.totalOutstanding);
  $('#finCenterProfit').textContent  = fmt(fin.centerProfit);
  $('#finTeacherProfit').textContent = fmt(fin.teacherProfit);

  // 1. مديونية الطلاب مع البحث
  let students = DB.getStudents().filter(s => matchBranch(s, branchId));
  if (debtSearch) {
    students = students.filter(s => String(s.student_code).toLowerCase().includes(debtSearch) || s.name.toLowerCase().includes(debtSearch));
  }
  const sBody = $('#finStudentsBody');
  sBody.innerHTML = students.map(s => `
    <tr><td><b>${escapeHtml(s.name)}</b></td><td>#${escapeHtml(s.student_code)}</td>
    <td>${escapeHtml(branchName(s.branch_id))}</td>
    <td>${escapeHtml(s.grade_level || '—')}</td><td>${debtBadgeHtml(s.total_debt)}</td></tr>
  `).join('') || `<tr><td colspan="5" style="text-align:center;">لا يوجد طلاب مطابقون للبحث</td></tr>`;

  // 2. تحديث التقفيل
  renderTodayGroupsSettlementSelect();
  calculateGroupSettlement();

  // 2.5. جمع مال كل سكرتير + جدول الطباعة اليومية التفصيلي (ليوم معين فقط)
  renderSecretaryTotals();

  // 3. سجل الدفعات التفصيلي
  const ledger = DB.getPaymentLedgerRows(fromDate, toDate, teacherId, groupId, branchId);
  const pBody = $('#paymentsLedgerBody');
  if (pBody) {
    $('#paymentsLedgerEmpty').classList.toggle('hidden', ledger.length > 0);
    pBody.innerHTML = ledger.map(p => `
      <tr>
        <td>${escapeHtml(p.date)}</td>
        <td dir="ltr" style="text-align:right;">${formatTime12h(p.time)}</td>
        <td><b>${escapeHtml(p.studentName)}</b></td>
        <td>#${escapeHtml(p.studentCode)}</td>
        <td><b style="color:var(--success);">${fmt(p.amount)} ج</b></td>
        <td>${fmt(p.centerProfit || 0)} ج</td>
        <td>${fmt(p.teacherProfit || 0)} ج</td>
        <td><span class="role-chip" style="font-size:11px; padding:3px 8px;">${escapeHtml(p.secretaryName || '—')}</span></td>
        <td><span class="approval-status-badge ${p.isApproved ? 'approved' : 'pending'}">${p.isApproved ? '✅ معتمد' : '⏳ قيد الاعتماد'}</span></td>
        <td>${escapeHtml(p.notes || '—')}</td>
      </tr>
    `).join('');
  }

  const teacherLabel = teacherId !== 'all' ? (DB.getTeacherById(teacherId)?.name || '') : 'الكل';
  $('#financePrintHeader').textContent = `التقرير المالي الإجمالي | المدرس: ${teacherLabel} | من ${fromDate || 'البداية'} إلى ${toDate || 'اليوم'}`;
}

// -- حسابات التقفيل اليومي (تقريبي، بيستخدم سعر الحصة كتقدير فقط) --
function renderTodayGroupsSettlementSelect() {
  const sel = $('#sessionSettlementGroupSelect');
  if (!sel) return;
  const currentVal = sel.value;
  const today = DB.getTodayDayName();
  const todayGroups = DB.getGroups().filter(g => g.day_of_week === today);

  sel.innerHTML = '<option value="">— اختر مجموعة اليوم —</option>' + todayGroups.map(g => {
    const teacher = DB.getTeacherById(g.teacher_id);
    return `<option value="${g.id}">${escapeHtml(g.grade_level || 'مجموعة')} — ${teacher ? escapeHtml(teacher.name) : ''}</option>`;
  }).join('');
  if (currentVal) sel.value = currentVal;
}

function calculateGroupSettlement() {
  const groupId = $('#sessionSettlementGroupSelect')?.value;
  if (!groupId) {
    $('#settlePresentCount').textContent = '0';
    $('#settleAbsentCount').textContent = '0';
    $('#settleCashCollected').textContent = '0 ج';
    $('#settleNewDebt').textContent = '0 ج';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const group = DB.getGroupById(groupId);
  const sessionPrice = Number(group?.price_per_session) || 0;

  const records = DB.getDailyRecords().filter(r => String(r.group_id) === String(groupId) && r.session_date === today);

  const presentCount = records.filter(r => r.attendance === 'present').length;
  const absentCount = records.filter(r => r.attendance === 'absent').length;
  const cashCollected = records.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0);

  const expectedTotal = presentCount * sessionPrice;
  const newDebt = Math.max(0, expectedTotal - cashCollected);

  $('#settlePresentCount').textContent = presentCount;
  $('#settleAbsentCount').textContent = absentCount;
  $('#settleCashCollected').textContent = fmt(cashCollected) + ' ج';
  $('#settleNewDebt').textContent = fmt(newDebt) + ' ج';
}

// -- جمع مال كل سكرتير + جدول الطباعة اليومية التفصيلي --
// يعتمد كلاهما على فلتر "يوم معين" (secretaryTotalsDate)، يوم واحد فقط وليس فترة.
function getSelectedSecretaryTotalsDate() {
  return $('#secretaryTotalsDate')?.value || getLocalDate();
}
function renderSecretaryTotals() {
  const dateInput = $('#secretaryTotalsDate');
  if (dateInput && !dateInput.value) dateInput.value = getLocalDate();
  const targetDate = getSelectedSecretaryTotalsDate();

  // 1. جدول جمع مال كل سكرتير
  const totals = DB.getSecretaryTotals(targetDate);
  const body = $('#secretaryTotalsBody');
  if (body) {
    $('#secretaryTotalsEmpty').classList.toggle('hidden', totals.length > 0);
    body.innerHTML = totals.map(t => `
      <tr>
        <td><b>${escapeHtml(t.secretaryName)}</b></td>
        <td>${t.recordsCount}</td>
        <td><b style="color:var(--success);">${fmt(t.totalCollected)} ج</b></td>
        <td>${fmt(t.totalCenterProfit)} ج</td>
        <td>${fmt(t.totalTeacherProfit)} ج</td>
      </tr>
    `).join('');
  }

  // 2. جدول الطباعة اليومية التفصيلي (طالب/مدرس/مجموعة/مرحلة/مادة) — ليوم targetDate فقط
  const printRows = DB.getDailyPrintRows(targetDate);
  const printBody = $('#dailyPrintBody');
  if (printBody) {
    printBody.innerHTML = printRows.map(r => `
      <tr>
        <td><b>${escapeHtml(r.studentName)}</b></td>
        <td>#${escapeHtml(r.studentCode)}</td>
        <td>${escapeHtml(r.teacherName)}</td>
        <td>${escapeHtml(r.gradeLevel)}</td>
        <td>${escapeHtml(r.subjectName)}</td>
        <td>${escapeHtml(r.groupLabel)}</td>
        <td>${escapeHtml(r.attendance)}</td>
        <td>${fmt(r.amountPaid)} ج</td>
        <td>${fmt(r.remaining)} ج</td>
        <td>${escapeHtml(r.secretaryName)}</td>
      </tr>
    `).join('') || `<tr><td colspan="10" style="text-align:center;">لا توجد سجلات في هذا اليوم</td></tr>`;
  }
  const printHeader = $('#dailyPrintHeader');
  if (printHeader) printHeader.textContent = `📋 تفاصيل يوم ${targetDate}`;
}

function initFinanceFilters() {
  $('#finFilterBtn').addEventListener('click', renderFinancePage);
  $('#finTeacherFilter').addEventListener('change', () => { renderFinancePage(); });
  $('#finGroupFilter').addEventListener('change', renderFinancePage);
  $('#finStudentDebtSearch').addEventListener('input', renderFinancePage);
  $('#sessionSettlementGroupSelect').addEventListener('change', calculateGroupSettlement);

  const printAction = () => {
    const now = new Date();
    const header = $('#financePrintHeader');
    const baseText = header.textContent.split(' | وقت الطباعة:')[0];
    header.textContent = `${baseText} | وقت الطباعة: ${now.toLocaleTimeString('ar-EG')}`;

    document.body.classList.add('printing-finance');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-finance'), 1000);
  };

  $('#finPrintBtn').addEventListener('click', printAction);
  $('#printSettlementBtn').addEventListener('click', printAction);

  // فلتر "يوم معين" لجدول جمع مال كل سكرتير + جدول الطباعة اليومية
  $('#secretaryTotalsDate')?.addEventListener('change', renderSecretaryTotals);

  // طباعة تفاصيل اليوم المختار فقط (وليس الفترة كاملة)
  $('#printDailyDetailBtn')?.addEventListener('click', () => {
    renderSecretaryTotals();
    document.body.classList.add('printing-finance', 'printing-daily-detail');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-finance', 'printing-daily-detail'), 1000);
  });
}

/* ==========================================================================
   Master table (admin)
   ========================================================================== */
function renderMasterTable() {
  const fromDate = $('#masterFromDate').value || null;
  const toDate = $('#masterToDate').value || null;
  const studentCodeSearch = ($('#masterStudentSearch')?.value || '').trim().toLowerCase();

  let rows = DB.getMasterTableRows(fromDate, toDate);

  if (studentCodeSearch) {
    rows = rows.filter(r => String(r.studentCode).toLowerCase().includes(studentCodeSearch));
  }

  const body = $('#masterBody');
  $('#masterEmpty').classList.toggle('hidden', rows.length > 0);
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.date)}</td><td>#${escapeHtml(r.studentCode)}</td><td><b>${escapeHtml(r.studentName)}</b></td>
      <td>${escapeHtml(r.branchName)}</td><td>${escapeHtml(r.gradeLevel)}</td><td>${escapeHtml(r.teacherName)}</td>
      <td>${escapeHtml(r.attendance)}</td><td>${fmt(r.amountPaid)}</td>
      <td>${fmt(r.centerProfit)}</td><td>${fmt(r.teacherProfit)}</td>
      <td>${escapeHtml(r.homework)}</td>
      <td>${escapeHtml(r.exam)}</td><td>${escapeHtml(r.notes || '—')}</td><td><span style="direction:ltr; display:inline-block; font-weight:bold; color:${r.totalDebt > 0 ? 'var(--danger)' : r.totalDebt < 0 ? 'var(--success)' : 'inherit'}">${r.totalDebt > 0 ? '-' : r.totalDebt < 0 ? '+' : ''}${fmt(Math.abs(r.totalDebt))}</span></td>
    </tr>
  `).join('');

  if (studentCodeSearch && rows.length > 0) {
    $('#masterPrintHeader').textContent = `اسم الطالب: ${rows[0].studentName} | كود: #${rows[0].studentCode} | الفترة: ${fromDate || 'الكل'} إلى ${toDate || 'الكل'}`;
  } else {
    $('#masterPrintHeader').textContent = `الشيت المجمع الشامل للسنتر`;
  }
}

function initMasterTable() {
  $('#masterFilterBtn').addEventListener('click', renderMasterTable);
  $('#masterStudentSearch').addEventListener('input', renderMasterTable);
  $('#printStudentReportBtn').addEventListener('click', () => {
    if (!$('#masterStudentSearch').value) { toast('⚠️ أدخل كود الطالب أولاً للطباعة', 'error'); return; }
    window.print();
  });
  $('#exportMasterExcelBtn').addEventListener('click', exportMasterExcel);
}

function exportMasterExcel() {
  if (!window.XLSX) { toast('⚠️ مكتبة تصدير Excel لم تُحمَّل بعد', 'error'); return; }
  const fromDate = $('#masterFromDate').value || null;
  const toDate = $('#masterToDate').value || null;
  const rows = DB.getMasterTableRows(fromDate, toDate).map(r => ({
    'التاريخ': r.date, 'كود الطالب': r.studentCode, 'الاسم': r.studentName, 'الفرع': r.branchName, 'الصف': r.gradeLevel,
    'المدرس': r.teacherName, 'الحضور': r.attendance, 'المدفوع': r.amountPaid,
    'ربح الأكاديمية': r.centerProfit, 'مستحق المدرس': r.teacherProfit,
    'الواجب': r.homework, 'الامتحان': r.exam, 'ملاحظات': r.notes, 'المديونية': r.totalDebt > 0 ? -Math.abs(r.totalDebt) : Math.abs(r.totalDebt),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Sheet');
  XLSX.writeFile(wb, `elgazzar-master-sheet.xlsx`);
}

/* ==========================================================================
   Settings page
   ========================================================================== */
function renderSettingsPage() {
  const info = DB.getCenterInfo();
  $('#settingCenterNameAr').value = info.nameAr;
  $('#settingCenterNameEn').value = info.nameEn;
  const status = $('#dbConnectionStatus');
  status.textContent = DB.client ? '✅ متصل بمشروع Supabase (تحقق من صحة الـ URL والمفتاح إن ظهرت أخطاء)' : '⚠️ لم يتم تهيئة الاتصال';
}
function initSettingsPage() {
  $('#saveCenterInfoBtn').addEventListener('click', () => {
    DB.updateCenterInfo({ nameAr: $('#settingCenterNameAr').value.trim(), nameEn: $('#settingCenterNameEn').value.trim() });
    applyCenterBranding();
    toast('✅ تم حفظ بيانات السنتر', 'success');
  });
  $('#settingsThemeBtn').addEventListener('click', toggleTheme);
}

/* ==========================================================================
   Reception (secretary) view
   ========================================================================== */
function renderGroupChips() {
  const gradeSelect = $('#groupChipsSelect');
  const teacherSelect = $('#teacherChipsSelect');
  const branchSelect = $('#receptionBranchFilter');
  if (!gradeSelect || !teacherSelect) return;

  // 0. الفروع
  if (branchSelect) {
    branchSelect.innerHTML = '<option value="all">كل الفروع</option>' +
      DB.getBranches().map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    branchSelect.value = [...branchSelect.options].some(o => o.value === activeBranchFilter) ? activeBranchFilter : 'all';
    activeBranchFilter = branchSelect.value;
  }

  // 1. تعبئة قائمة المراحل الدراسية
  const gradeLevels = [...new Set(DB.getGradeLevels())];
  gradeSelect.innerHTML = '<option value="all">كل المراحل الدراسية</option>' +
    gradeLevels.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  gradeSelect.value = gradeLevels.includes(activeGroupFilter) ? activeGroupFilter : 'all';
  activeGroupFilter = gradeSelect.value;

  if (!gradeSelect.dataset.isInitialized) {
    gradeSelect.addEventListener('change', () => {
      activeGroupFilter = gradeSelect.value;
      flashCardStudentId = null;
      renderStudentsList();
    });
    gradeSelect.dataset.isInitialized = 'true';
  }

  // 2. تعبئة قائمة المدرسين
  const teachers = DB.getTeachers().filter(t => matchBranch(t, activeBranchFilter));
  teacherSelect.innerHTML = '<option value="all">كل المدرسين</option>' +
    teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  teacherSelect.value = [...teacherSelect.options].some(o => o.value === activeTeacherFilter) ? activeTeacherFilter : 'all';
  activeTeacherFilter = teacherSelect.value;

  if (!teacherSelect.dataset.isInitialized) {
    teacherSelect.addEventListener('change', () => {
      activeTeacherFilter = teacherSelect.value;
      flashCardStudentId = null;
      renderStudentsList();
    });
    teacherSelect.dataset.isInitialized = 'true';
  }
}
function groupColor(seedStr) {
  const palette = ['#e8580a', '#c9a227', '#d46e0a', '#b07a1a', '#c84a00', '#a08020'];
  let hash = 0;
  for (const ch of (seedStr || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return palette[hash % palette.length];
}
function statusOf(studentId, groupId) {
  if (DB.getApprovedRecordForStudentToday(studentId, groupId)) return { cls: 'approved', label: 'مُعتمد ✅' };
  if (DB.getPendingRecordForStudentToday(studentId, groupId)) return { cls: 'pending', label: 'بانتظار الاعتماد' };
  return { cls: '', label: 'لم يُسجَّل بعد' };
}
function renderStudentsList(filterOverride) {
  const searchTerm = (filterOverride ?? $('#studentSearch').value ?? '').trim().toLowerCase();
  const list = $('#studentsList');
  let students = DB.getStudents();

  if (flashCardStudentId) {
    // وضع الـ Flash Card (من قارئ الباركود الخارجي) — نعرض كارت هذا الطالب فقط
    const only = DB.getStudentById(flashCardStudentId);
    students = only ? [only] : [];
  } else {
    if (activeBranchFilter !== 'all') students = students.filter(s => matchBranch(s, activeBranchFilter));
    if (activeGroupFilter !== 'all') students = students.filter(s => s.grade_level === activeGroupFilter);

    if (activeTeacherFilter !== 'all') {
      students = students.filter(s => {
        const studentGroups = DB.getGroupsForStudent(s.id);
        return studentGroups.some(g => String(g.teacher_id) === String(activeTeacherFilter));
      });
    }

    if (searchTerm) students = students.filter(s => s.name.toLowerCase().includes(searchTerm) || String(s.student_code).toLowerCase().includes(searchTerm));
  }

  list.innerHTML = '';
  $('#noResults').classList.toggle('hidden', students.length > 0);
  $('#pendingCountSecretary').textContent = DB.getPendingRecords().length;

  const template = $('#studentCardTemplate');
  students.forEach(student => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.student-card');
    card.dataset.id = student.id;
    card.style.setProperty('--group-color', groupColor(student.grade_level));

    node.querySelector('.avatar-orb').textContent = initials(student.name);
    node.querySelector('.s-name').textContent = student.name;
    node.querySelector('.s-id').textContent = student.student_code;
    node.querySelector('.tag-group').textContent = student.grade_level || '—';

    // === 1. حساب عدد المواد ===
    const subjCount = DB.getStudentGroupIds(student.id).length;
    let countText = 'غير مسجل';
    if (subjCount === 1) countText = 'مادة واحدة';
    else if (subjCount === 2) countText = 'مادتين';
    else if (subjCount >= 3 && subjCount <= 10) countText = `${subjCount} مواد`;
    else if (subjCount > 10) countText = `${subjCount} مادة`;
    const countTag = node.querySelector('.tag-subjects-count');
    if (countTag) countTag.textContent = countText;

    // === 2. المديونية وتسديد الدين ===
    const debtBox = node.querySelector('[data-role="debtBox"]');
    const debtAmount = node.querySelector('[data-role="debtAmount"]');
    const payDebtForm = node.querySelector('[data-role="payDebtForm"]');
    const payDebtInput = node.querySelector('[data-field="payDebtAmount"]');
    const payDebtBtn = node.querySelector('[data-action="payDebtQuick"]');
    const debt = Number(student.total_debt) || 0;

    debtAmount.textContent = fmt(debt);

    if (debt <= 0) {
      debtBox.classList.add('zero-debt');
      if (payDebtForm) {
        payDebtForm.style.opacity = '0.4';
        payDebtForm.style.pointerEvents = 'none';
        payDebtForm.style.filter = 'grayscale(100%)';
        if (payDebtInput) payDebtInput.disabled = true;
        if (payDebtBtn) payDebtBtn.disabled = true;
      }
    } else {
      debtBox.classList.remove('zero-debt');
      if (payDebtForm) {
        payDebtForm.style.opacity = '1';
        payDebtForm.style.pointerEvents = 'auto';
        payDebtForm.style.filter = 'none';
        if (payDebtInput) payDebtInput.disabled = false;
        if (payDebtBtn) payDebtBtn.disabled = false;
      }
    }

    // تفصيل المديونية: كل حصة سابقة لم تُدفع بالكامل (تاريخ - مجموعة - متبقي)
    const debtDetailsWrap = node.querySelector('[data-role="debtDetailsWrap"]');
    const debtDetailsBody = node.querySelector('[data-role="debtDetailsBody"]');
    const debtRows = DB.getDebtDetailsForStudent(student.id);
    if (debtRows.length) {
      debtDetailsWrap.classList.remove('hidden');
      debtDetailsBody.innerHTML = debtRows.map(row => `
        <tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.groupLabel)}</td><td>${fmt(row.remaining)} ج</td></tr>
      `).join('');
    } else {
      debtDetailsWrap.classList.add('hidden');
      debtDetailsBody.innerHTML = '';
    }

    node.querySelector('[data-role="todayDayLabel"]').textContent = DB.getTodayDayName();
    const groupSelect = node.querySelector('[data-field="todayGroup"]');
    const noGroupNote = node.querySelector('[data-role="noGroupTodayNote"]');
    noGroupNote.textContent = '⚠️ الطالب غير مسجل بأي مجموعة اليوم';
    const todaysGroups = DB.getGroupsForStudentToday(student.id); // مجموعات اليوم الحالي فقط

    if (todaysGroups.length) {
      groupSelect.innerHTML = todaysGroups.map(g => {
        const teacher = DB.getTeacherById(g.teacher_id);
        const subject = DB.getSubjects().find(s => String(s.id) === String(g.subject_id));
        let label = `${subject?.name || g.grade_level || 'مجموعة'} — ${teacher ? teacher.name : ''}`.trim();
        if (g.day_of_week) label += ` — ${g.day_of_week}`;
        if (g.time_start) label += ` ${formatTime12h(g.time_start)}`;
        return `<option value="${g.id}" data-price="${g.price_per_session || 0}">${escapeHtml(label)}</option>`;
      }).join('');
      groupSelect.disabled = todaysGroups.length === 1;
      noGroupNote.classList.add('hidden');
    } else {
      groupSelect.innerHTML = '<option value="">— لا توجد مجموعة اليوم —</option>';
      groupSelect.disabled = true;
      noGroupNote.classList.remove('hidden');
    }

    const paidInput = node.querySelector('[data-field="paidNow"]');
    const remainingInput = node.querySelector('[data-field="remainingAmount"]');
    const presentCheck = node.querySelector('[data-field="presentCheck"]');
    const saveBtn = node.querySelector('[data-action="save"]');
    const timeChip = node.querySelector('[data-role="timeInChip"]');
    const pill = node.querySelector('[data-role="statusPill"]');
    const lockedBanner = node.querySelector('[data-role="lockedBanner"]');
    const ecCb = node.querySelector('[data-field="exemptCenter"]');
    const etCb = node.querySelector('[data-field="exemptTeacher"]');
    const doubleExemptNote = node.querySelector('[data-role="doubleExemptNote"]');

    // 🎨 تلوين الخانات للفت الانتباه (الدفع أخضر، الدين أحمر)
    paidInput.style.backgroundColor = '#ebfbee';
    paidInput.style.borderColor = '#34ad78';
    paidInput.style.color = '#1f7d55';
    paidInput.style.fontWeight = '900';

    remainingInput.style.backgroundColor = '#fdf3f3';
    remainingInput.style.borderColor = '#d5484a';
    remainingInput.style.color = '#b32d2f';
    remainingInput.style.fontWeight = '900';

    // الإعفاء المزدوج: يعطّل ويصفّر حقل "المبلغ المدفوع" فقط — المتبقي (remainingAmount) مستقل تماماً
    const applyExemptState = () => {
      const isDouble = !!(ecCb?.checked) && !!(etCb?.checked);

      if (isDouble) {
        paidInput.value = '0';
        paidInput.disabled = true;
        if (doubleExemptNote) doubleExemptNote.classList.remove('hidden');
      } else {
        if (doubleExemptNote) doubleExemptNote.classList.add('hidden');
        // فك القفل فقط لو الكارت مش مقفول أصلاً بسبب سجل محفوظ
        if (!paidInput.dataset.lockedByRecord) paidInput.disabled = false;
      }
    };

    // ربط مستمع التغيير على checkboxes الإعفاء مرة واحدة لكل كارت
    [ecCb, etCb].forEach(cb => cb?.addEventListener('change', applyExemptState));

    // دالة تحديث حالة وقفل الكارت بناءً على المجموعة المختارة (القفل لكل طالب + مجموعة + يوم)
    const updateCardState = (groupId) => {
      if (!groupId) {
        pill.textContent = 'لم يُسجَّل بعد';
        pill.className = 'status-chip';
        return;
      }
      const rec = DB.getRecordForStudentToday(student.id, groupId);

      const status = statusOf(student.id, groupId);
      pill.textContent = status.label;
      pill.className = `status-chip ${status.cls}`.trim();

      if (rec) {
        // الحصة متسجلة: عرض البيانات وقفل الخانات والزرار وعلامة الحضور
        paidInput.value = rec.amount_paid ?? 0;
        remainingInput.value = rec.remaining_amount ?? 0;
        presentCheck.checked = rec.attendance === 'present';

        if (ecCb) ecCb.checked = !!(rec.exempt_center);
        if (etCb) etCb.checked = !!(rec.exempt_teacher);
        if (doubleExemptNote) doubleExemptNote.classList.toggle('hidden', !(rec.exempt_center && rec.exempt_teacher));
        paidInput.dataset.lockedByRecord = '1';

        if (rec.time_in && rec.attendance === 'present') {
          timeChip.textContent = `⏱ وقت الحضور: ${formatTime12h(rec.time_in)}`;
          timeChip.classList.add('recorded');
        } else {
          timeChip.textContent = '❌ غائب / مسجل بدون وقت';
          timeChip.classList.remove('recorded');
        }

        paidInput.disabled = true;
        remainingInput.disabled = true;
        presentCheck.disabled = true;
        if (ecCb) ecCb.disabled = true;
        if (etCb) etCb.disabled = true;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span>🔒</span> مقفول — تم حفظ الحصة';
        saveBtn.style.opacity = '0.6';
        if (lockedBanner) lockedBanner.classList.remove('hidden');
      } else {
        // الحصة لسه متسجلتش: فتح كل الخانات وتصفيرها (✅ بما فيها الإعفاءات وشارة القفل)
        paidInput.value = '';
        remainingInput.value = '';
        presentCheck.checked = false;
        if (ecCb) { ecCb.checked = false; ecCb.disabled = false; }
        if (etCb) { etCb.checked = false; etCb.disabled = false; }
        if (doubleExemptNote) doubleExemptNote.classList.add('hidden');
        if (lockedBanner) lockedBanner.classList.add('hidden');

        timeChip.textContent = '⏱ لم يُسجَّل حضور بعد';
        timeChip.classList.remove('recorded');

        delete paidInput.dataset.lockedByRecord;
        paidInput.disabled = false;
        remainingInput.disabled = false;
        presentCheck.disabled = false;
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span>💾</span> حفظ البيانات';
        saveBtn.style.opacity = '1';

        applyExemptState();
      }
    };

    if (todaysGroups.length) {
      updateCardState(groupSelect.value);
      groupSelect.addEventListener('change', () => {
        updateCardState(groupSelect.value);
      });
    } else {
      // مفيش مجموعة اليوم: نقفل الحفظ تماماً
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.6';
    }

    list.appendChild(node);
  });
}

function initStudentsListDelegation() {
  $('#studentsList').addEventListener('click', async (e) => {
    const card = e.target.closest('.student-card');
    if (!card) return;
    const studentId = card.dataset.id;
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;

    if (action === 'save') {
      await saveCardRecord(card, studentId);
    } else if (action === 'payDebtQuick') {
      // ===== تسديد جزء من الدين السابق =====
      const payInput = card.querySelector('[data-field="payDebtAmount"]');
      const payAmount = Number(payInput.value) || 0;

      if (payAmount <= 0) {
        toast('⚠️ أدخل مبلغاً صحيحاً لتسديده', 'error');
        return;
      }

      const currentDebt = Number(DB.getStudentById(studentId)?.total_debt) || 0;
      if (payAmount > currentDebt) {
        toast('⚠️ المبلغ المدخل أكبر من المديونية الحالية! قلل المبلغ.', 'error');
        return;
      }

      const ok = await askConfirm('تأكيد التسديد؟', `هل تريد تسديد مبلغ ${fmt(payAmount)} جنيه من مديونية الطالب السابقة؟`);
      if (!ok) return;

      await DB.adjustStudentDebt(studentId, -payAmount);

      await DB.addPayment({
        studentId: studentId,
        amount: payAmount,
        secretaryId: session?.id || null,
        notes: 'سداد مديونية سابقة من الاستقبال',
      });

      toast(`✅ تم تسديد ${fmt(payAmount)} جنيه من المديونية بنجاح`, 'success');
      payInput.value = '';
      if (currentPage === 'finance') renderFinancePage();
      renderStudentsList();
    }
  });

  $('#studentSearch').addEventListener('input', () => {
    flashCardStudentId = null;
    renderStudentsList();
    $('#clearSearchBtn').classList.toggle('hidden', !$('#studentSearch').value);
  });
  $('#clearSearchBtn').addEventListener('click', () => {
    $('#studentSearch').value = '';
    $('#clearSearchBtn').classList.add('hidden');
    flashCardStudentId = null;
    renderStudentsList();
  });

  /* دعم جهاز الباركود الخارجي: يكتب الكود بسرعة ثم يضغط Enter تلقائياً. */
  $('#studentSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = $('#studentSearch').value.trim();
    if (!code) return;
    const student = DB.getStudentByCode(code) || DB.getStudentById(code);
    if (!student) { toast('⚠️ كود الطالب غير موجود', 'error'); return; }
    flashCardStudentId = student.id;
    renderStudentsList();
    toast(`🔎 تم فتح كارت: ${student.name}`, 'success');
  });
}
/* زر "💾 حفظ البيانات" الموحد — يرسل الحضور (من الـ Checkbox) والدفعة معاً دفعة واحدة
   لتنفيذ UPSERT على المفتاح المركب (student_id, group_id, session_date) داخل db.js */
async function saveCardRecord(card, studentId) {
  const groupId = card.querySelector('[data-field="todayGroup"]').value || null;
  if (!groupId) { toast('⚠️ الطالب غير مسجل بأي مجموعة تُقام اليوم، لا يمكن الحفظ', 'error'); return; }

  const isPresent = card.querySelector('[data-field="presentCheck"]').checked;

  // ⛔ شرط إجباري: منع الحفظ نهائياً إذا لم يضع السكرتير علامة "حاضر"
  if (!isPresent) {
    toast('⛔ لا يمكن الحفظ — يجب وضع علامة ☑️ حاضر أولاً', 'error');
    card.querySelector('.present-toggle')?.classList.add('shake-error');
    setTimeout(() => card.querySelector('.present-toggle')?.classList.remove('shake-error'), 600);
    return;
  }

  // قراءة قيم الإعفاء من الـ Checkboxes
  const exemptCenter  = !!(card.querySelector('[data-field="exemptCenter"]')?.checked);
  const exemptTeacher = !!(card.querySelector('[data-field="exemptTeacher"]')?.checked);
  const isDoubleExempt = exemptCenter && exemptTeacher;

  // الإعفاء المزدوج: المدفوع صفر دايماً — المتبقي يفضل زي ما كُتب
  const paidNow         = isDoubleExempt ? 0 : Math.max(0, Number(card.querySelector('[data-field="paidNow"]').value) || 0);
  const remainingAmount = Math.max(0, Number(card.querySelector('[data-field="remainingAmount"]').value) || 0);
  const paymentStatus   = paidNow > 0 ? 'paid' : 'unpaid';

  const record = await DB.saveRecord({
    studentId,
    groupId,
    attendance: 'present',
    paymentStatus,
    amountPaid: paidNow,
    remainingAmount,
    exemptCenter,
    exemptTeacher,
    secretaryId:   session?.id        || null,
    secretaryName: session?.full_name || 'الاستقبال',
  });
  if (!record || record.message) { toast('⚠️ تعذر حفظ البيانات — تحقق من الاتصال', 'error'); return; }

  toast('✅ تم حفظ البيانات — مغلق بانتظار اعتماد الإدارة', 'success');

  // 🔒 قفل الكارت فوراً بعد الحفظ الناجح
  const lockedBanner = card.querySelector('[data-role="lockedBanner"]');
  if (lockedBanner) lockedBanner.classList.remove('hidden');
  const saveBtn = card.querySelector('[data-action="save"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span>🔒</span> تم الحفظ والتقفيل'; saveBtn.style.opacity = '0.6'; }
  card.querySelectorAll('[data-field="paidNow"],[data-field="remainingAmount"],[data-field="presentCheck"],[data-field="exemptCenter"],[data-field="exemptTeacher"],[data-field="todayGroup"]').forEach(el => { el.disabled = true; });

  refreshSideBadge();
  if (currentPage === 'finance') renderFinancePage();
  setTimeout(() => renderStudentsList(), 800);
}

/* ==========================================================================
   QR flip card: build, render, print
   ========================================================================== */
function buildFlipCardHtml(student) {
  const info = DB.getCenterInfo();
  return `
    <div class="flip-card printable-card" id="flipCard-${student.id}">
      <div class="flip-inner">
        <div class="flip-front">
          <div class="fc-top">
            <span class="fc-brand">${escapeHtml(info.nameEn)}<br>${escapeHtml(info.nameAr)}</span>
            <span class="fc-chip"></span>
          </div>
          <div class="fc-bottom">
            <p class="fc-name">${escapeHtml(student.name)}</p>
            <p class="fc-id">كود الطالب: ${escapeHtml(student.student_code)}</p>
            <p class="fc-group">${escapeHtml(student.grade_level || '')}</p>
          </div>
        </div>
        <div class="flip-back" id="qrHolder-${student.id}"></div>
      </div>
    </div>`;
}
function renderQrIntoHolder(student) {
  const holder = document.getElementById(`qrHolder-${student.id}`);
  if (!holder) return;
  if (window.QRCode) {
    QRCode.toCanvas(document.createElement('canvas'), `STUDENT:${student.student_code}`, { width: 128, margin: 0 }, (err, canvas) => {
      if (!err) holder.appendChild(canvas); else holder.textContent = student.student_code;
    });
  } else {
    holder.textContent = student.student_code;
  }
}
function initFlipCards() {
  document.addEventListener('click', (e) => {
    const flip = e.target.closest('.flip-card');
    if (flip) flip.classList.toggle('flipped');
  });
}
function openQrViewModal(studentId) {
  const student = DB.getStudentById(studentId);
  if (!student) return;
  $('#qrViewCardPreview').innerHTML = buildFlipCardHtml(student);
  renderQrIntoHolder(student);
  $('#qrViewModal').classList.remove('hidden');
}
function openPrintForStudent(studentId) {
  openQrViewModal(studentId);
  const flip = $('#qrViewCardPreview .flip-card');
  if (flip) flip.classList.add('flipped');
  setTimeout(() => window.print(), 300);
}

/* ---------------- Add student flow (cascading selects — 100% dynamic) ---------------- */
function initCascadingStudentSelects() {
  bindEnrollCascade(STUDENT_CASCADE_IDS);
}
function resetCascadingStudentSelects() {
  resetEnrollCascade(STUDENT_CASCADE_IDS);
}
/* عرض سلة (Cart) المواد المُضافة للطالب الجديد قبل الحفظ — تعدد المواد */
function renderAddStudentGroupsCart() {
  const container = $('#newStudentGroupsCart');
  container.innerHTML = addStudentGroupsCart.length
    ? addStudentGroupsCart.map((c, idx) => `<span class="subject-chip">${escapeHtml(c.label)}<button data-remove-cart-idx="${idx}" title="إزالة">✕</button></span>`).join('')
    : '<span class="sub">لم تُضَف أي مادة بعد</span>';
  container.querySelectorAll('[data-remove-cart-idx]').forEach(btn => btn.addEventListener('click', () => {
    addStudentGroupsCart.splice(Number(btn.dataset.removeCartIdx), 1);
    renderAddStudentGroupsCart();
  }));
}
function groupCartLabel(groupId) {
  const group = DB.getGroupById(groupId);
  if (!group) return 'مادة';
  const teacher = DB.getTeacherById(group.teacher_id);
  const subject = DB.getSubjects().find(s => String(s.id) === String(group.subject_id));
  let label = `${subject?.name || group.grade_level || 'مادة'} — ${teacher ? teacher.name : ''}`.trim();
  if (group.day_of_week) label += ` — ${group.day_of_week}`;
  if (group.time_start) label += ` ${formatTime12h(group.time_start)}`;
  return label;
}
function initAddStudentModal() {
  const openBtn = () => {
    resetAddStudentModal();
    resetCascadingStudentSelects();
    addStudentGroupsCart = [];
    renderAddStudentGroupsCart();
    $('#addStudentModal').classList.remove('hidden');
  };
  $('#addStudentBtn')?.addEventListener('click', openBtn);
  $('#addStudentBtn2')?.addEventListener('click', openBtn);
  $('#addStudentModalClose').addEventListener('click', () => $('#addStudentModal').classList.add('hidden'));

  // نظام السلة (Cart)
  $('#addGroupToCartBtn').addEventListener('click', () => {
    const groupId = $('#newStudentGroupSelect').value;
    if (!groupId) { toast('⚠️ من فضلك أكمل اختيار المرحلة/المادة/المدرس/المجموعة أولاً', 'error'); return; }
    if (addStudentGroupsCart.some(c => String(c.groupId) === String(groupId))) { toast('⚠️ تمت إضافة هذه المادة بالفعل', 'error'); return; }
    addStudentGroupsCart.push({ groupId, label: groupCartLabel(groupId) });
    renderAddStudentGroupsCart();
    toast('✅ تمت إضافة المادة للسلة', 'success');
  });

  $('#createStudentBtn').addEventListener('click', async () => {
    const studentCode = $('#newStudentCode').value.trim();
    const name = $('#newStudentName').value.trim();
    const gradeLevelId = $('#newStudentGradeLevel').value;
    const gradeLevel = gradeLevelId ? DB.getGradeLevelById(gradeLevelId)?.name : '';
    const branchId = $('#newStudentBranch').value || null;

    const phone = $('#newStudentPhone').value.trim();
    const parentPhone = $('#newStudentParentPhone').value.trim();
    if (!studentCode || !name) { toast('⚠️ من فضلك أدخل كود الطالب والاسم على الأقل', 'error'); return; }

    if (DB.getStudentByCode(studentCode)) { toast('⚠️ كود الطالب مستخدم بالفعل، اختر كوداً آخر', 'error'); return; }

    // لو الأدمن اختار مجموعة ولم يضغط "إضافة مادة"، نضيفها تلقائياً للسلة كتسهيل
    const lastSelectedGroup = $('#newStudentGroupSelect').value;
    if (lastSelectedGroup && !addStudentGroupsCart.some(c => String(c.groupId) === String(lastSelectedGroup))) {
      addStudentGroupsCart.push({ groupId: lastSelectedGroup, label: groupCartLabel(lastSelectedGroup) });
    }
    const groupIds = addStudentGroupsCart.map(c => c.groupId);

    const student = await DB.addStudent({ studentCode, name, gradeLevel, gradeLevelId: gradeLevelId || null, phone, parentPhone, groupIds, branchId });
    if (student && student.error) { toast('⚠️ تعذر إنشاء الطالب: ' + student.error, 'error'); return; }

    $('#addStudentFormStep').classList.add('hidden');
    $('#addStudentQrStep').classList.remove('hidden');
    $('#qrCardPreview').innerHTML = buildFlipCardHtml(student);
    renderQrIntoHolder(student);
    $('#createStudentBtn').classList.add('hidden');
    $('#printNewQrCardBtn').classList.remove('hidden');
    $('#addAnotherStudentBtn').classList.remove('hidden');

    if (currentPage === 'reception') renderStudentsList();
    if (currentPage === 'students') renderStudentsDirectory();
    toast(`🎉 تم إنشاء الطالب "${student.name}" بالكود ${student.student_code} في ${groupIds.length} مادة`, 'success');
  });

  $('#printNewQrCardBtn').addEventListener('click', () => {
    const flip = $('#qrCardPreview .flip-card');
    if (flip) flip.classList.add('flipped');
    setTimeout(() => window.print(), 250);
  });
  $('#addAnotherStudentBtn').addEventListener('click', () => {
    resetAddStudentModal();
    resetCascadingStudentSelects();
    addStudentGroupsCart = [];
    renderAddStudentGroupsCart();
  });
}
function resetAddStudentModal() {
  $('#newStudentCode').value = '';
  $('#newStudentName').value = '';
  $('#newStudentPhone').value = '';
  $('#newStudentParentPhone').value = '';
  $('#addStudentFormStep').classList.remove('hidden');
  $('#addStudentQrStep').classList.add('hidden');
  $('#createStudentBtn').classList.remove('hidden');
  $('#printNewQrCardBtn').classList.add('hidden');
  $('#addAnotherStudentBtn').classList.add('hidden');
}

/* ---------------- Scanner (auto-detect → instant attendance) ---------------- */
function initScanner() {
  $('#scanQrBtn').addEventListener('click', async () => {
    scannerBusy = false;
    $('#scannerResult').classList.add('hidden');
    $('#scannerModal').classList.remove('hidden');
    if (!window.Html5Qrcode) { toast('⚠️ تعذر تحميل مكتبة المسح، تحقق من الاتصال', 'error'); return; }
    try {
      html5QrInstance = new Html5Qrcode('qrReaderRegion');
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras.length) { toast('⚠️ لم يتم العثور على كاميرا', 'error'); return; }
      await html5QrInstance.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, onScanSuccess, () => {});
    } catch (err) {
      toast('⚠️ تعذر تشغيل الكاميرا — تحقق من الأذونات', 'error');
    }
  });
  $('#scannerModalClose').addEventListener('click', stopScanner);
}
function stopScanner() {
  $('#scannerModal').classList.add('hidden');
  if (html5QrInstance) { html5QrInstance.stop().then(() => html5QrInstance.clear()).catch(() => {}); html5QrInstance = null; }
  scannerBusy = false;
}
async function onScanSuccess(decodedText) {
  if (scannerBusy) return;
  scannerBusy = true;
  const code = decodedText.replace('STUDENT:', '').trim();
  const student = DB.getStudentByCode(code) || DB.getStudentById(code);
  stopScanner();
  if (!student) { toast('⚠️ الكود غير معروف', 'error'); return; }

  $('#studentSearch').value = student.student_code;
  flashCardStudentId = student.id;
  renderStudentsList();
  toast(`🔎 تم فتح كارت: ${student.name}`, 'success');
}

/* ==========================================================================
   Teacher Portal — cascading grade → group → students table
   ========================================================================== */
function renderTeacherPortalRoot() {
  if (!session || session.role !== 'teacher') return;
  const gradeSel = $('#teacherGradeLevelSelect');
  const teacher = DB.getTeacherById(session.teacher_id);
  const myGroups = teacher ? DB.getGroupsByTeacher(teacher.id) : [];
  const grades = [...new Set(myGroups.map(g => g.grade_level).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  gradeSel.innerHTML = '<option value="">— اختر المرحلة —</option>' + grades.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  $('#teacherGroupSelect').innerHTML = '<option value="">— اختر المجموعة —</option>';
  $('#teacherGroupSelect').disabled = true;
  $('#teacherStudentsList').innerHTML = '';
  $('#teacherNoResults').classList.remove('hidden');
  $('#teacherSubmitAllBtn').classList.add('hidden');
}
function initTeacherCascadingSelects() {
  $('#teacherGradeLevelSelect').addEventListener('change', () => {
    const grade = $('#teacherGradeLevelSelect').value;
    const groupSel = $('#teacherGroupSelect');
    groupSel.innerHTML = '<option value="">— اختر المجموعة —</option>';
    groupSel.disabled = !grade;
    $('#teacherStudentsList').innerHTML = '';
    $('#teacherNoResults').classList.remove('hidden');
    $('#teacherSubmitAllBtn').classList.add('hidden');
    if (!grade) return;
    const teacher = DB.getTeacherById(session.teacher_id);
    const groups = DB.getGroupsByTeacher(teacher.id).filter(g => g.grade_level === grade);
    groupSel.innerHTML = '<option value="">— اختر المجموعة —</option>' + groups.map(g => {
      const subject = DB.getSubjects().find(s => String(s.id) === String(g.subject_id));
      return `<option value="${g.id}">${escapeHtml(subject?.name || 'مجموعة')} — ${escapeHtml(g.day_of_week || '')} ${g.time_start ? formatTime12h(g.time_start) : ''}</option>`;
    }).join('');
  });
  $('#teacherGroupSelect').addEventListener('change', () => {
    const groupId = $('#teacherGroupSelect').value;
    $('#teacherStudentSearch').value = '';
    $('#teacherClearSearchBtn').classList.add('hidden');
    if (!groupId) {
      teacherCurrentGroupId = null;
      $('#teacherStudentsList').innerHTML = '';
      $('#teacherNoResults').classList.remove('hidden');
      $('#teacherSubmitAllBtn').classList.add('hidden');
      return;
    }
    renderTeacherStudentsList(groupId);
  });
}
/* بحث داخل المجموعة المعروضة حالياً — بالاسم أو الكود */
function initTeacherSearch() {
  $('#teacherStudentSearch').addEventListener('input', () => {
    $('#teacherClearSearchBtn').classList.toggle('hidden', !$('#teacherStudentSearch').value);
    if (teacherCurrentGroupId) renderTeacherStudentsList(teacherCurrentGroupId);
  });
  $('#teacherClearSearchBtn').addEventListener('click', () => {
    $('#teacherStudentSearch').value = '';
    $('#teacherClearSearchBtn').classList.add('hidden');
    if (teacherCurrentGroupId) renderTeacherStudentsList(teacherCurrentGroupId);
  });
}
function renderTeacherStudentsList(groupId) {
  teacherCurrentGroupId = groupId;
  const list = $('#teacherStudentsList');
  let students = DB.getStudentsByGroup(groupId);
  const searchTerm = ($('#teacherStudentSearch')?.value || '').trim().toLowerCase();
  if (searchTerm) {
    students = students.filter(s => s.name.toLowerCase().includes(searchTerm) || String(s.student_code).toLowerCase().includes(searchTerm));
  }
  list.innerHTML = '';
  $('#teacherNoResults').classList.toggle('hidden', students.length > 0);

  const template = $('#teacherStudentCardTemplate');

  students.forEach(student => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.student-card');
    card.dataset.id = student.id;
    card.dataset.groupId = groupId;
    card.style.setProperty('--group-color', groupColor(student.grade_level));
    node.querySelector('.avatar-orb').textContent = initials(student.name);
    node.querySelector('.s-name').textContent = student.name;
    node.querySelector('.s-id').textContent = student.student_code;
    node.querySelector('.tag-group').textContent = student.grade_level || '—';

    const existing = DB.getPendingRecordForStudentToday(student.id, groupId) || DB.getApprovedRecordForStudentToday(student.id, groupId);

    if (existing) {
      node.querySelector('[data-field="homeworkMax"]').value = existing.homework_out_of ?? 10;
      node.querySelector('[data-field="examMax"]').value = existing.exam_out_of ?? 10;
      node.querySelector('[data-field="homeworkGrade"]').value = existing.homework_grade ?? '';
      node.querySelector('[data-field="examGrade"]').value = existing.exam_grade ?? '';
      node.querySelector('[data-field="notes"]').value = existing.teacher_notes ?? '';

      const isApproved = existing.is_approved;
      const isAbsent = existing.attendance === 'absent';

      // لو السجل تم اعتماده، أو الطالب متسجل غياب، نقفل الكارت
      if (isApproved || isAbsent) {
        const studentForm = node.querySelector('.student-form');
        if (studentForm) studentForm.classList.add('hidden');

        const saveBtn = node.querySelector('[data-action="saveGrades"]');
        if (saveBtn) saveBtn.classList.add('hidden');

        const pill = node.querySelector('[data-role="statusPill"]');
        if (pill) {
          if (isApproved) {
            pill.textContent = '🔒 مُعتمد ومغلق';
            pill.style.background = 'var(--success-bg)';
            pill.style.color = 'var(--success)';
          } else {
            pill.textContent = '❌ غائب ومغلق';
            pill.style.background = 'var(--danger-bg)';
            pill.style.color = 'var(--danger)';
          }
        }
        card.style.opacity = '0.6';
      }
    }
    list.appendChild(node);
  });

  // إخفاء زرار "إرسال التقرير" لو كل الكروت مقفولة
  const openCards = list.querySelectorAll('.student-form:not(.hidden)').length;
  $('#teacherSubmitAllBtn').classList.toggle('hidden', openCards === 0);
}
function initTeacherPortalDelegation() {
  $('#teacherStudentsList').addEventListener('click', async (e) => {
    const card = e.target.closest('.student-card');
    if (!card) return;
    const actionBtn = e.target.closest('[data-action="saveGrades"]');
    if (!actionBtn) return;
    const studentId = card.dataset.id;
    const groupId = card.dataset.groupId;

    const record = await DB.submitTeacherReport(studentId, {
      groupId,
      examGrade: card.querySelector('[data-field="examGrade"]').value || null,
      examOutOf: Number(card.querySelector('[data-field="examMax"]').value) || 10,
      homeworkGrade: card.querySelector('[data-field="homeworkGrade"]').value || null,
      homeworkOutOf: Number(card.querySelector('[data-field="homeworkMax"]').value) || 10,
      notes: card.querySelector('[data-field="notes"]').value,
      teacherName: session?.full_name || 'المدرس',
    });
    if (!record || record.message) { toast('⚠️ تعذر حفظ الدرجات', 'error'); return; }
    toast('✅ تم حفظ الدرجات — بانتظار اعتماد الإدارة', 'success');
    renderTeacherStudentsList(groupId);
    refreshSideBadge();
  });

  $('#teacherSubmitAllBtn').addEventListener('click', async () => {
    const groupId = $('#teacherGroupSelect').value;
    const students = groupId ? DB.getStudentsByGroup(groupId) : [];
    if (!students.length) return;
    const ok = await askConfirm('إرسال التقرير للأدمن؟', `سيتم إرسال تقرير ${students.length} طالب للاعتماد. أي طالب لم يمر على السكرتير سيُسجَّل غائباً تلقائياً.`);
    if (!ok) return;

    // 1. حفظ درجات الطلاب الظاهرين حالياً
    const currentCards = $$('#teacherStudentsList .student-card');
    let failedCount = 0;

    for (const card of currentCards) {
      // حماية الكروت المقفولة (معتمد أو غايب)
      if (card.querySelector('.student-form.hidden')) continue;

      const studentId = card.dataset.id;
      const result = await DB.submitTeacherReport(studentId, {
        groupId,
        examGrade: card.querySelector('[data-field="examGrade"]').value || null,
        examOutOf: Number(card.querySelector('[data-field="examMax"]').value) || 10,
        homeworkGrade: card.querySelector('[data-field="homeworkGrade"]').value || null,
        homeworkOutOf: Number(card.querySelector('[data-field="homeworkMax"]').value) || 10,
        notes: card.querySelector('[data-field="notes"]').value,
        teacherName: session?.full_name || 'المدرس',
      });

      if (!result || result.message) failedCount++;
    }

    // 2. تصفير خانة البحث تلقائياً
    if ($('#teacherStudentSearch').value) {
      $('#teacherStudentSearch').value = '';
      $('#teacherClearSearchBtn').classList.add('hidden');
      renderTeacherStudentsList(groupId);
    }

    // 3. إنهاء التقرير للمجموعة (الغائب الحقيقي فقط هو من يُسجَّل)
    const autoAbsent = await DB.finalizeGroupReport(groupId, session?.full_name || 'المدرس');
    if (failedCount > 0) {
      toast(`⚠️ تم الإرسال ولكن فشل حفظ درجات ${failedCount} طالب (تأكد من اتصالك بالإنترنت)`, 'error');
    } else if (autoAbsent.length) {
      toast(`📤 تم إرسال التقرير — وتسجيل ${autoAbsent.length} طالب غائباً تلقائياً`, 'success');
    } else {
      toast('📤 تم إرسال التقرير الكامل للإدارة', 'success');
    }
    refreshSideBadge();
    renderTeacherPortalRoot();
  });
}

/* ==========================================================================
   Approvals (admin)
   ========================================================================== */
function buildApprovalCard(record) {
  const student = DB.getStudentById(record.student_id);
  const template = $('#approvalCardTemplate');
  const node = template.content.cloneNode(true);
  if (!student) return document.createElement('div');
  node.querySelector('.approval-card').dataset.id = record.id;
  node.querySelector('.avatar-orb').textContent = initials(student.name);
  node.querySelector('.s-name').textContent = student.name;
  node.querySelector('.s-id').textContent = student.student_code;
  node.querySelector('.tag-group').textContent = student.grade_level || '—';
  node.querySelector('[data-role="time"]').textContent = record.time_in ? formatTime12h(record.time_in) : '';

  node.querySelector('[data-role="attendancePill"]').textContent =
    record.attendance === 'present' ? '✅ حاضر' : record.attendance === 'absent' ? '❌ غائب' : '— لم يُسجَّل';
  node.querySelector('[data-role="paymentPill"]').textContent = record.amount_paid ? `💰 دفع (${fmt(record.amount_paid)} ج)` : '💸 لم يدفع';

  const exemptPill = node.querySelector('[data-role="exemptPill"]');
  if (record.exempt_center || record.exempt_teacher) {
    exemptPill.style.display = '';
    exemptPill.textContent = record.exempt_center && record.exempt_teacher ? '🏛️👨‍🏫 إعفاء مزدوج'
      : record.exempt_center ? '🏛️ إعفاء سنتر' : '👨‍🏫 إعفاء معلم';
  }

  node.querySelector('[data-role="homeworkPill"]').textContent = `واجب: ${record.homework_grade ?? '—'}/${record.homework_out_of ?? '—'}`;
  node.querySelector('[data-role="examPill"]').textContent = `امتحان: ${record.exam_grade ?? '—'}/${record.exam_out_of ?? '—'}`;
  node.querySelector('[data-role="notesText"]').textContent = record.teacher_notes || 'لا توجد ملاحظات';
  node.querySelector('[data-role="secretaryName"]').textContent = `بواسطة: ${DB.getRecordSecretaryName(record)}`;
  return node;
}
function renderApprovalsPage() {
  const list = $('#approvalsList');
  list.className = '';

  const today = getLocalDate();
  const allRecords = DB.getDailyRecords();

  // السجلات المعلقة من أي يوم + السجلات المعتمدة من النهاردة فقط
  const pendingRecords  = allRecords.filter(r => !r.is_approved);
  const approvedToday   = allRecords.filter(r => r.is_approved && r.session_date === today);
  const relevantRecords = [...pendingRecords, ...approvedToday];

  $('#noApprovals').classList.toggle('hidden', relevantRecords.length > 0);
  if (relevantRecords.length === 0) {
    list.innerHTML = '';
    refreshSideBadge();
    return;
  }

  // المفتاح = "group_id|session_date" — كل حصة بتاريخها كارت مستقل
  const groupsMap = {};
  relevantRecords.forEach(r => {
    const key = `${r.group_id}|${r.session_date}`;
    if (!groupsMap[key]) {
      groupsMap[key] = { records: [], hasPending: false, groupId: r.group_id, sessionDate: r.session_date };
    }
    groupsMap[key].records.push(r);
    if (!r.is_approved) groupsMap[key].hasPending = true;
  });

  const pendingKeys  = [];
  const approvedKeys = [];
  for (const [key, data] of Object.entries(groupsMap)) {
    // الطلبة المسجلين وقت الحصة فقط (joined_at <= تاريخ الحصة)
    const activeStudents = DB.getStudentsByGroupAtDate(data.groupId, data.sessionDate);
    const hasMissingRecords = data.records.length < activeStudents.length;

    if (data.hasPending || hasMissingRecords) pendingKeys.push(key);
    else approvedKeys.push(key);
  }

  const buildGroupCard = (key, data, isFullyApproved) => {
    const { groupId, sessionDate, records } = data;
    const group = DB.getGroupById(groupId);
    if (!group) return '';

    const teacher    = DB.getTeacherById(group.teacher_id);
    const subject    = DB.getSubjects().find(s => String(s.id) === String(group.subject_id));
    const groupLabel = `${subject?.name || group.grade_level || 'مجموعة'} — ${teacher ? teacher.name : 'بدون مدرس'}`;

    const isToday        = sessionDate === today;
    const dateLabel      = isToday ? 'اليوم' : sessionDate;
    const dateBadgeColor = isToday ? 'var(--ink-soft)' : 'var(--warning)';

    // 1. إجمالي الطلاب المسجلين وقت الحصة (مش المسجلين دلوقتي)
    const studentsInGroup = DB.getStudentsByGroupAtDate(groupId, sessionDate);

    // 2. الحاضرين الفعليين من السجلات
    const presentCount = studentsInGroup.filter(st => {
      const rec = records.find(r => String(r.student_id) === String(st.id));
      return rec && rec.attendance === 'present';
    }).length;

    // 3. الغياب = إجمالي المسجلين وقت الحصة ناقص الحاضرين (حتى لو ملوش سجل)
    const absentCount = studentsInGroup.length - presentCount;

    const totalCollected = records.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0);
    const totalRemaining = records.reduce((sum, r) => sum + (Number(r.remaining_amount) || 0), 0);

    // مال السنتر والمدرس بالمبلغ الفعلي (مجموع center_profit/teacher_profit، بما فيها حالات الإعفاء)
    const totalCenterProfit  = records.reduce((sum, r) => sum + (Number(r.center_profit)  || 0), 0);
    const totalTeacherProfit = records.reduce((sum, r) => sum + (Number(r.teacher_profit) || 0), 0);
    const centerPct  = DB.getCenterPercentage(group);
    const teacherPct = 100 - centerPct;

    // اسم/أسماء السكرتير المسؤول (من جدول users ثم secretary_name)
    const secretaryNames = [...new Set(records.map(r => DB.getRecordSecretaryName(r)).filter(n => n && n !== '—'))];
    const secretaryLabel = secretaryNames.length ? secretaryNames.join('، ') : '—';

    const hasMissingRecords = records.length < studentsInGroup.length;
    const trulyApproved = isFullyApproved && !hasMissingRecords;

    return `
      <div class="dir-card glass-panel tilt shine" style="${trulyApproved ? 'opacity: 0.85; border: 1px solid var(--success);' : ''}">
        <div class="dir-card-head">
          <div class="dir-avatar">🏷️</div>
          <div>
            <div class="dir-name">${escapeHtml(groupLabel)}</div>
            <div class="dir-role">
              📅 <span style="color:${dateBadgeColor}; font-weight:bold;">${escapeHtml(dateLabel)}</span>
              · ⏰ ${group.time_start ? formatTime12h(group.time_start) : '—'}
            </div>
          </div>
        </div>
        <div class="dir-stats-row">
          <div class="dir-stat"><b>${studentsInGroup.length}</b><span>إجمالي الطلاب</span></div>
          <div class="dir-stat"><b>${presentCount}</b><span style="color:var(--success)">حاضر</span></div>
          <div class="dir-stat"><b>${absentCount}</b><span style="color:var(--danger)">غائب</span></div>
        </div>
        <div class="dir-stats-row" style="margin-top:0;">
          <div class="dir-stat" style="background:rgba(31,157,99,0.1);"><b>${fmt(totalCollected)} ج</b><span style="color:var(--success)">تم تحصيله</span></div>
          <div class="dir-stat" style="background:rgba(213,72,74,0.1);"><b>${fmt(totalRemaining)} ج</b><span style="color:var(--danger)">متبقي (دين)</span></div>
        </div>
        <div class="dir-stats-row" style="margin-top:0;">
          <div class="dir-stat" style="background:rgba(200,162,40,0.10);"><b>${fmt(totalCenterProfit)} ج</b><span>🏛️ السنتر (${centerPct}%)</span></div>
          <div class="dir-stat" style="background:rgba(63,111,176,0.10);"><b>${fmt(totalTeacherProfit)} ج</b><span>👨‍🏫 المدرس (${teacherPct}%)</span></div>
        </div>
        <div class="dir-role" style="margin-top:8px;">🗂️ السكرتير المسؤول: <b>${escapeHtml(secretaryLabel)}</b></div>
        <div class="dir-actions">
          <button class="ghost-btn"
            data-open-group-approvals="${groupId}"
            data-session-date="${sessionDate}">⚙️ تفاصيل وتعديل</button>
          ${!trulyApproved
            ? (session && session.role === 'admin'
                ? `<button class="primary-btn"
                    data-approve-group="${groupId}"
                    data-session-date="${sessionDate}">✅ اعتماد الحصة</button>`
                : `<button class="ghost-btn" style="opacity:0.5; pointer-events:none;" title="فقط المدير يمكنه الاعتماد">🔒 انتظار الإدارة</button>`)
            : `<button class="ghost-btn" style="color:var(--success); border-color:var(--success); pointer-events:none;">✅ تم الاعتماد</button>`}
        </div>
      </div>
    `;
  };

  let html = '';

  // المعلقة أولاً مرتبة من الأقدم للأحدث
  pendingKeys.sort((a, b) => groupsMap[a].sessionDate.localeCompare(groupsMap[b].sessionDate));

  if (pendingKeys.length > 0) {
    html += `<div style="margin-bottom: 16px;"><h3 style="font-weight: 900; color: var(--warning);">⏳ حصص قيد الاعتماد</h3></div>`;
    html += `<div class="approvals-grid" style="margin-bottom: 30px;">`;
    pendingKeys.forEach(key => html += buildGroupCard(key, groupsMap[key], false));
    html += `</div>`;
  }

  if (approvedKeys.length > 0) {
    if (pendingKeys.length > 0) {
      html += `<hr style="margin: 20px 0; border: none; border-top: 2px dashed var(--panel-border);">`;
    }
    html += `<div style="margin-bottom: 16px;"><h3 style="font-weight: 900; color: var(--success);">✅ حصص تم اعتمادها اليوم</h3></div>`;
    html += `<div class="approvals-grid">`;
    approvedKeys.forEach(key => html += buildGroupCard(key, groupsMap[key], true));
    html += `</div>`;
  }

  list.innerHTML = html;
  refreshSideBadge();
}
function initApprovalsActions() {
  $('#approvalsList').addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-approve-group], [data-open-group-approvals]');
    if (!actionBtn) return;

    const groupId     = actionBtn.dataset.approveGroup || actionBtn.dataset.openGroupApprovals;
    const sessionDate = actionBtn.dataset.sessionDate || getLocalDate();

    if (actionBtn.dataset.approveGroup) {
      const ok = await askConfirm(
        'اعتماد وتقفيل الحصة؟',
        `سيتم اعتماد حصة ${sessionDate}. أي طالب لم يُسجَّل سيُضاف كغائب تلقائياً (بدون مديونية).`
      );
      if (!ok) return;

      // الطلاب المسجلين وقت الحصة دي بس
      const students = DB.getStudentsByGroupAtDate(groupId, sessionDate);

      for (const student of students) {
        const record = DB.cache.dailyRecords.find(
          r => String(r.student_id) === String(student.id) && String(r.group_id) === String(groupId) && r.session_date === sessionDate
        );

        if (!record) {
          // الطالب ملوش سجل -> غياب أوتوماتيك
          const newRec = await DB.saveRecord({
            studentId: student.id, groupId, sessionDate, attendance: 'absent', paymentStatus: 'unpaid', amountPaid: 0, secretaryName: session?.full_name || 'الإدارة (تقفيل تلقائي)',
          });
          if (newRec && !newRec.message) await DB.approveRecord(newRec.id, session?.id);
        } else if (!record.is_approved) {
          await DB.approveRecord(record.id, session?.id);
        }
      }

      toast('✅ تم تقفيل الحصة واعتمادها بنجاح', 'success');
      renderPage(currentPage);
    }
    else if (actionBtn.dataset.openGroupApprovals) {
      openGroupDetailsModal(groupId, sessionDate);
    }
  });

  // أزرار "اعتماد / تعديل" على كروت لوحة التحكم (سجل فردي)
  $('#dashPendingPreview').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    const card = e.target.closest('.approval-card');
    if (!btn || !card) return;
    const rec = DB.getDailyRecords().find(r => String(r.id) === String(card.dataset.id));
    if (!rec) return;

    if (btn.dataset.action === 'approve') {
      if (!session || session.role !== 'admin') { toast('🔒 فقط المدير يمكنه الاعتماد', 'error'); return; }
      await DB.approveRecord(rec.id, session.id);
      toast('✅ تم اعتماد السجل', 'success');
      renderDashboard();
    } else if (btn.dataset.action === 'edit') {
      openGroupDetailsModal(rec.group_id, rec.session_date);
    }
  });
}
// sessionDate اختياري — لو مش موجود يُستخدم تاريخ اليوم
function openGroupDetailsModal(groupId, sessionDate) {
  const targetDate = sessionDate || getLocalDate();
  const group    = DB.getGroupById(groupId);

  // الطلاب اللي كانوا في المجموعة وقت الحصة دي بس
  const students = DB.getStudentsByGroupAtDate(groupId, targetDate);

  const oldModal = document.getElementById('dynamicGroupModal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.id = 'dynamicGroupModal';
  modal.className = 'modal-overlay';
  modal.style.zIndex = '1000';

  const today       = getLocalDate();
  const isToday     = targetDate === today;
  const dateDisplay = isToday ? 'اليوم' : targetDate;

  let html = `
    <div class="glass-panel" style="width: 95%; max-width: 900px; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="panel-header">
        <h2>📝 كشف حصة: ${escapeHtml(group?.grade_level || 'مجموعة')} — ${escapeHtml(dateDisplay)}</h2>
        <button class="x-btn" onclick="document.getElementById('dynamicGroupModal').remove(); renderPage(currentPage);">✕</button>
      </div>
      <div class="panel-body" style="overflow-y: auto; flex: 1; padding: 20px; background: var(--bg-page);">
  `;

  if (students.length === 0) {
    html += `<div class="empty-state">لا يوجد طلاب مسجلين في هذه المجموعة</div>`;
  } else {
    html += `<div style="display: flex; flex-direction: column; gap: 16px;">`;

    students.forEach(student => {
      const record = DB.cache.dailyRecords.find(
        r => String(r.student_id) === String(student.id) &&
             String(r.group_id)   === String(groupId) &&
             r.session_date       === targetDate
      ) || null;

      const isApproved   = record && record.is_approved;
      const attendance   = record ? record.attendance : 'absent';
      const amountPaid   = record ? (record.amount_paid || 0) : 0;
      const exGrade      = (record && record.exam_grade !== null) ? record.exam_grade : '';
      const hwGrade      = (record && record.homework_grade !== null) ? record.homework_grade : '';
      const teacherNotes = record ? (record.teacher_notes || '') : '';
      const recordId     = record ? record.id : `new-${student.id}-${targetDate}`;

      html += `
        <div class="dir-card glass-panel" id="grp-rec-${recordId}" style="padding: 16px; ${isApproved ? 'opacity: 0.6; border: 1px solid var(--success);' : ''}">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="font-weight: 900; font-size: 16px;">
              <span id="st-name-${student.id}">${escapeHtml(student.name)}</span>
              <span style="color:var(--ink-faint); font-size: 14px;">(#${escapeHtml(student.student_code)})</span>
              ${isApproved ? '<span class="status-chip approved" style="margin-right:10px;">✅ معتمد</span>' : ''}
              ${!record ? '<span class="status-chip" style="margin-right:10px; background:var(--warning-bg); color:var(--warning);">⚠️ لم يُسجَّل في هذه الحصة</span>' : ''}
            </div>
            <div id="action-btns-${recordId}" style="display:flex; gap: 8px; flex-wrap: wrap;">
              ${!record ? `
              <button class="primary-btn" style="padding: 8px 16px; background: linear-gradient(160deg, #f39c12, #d35400);"
                onclick="window.quickCreateAbsence('${recordId}', '${student.id}', '${groupId}', '${targetDate}')">💾 إنشاء سجل غياب</button>
              ` : (!isApproved ? `
              <button class="ghost-btn" style="padding: 8px 16px;"
                onclick="window.quickSave('${recordId}', '${student.id}', '${groupId}', '${targetDate}')">💾 حفظ</button>
              <button class="primary-btn" style="padding: 8px 16px; background: linear-gradient(160deg, #34ad78, #1f7d55);"
                onclick="window.quickApprove('${recordId}', '${student.id}', '${groupId}', '${targetDate}')">✅ اعتماد</button>
              ` : '')}

              ${record ? `
              <button class="ghost-btn danger" style="padding: 8px 16px; border-color: var(--danger); color: var(--danger);"
                onclick="window.quickDelete('${record.id}', 'grp-rec-${recordId}')">🗑️ حذف السجل</button>
              ` : ''}
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px;">
            <div class="form-group" style="margin:0;">
              <label>حالة الحضور</label>
              <select class="field" id="att-${recordId}" ${isApproved ? 'disabled' : ''}>
                <option value="present" ${attendance === 'present' ? 'selected' : ''}>✅ حاضر</option>
                <option value="absent"  ${attendance !== 'present' ? 'selected' : ''}>❌ غائب</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label>المدفوع (ج)</label>
              <input type="text" inputmode="numeric" class="field" id="paid-${recordId}" value="${amountPaid}" placeholder="0" ${isApproved ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin:0;">
              <label>المتبقي (دين)</label>
              <input type="text" inputmode="numeric" class="field" id="rm-${recordId}" value="${record ? (record.remaining_amount || 0) : 0}" placeholder="0" ${isApproved ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin:0;">
              <label>الامتحان</label>
              <input type="text" inputmode="numeric" class="field" id="ex-${recordId}" value="${exGrade}" placeholder="الدرجة" ${isApproved ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin:0;">
              <label>الواجب</label>
              <input type="text" inputmode="numeric" class="field" id="hw-${recordId}" value="${hwGrade}" placeholder="الدرجة" ${isApproved ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin:0; grid-column: 1 / -1;">
              <label>ملاحظات</label>
              <input type="text" class="field" id="nt-${recordId}" value="${escapeHtml(teacherNotes)}" placeholder="لا توجد ملاحظات" ${isApproved ? 'disabled' : ''}>
            </div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  html += `</div></div>`;
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
// sessionDate اختياري — لو مش موجود يُستخدم تاريخ اليوم
window.quickSave = async function(recordId, studentId, groupId, sessionDate) {
  const targetDate = sessionDate || getLocalDate();

  const att     = document.getElementById('att-'  + recordId).value;
  const paidVal = document.getElementById('paid-' + recordId).value;
  const rmEl    = document.getElementById('rm-'   + recordId);
  const rmVal   = rmEl ? rmEl.value : 0;
  const ex      = document.getElementById('ex-'   + recordId).value;
  const hw      = document.getElementById('hw-'   + recordId).value;
  const nt      = document.getElementById('nt-'   + recordId).value;

  let finalRecordId     = recordId;
  const amountPaid      = paidVal !== '' ? Number(paidVal) : 0;
  const remainingAmount = rmVal   !== '' ? Number(rmVal)   : 0;
  const paymentStatus   = amountPaid > 0 ? 'paid' : 'unpaid';

  if (recordId.startsWith('new-')) {
    const rec = await DB.saveRecord({
      studentId, groupId, sessionDate: targetDate,
      attendance: att, paymentStatus,
      amountPaid, remainingAmount,
      examGrade: ex !== '' ? Number(ex) : null,
      homeworkGrade: hw !== '' ? Number(hw) : null,
      teacherNotes: nt,
      secretaryName: session?.full_name || 'الإدارة',
    });

    if (rec && !rec.message) {
      finalRecordId = rec.id;
      const card = document.getElementById('grp-rec-' + recordId);
      if (card) {
        card.id = 'grp-rec-' + finalRecordId;
        document.getElementById('att-'  + recordId).id = 'att-'  + finalRecordId;
        document.getElementById('paid-' + recordId).id = 'paid-' + finalRecordId;
        if (rmEl) rmEl.id = 'rm-' + finalRecordId;
        document.getElementById('ex-' + recordId).id = 'ex-' + finalRecordId;
        document.getElementById('hw-' + recordId).id = 'hw-' + finalRecordId;
        document.getElementById('nt-' + recordId).id = 'nt-' + finalRecordId;

        const saveBtn = card.querySelector('.ghost-btn');
        const appBtn  = card.querySelector('.primary-btn');
        if (saveBtn) saveBtn.setAttribute('onclick', `window.quickSave('${finalRecordId}', '${studentId}', '${groupId}', '${targetDate}')`);
        if (appBtn)  appBtn.setAttribute('onclick',  `window.quickApprove('${finalRecordId}', '${studentId}', '${groupId}', '${targetDate}')`);

        const warningBadge = card.querySelector('span[style*="var(--warning)"]');
        if (warningBadge) warningBadge.remove();
      }
    } else {
      toast('⚠️ تعذر حفظ السجل', 'error');
      return null;
    }
  } else {
    const upd = await DB.updateRecord(finalRecordId, {
      attendance: att, amountPaid, remainingAmount,
      paymentStatus,
      examGrade: ex !== '' ? Number(ex) : null,
      homeworkGrade: hw !== '' ? Number(hw) : null,
      teacherNotes: nt,
    });
    if (!upd || upd.message) { toast('⚠️ تعذر حفظ التعديلات', 'error'); return null; }
  }

  toast('✅ تم حفظ التعديلات بنجاح', 'success');
  return finalRecordId;
};

window.quickCreateAbsence = async function(recordId, studentId, groupId, sessionDate) {
  const targetDate = sessionDate || getLocalDate();

  // 1. تعيين حالة الغياب وتصفير المبالغ في الواجهة
  document.getElementById('att-' + recordId).value = 'absent';
  document.getElementById('paid-' + recordId).value = '0';
  if (document.getElementById('rm-' + recordId)) {
    document.getElementById('rm-' + recordId).value = '0';
  }

  // الاحتفاظ بحاوية الأزرار قبل تغير الـ ID
  const btnContainer = document.getElementById('action-btns-' + recordId);

  // 2. استدعاء دالة الحفظ لإنشاء الريكورد في قاعدة البيانات
  const finalRecordId = await window.quickSave(recordId, studentId, groupId, targetDate);

  // 3. قلب الأزرار للوضع الطبيعي إذا نجح الحفظ
  if (finalRecordId && btnContainer) {
    btnContainer.id = 'action-btns-' + finalRecordId;
    btnContainer.innerHTML = `
      <button class="ghost-btn" style="padding: 8px 16px;"
        onclick="window.quickSave('${finalRecordId}', '${studentId}', '${groupId}', '${targetDate}')">💾 حفظ</button>
      <button class="primary-btn" style="padding: 8px 16px; background: linear-gradient(160deg, #34ad78, #1f7d55);"
        onclick="window.quickApprove('${finalRecordId}', '${studentId}', '${groupId}', '${targetDate}')">✅ اعتماد</button>
      <button class="ghost-btn danger" style="padding: 8px 16px; border-color: var(--danger); color: var(--danger);"
        onclick="window.quickDelete('${finalRecordId}', 'grp-rec-${finalRecordId}')">🗑️ حذف السجل</button>
    `;
  }
};
window.quickApprove = async function(recordId, studentId, groupId, sessionDate) {
  const finalRecordId = await window.quickSave(recordId, studentId, groupId, sessionDate);
  if (finalRecordId) {
    await DB.approveRecord(finalRecordId, session?.id);
    toast('✅ تم اعتماد الطالب', 'success');
    const card = document.getElementById('grp-rec-' + finalRecordId);
    if (card) {
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
      setTimeout(() => card.remove(), 400);
    }
  }
};

window.quickDelete = async function(dbRecordId, cardElementId) {
  const ok = await askConfirm('حذف السجل نهائياً؟', 'هل أنت متأكد من حذف هذا السجل؟ (سيتم تسوية الفلوس والمديونيات المرتبطة به تلقائياً)');
  if (!ok) return;

  await DB.deleteRecord(dbRecordId);
  toast('🗑️ تم حذف السجل وتسوية الحسابات', 'success');

  const card = document.getElementById(cardElementId);
  if (card) {
    card.style.opacity = '0.3';
    card.style.pointerEvents = 'none';
    setTimeout(() => card.remove(), 400);
  }
};

/* ==========================================================================
   Global wiring
   ========================================================================== */
function initGlobalUi() {
  // تحويل الأرقام العربية إلى إنجليزية تلقائياً في أي خانة أرقام
  document.addEventListener('input', function (e) {
    if (e.target.inputMode === 'numeric' || e.target.type === 'number') {
      const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
      let value = e.target.value;
      for (let i = 0; i < 10; i++) {
        const regex = new RegExp(arabicDigits[i], 'g');
        value = value.replace(regex, i);
      }
      e.target.value = value;
    }
  });
  // التحديث التلقائي للواجهة لما يجي إشعار من قاعدة البيانات
  window.addEventListener('db_updated', () => {
    if (session && typeof renderPage === 'function' && currentPage) {
      renderPage(currentPage);
      refreshSideBadge();
    }
  });
  $('#themeToggleBtn').addEventListener('click', toggleTheme);
  $('#logoutBtn').addEventListener('click', logout);
  $('#qrViewModalClose').addEventListener('click', () => $('#qrViewModal').classList.add('hidden'));
  $('#printQrViewBtn').addEventListener('click', () => {
    const flip = $('#qrViewCardPreview .flip-card');
    if (flip) flip.classList.add('flipped');
    setTimeout(() => window.print(), 250);
  });
  $('#confirmCancelBtn').addEventListener('click', () => closeConfirm(false));
  $('#confirmOkBtn').addEventListener('click', () => closeConfirm(true));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-overlay:not(.hidden)').forEach(m => { if (m.id !== 'loginModal') m.classList.add('hidden'); });
      if (html5QrInstance) stopScanner();
    }
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  DB.loadCenterInfoLocal();
  DB.loadActiveBranchLocal();
  initTheme();
  applyCenterBranding();
  initTilt();
  initFlipCards();
  initLogin();
  initSidebar();
  initGlobalUi();
  initPageFilters();
  initBranchesPage();
  initStudentsListDelegation();
  initStudentsDirectoryFilters();
  initStudentFinanceModal();
  initSfEnrollCascadingSelects();
  initTeacherModal();
  initGroupModal();
  initGradeLevelsPage();
  initSecretariesPage();
  initFinanceFilters();
  initMasterTable();
  initSettingsPage();
  initTeacherPortalDelegation();
  initTeacherCascadingSelects();
  initTeacherSearch();
  initCascadingStudentSelects();
  initAddStudentModal();
  initScanner();
  initApprovalsActions();
  loadLoginBranches();

  // حفظ الجلسة عند الـ Refresh: لو فيه جلسة محفوظة في localStorage، ندخل مباشرة
  try {
    const savedSession = localStorage.getItem('elgazzar_session');
    if (savedSession) {
      session = JSON.parse(savedSession);
      enterApp();
    }
  } catch (err) {
    console.error('[Session] تعذّرت قراءة الجلسة المحفوظة:', err);
    localStorage.removeItem('elgazzar_session');
  }

  setTimeout(() => {
    $('#splashScreen').classList.add('fade-out');
    setTimeout(() => $('#splashScreen').remove(), 650);
  }, 1000);
});
// تسجيل الـ Service Worker وإظهار نافذة التثبيت أوتوماتيكياً
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed:', err));
  });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  toast('📱 اضغط هنا لإضافة التطبيق للشاشة الرئيسية!', 'info');
  setTimeout(() => {
    if (deferredPrompt) deferredPrompt.prompt();
  }, 1500);
});
window.quickEditStudentName = async function(studentId) {
  const student = DB.getStudentById(studentId);
  if(!student) return;
  const newName = prompt('تعديل اسم الطالب:', student.name);
  if (newName && newName.trim() !== '' && newName !== student.name) {
    await DB.updateStudent(studentId, { name: newName.trim() });
    toast('✅ تم تعديل اسم الطالب بنجاح', 'success');
    const nameSpan = document.getElementById('st-name-' + studentId);
    if(nameSpan) nameSpan.textContent = newName.trim();
  }
};
