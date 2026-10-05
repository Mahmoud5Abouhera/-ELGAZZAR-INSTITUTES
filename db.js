/* ==========================================================================
   db.js — ELGAZZAR INSTITUTES | أكاديمية الجزار — طبقة البيانات (Supabase)
   كل الدوال Async وتتصل مباشرة بـ Supabase (PostgreSQL).
   الجداول: branches, users, grade_levels, subjects, teachers, groups,
            students, student_groups, daily_records, student_payments, expenses
   ========================================================================== */

const SUPABASE_URL      = 'https://cwcfgcvrojvlrnmmjdao.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3Y2ZnY3Zyb2p2bHJubW1qZGFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5OTg0MjEsImV4cCI6MjEwNjU3NDQyMX0.0lDG-tHZogdbb3AlC_wLPMocyglhqal1IXcqD_HFCO8';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DB = (() => {

  /* ========== Helpers ========== */

  function getTodayDateString() {
    const now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  function getCurrentTimeString() {
    return new Date().toTimeString().slice(0, 8);
  }

  const ARABIC_DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function getTodayArabicDayName() {
    return ARABIC_DAY_NAMES[new Date().getDay()];
  }

  function getDateThirtyDaysAgo() {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date;
  }

  function formatTime12(timeStr) {
    if (!timeStr) return '';
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const ampm = h >= 12 ? 'م' : 'ص';
    h = h % 12; if (!h) h = 12;
    return `${h}:${parts[1]} ${ampm}`;
  }

  /** نسبة السنتر للمجموعة — القيمة 0 مسموحة (لا تتحول لـ 30) */
  function centerPctOf(group) {
    const v = group?.center_percentage;
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return 30;
    return Number(v);
  }

  function logSupabaseError(operationName, error) {
    if (error) {
      console.error(`[Supabase:${operationName}] فشلت العملية ⚠️`, {
        message: error.message || null,
        details: error.details || null,
        hint:    error.hint    || null,
        code:    error.code    || null,
        raw:     error,
      });
    }
    return error;
  }

  let realtimeStarted = false;

  /* ========== In-Memory Cache ========== */
  const cache = {
    centerInfo:      { nameAr: 'أكاديمية الجزار', nameEn: 'ELGAZZAR INSTITUTES', tagline: 'نظام الإدارة المتكامل' },
    activeBranchId:  null,
    branches:        [],
    users:           [],
    gradeLevels:     [],
    subjects:        [],
    teachers:        [],
    groups:          [],
    students:        [],
    studentGroups:   [],
    dailyRecords:    [],
    studentPayments: [],
    expenses:        [],
  };

  /* ========== Bootstrap ========== */

  async function refreshAll() {
    await Promise.all([
      refreshBranches(),
      refreshUsers(),
      refreshGradeLevels(),
      refreshSubjects(),
      refreshTeachers(),
      refreshGroups(),
      refreshStudents(),
      refreshStudentGroups(),
      refreshDailyRecords(),
      refreshStudentPayments(),
    ]);
  }

  async function refreshBranches() {
    const { data, error } = await supabaseClient.from('branches').select('*').order('id');
    if (error) return logSupabaseError('refreshBranches', error);
    cache.branches = data || [];
  }

  async function refreshUsers() {
    const { data, error } = await supabaseClient.from('users').select('*');
    if (error) return logSupabaseError('refreshUsers', error);
    cache.users = data || [];
  }

  async function refreshGradeLevels() {
    let query = supabaseClient.from('grade_levels').select('*').order('created_at', { ascending: true });
    if (cache.activeBranchId) query = query.eq('branch_id', cache.activeBranchId);
    const { data, error } = await query;
    if (error) return logSupabaseError('refreshGradeLevels', error);
    cache.gradeLevels = data || [];
  }

  async function refreshSubjects() {
    const { data, error } = await supabaseClient.from('subjects').select('*');
    if (error) return logSupabaseError('refreshSubjects', error);
    cache.subjects = data || [];
  }

  async function refreshTeachers() {
    let query = supabaseClient.from('teachers').select('*');
    if (cache.activeBranchId) query = query.eq('branch_id', cache.activeBranchId);
    const { data, error } = await query;
    if (error) return logSupabaseError('refreshTeachers', error);
    cache.teachers = data || [];
  }

  async function refreshGroups() {
    let query = supabaseClient.from('groups').select('*');
    if (cache.activeBranchId) query = query.eq('branch_id', cache.activeBranchId);
    const { data, error } = await query;
    if (error) return logSupabaseError('refreshGroups', error);
    cache.groups = data || [];
  }

  async function refreshStudents() {
    let query = supabaseClient.from('students').select('*');
    if (cache.activeBranchId) query = query.eq('branch_id', cache.activeBranchId);
    const { data, error } = await query;
    if (error) return logSupabaseError('refreshStudents', error);
    cache.students = data || [];
  }

  async function refreshStudentGroups() {
    const { data, error } = await supabaseClient.from('student_groups').select('*');
    if (error) return logSupabaseError('refreshStudentGroups', error);
    cache.studentGroups = data || [];
  }

  async function refreshDailyRecords() {
    const cutoffDate = getDateThirtyDaysAgo().toISOString().slice(0, 10);
    const { data, error } = await supabaseClient
      .from('daily_records')
      .select('*')
      .gte('session_date', cutoffDate)
      .order('session_date', { ascending: false });
    if (error) return logSupabaseError('refreshDailyRecords', error);
    cache.dailyRecords = data || [];
  }

  async function refreshStudentPayments() {
    const cutoffDate = getDateThirtyDaysAgo().toISOString();
    const { data, error } = await supabaseClient
      .from('student_payments')
      .select('*')
      .gte('payment_date', cutoffDate)
      .order('payment_date', { ascending: false });
    if (error) { cache.studentPayments = []; return; }
    cache.studentPayments = data || [];
  }

  /* ========================================================================
     Public API
  ======================================================================== */
  return {
    client: supabaseClient,
    cache,
    refreshAll,
    refreshBranches, refreshUsers, refreshGradeLevels, refreshSubjects,
    refreshTeachers, refreshGroups, refreshStudents, refreshStudentGroups,
    refreshDailyRecords, refreshStudentPayments,

    /* ------------------------------------------------------------------
       بيانات الأكاديمية
    ------------------------------------------------------------------ */
    getCenterInfo() {
      return { ...cache.centerInfo };
    },
    updateCenterInfo(newInfo) {
      cache.centerInfo = { ...cache.centerInfo, ...newInfo };
      localStorage.setItem('gz_center_info', JSON.stringify(cache.centerInfo));
      return cache.centerInfo;
    },
    loadCenterInfoLocal() {
      try {
        const savedJson = localStorage.getItem('gz_center_info');
        if (savedJson) cache.centerInfo = { ...cache.centerInfo, ...JSON.parse(savedJson) };
      } catch (e) { /* تجاهل */ }
    },

    /** نسبة السنتر الفعلية للمجموعة (0 مسموحة، الافتراضي 30) */
    getCenterPercentage(group) { return centerPctOf(group); },

    /* ------------------------------------------------------------------
       الفرع النشط
    ------------------------------------------------------------------ */
    setActiveBranch(branchId) {
      cache.activeBranchId = branchId || null;
      localStorage.setItem('gz_active_branch', String(branchId || ''));
    },
    loadActiveBranchLocal() {
      try {
        const savedBranchId = localStorage.getItem('gz_active_branch');
        cache.activeBranchId = savedBranchId ? Number(savedBranchId) : null;
      } catch (e) { /* تجاهل */ }
    },
    getActiveBranchId() {
      return cache.activeBranchId;
    },

    /* ------------------------------------------------------------------
       الفروع (Branches)
    ------------------------------------------------------------------ */
    getBranches() {
      return [...cache.branches];
    },
    getBranchById(branchId) {
      return cache.branches.find(b => String(b.id) === String(branchId)) || null;
    },
    async addBranch({ name }) {
      const trimmedName = (name || '').trim();
      if (!trimmedName) return { error: 'اسم الفرع مطلوب' };
      const { data, error } = await supabaseClient.from('branches').insert({ name: trimmedName }).select().single();
      if (error) { logSupabaseError('addBranch', error); return { error: error.message }; }
      cache.branches.push(data);
      return data;
    },
    async updateBranch(branchId, { name }) {
      const { data, error } = await supabaseClient.from('branches').update({ name: name.trim() }).eq('id', branchId).select().single();
      if (error) return logSupabaseError('updateBranch', error);
      const idx = cache.branches.findIndex(b => String(b.id) === String(branchId));
      if (idx > -1) cache.branches[idx] = data;
      return data;
    },
    async deleteBranch(branchId) {
      const { error } = await supabaseClient.from('branches').delete().eq('id', branchId);
      if (error) { logSupabaseError('deleteBranch', error); return { error: error.message }; }
      cache.branches = cache.branches.filter(b => String(b.id) !== String(branchId));
    },

    /* ------------------------------------------------------------------
       المستخدمون وتسجيل الدخول
    ------------------------------------------------------------------ */
    async login(username, password) {
      const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .ilike('username', String(username).trim())
        .eq('password_hash', password)
        .maybeSingle();
      if (error) { logSupabaseError('login', error); return null; }
      if (data?.branch_id) this.setActiveBranch(data.branch_id);
      return data || null;
    },
    getUsers() {
      return [...cache.users];
    },
    getUserById(userId) {
      return cache.users.find(u => String(u.id) === String(userId)) || null;
    },
    getSecretaries() {
      return cache.users
        .filter(u =>
          u.role === 'secretary' &&
          (!cache.activeBranchId || String(u.branch_id) === String(cache.activeBranchId))
        )
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar'));
    },
    async addUser({ username, password, role, name, teacherId, phone, branchId }) {
      const payload = {
        username:      username.trim(),
        password_hash: password,
        role,
        full_name:  name.trim(),
        teacher_id: teacherId || null,
        phone:      phone     || '',
        branch_id:  branchId  || cache.activeBranchId || null,
      };
      const { data, error } = await supabaseClient.from('users').insert(payload).select().single();
      if (error) { logSupabaseError('addUser', error); return { error: error.message }; }
      cache.users.push(data);
      return data;
    },
    async updateUser(userId, updates) {
      const patch = {};
      if (updates.username  !== undefined) patch.username      = updates.username;
      if (updates.password  !== undefined) patch.password_hash = updates.password;
      if (updates.name      !== undefined) patch.full_name     = updates.name;
      if (updates.phone     !== undefined) patch.phone         = updates.phone;
      if (updates.branchId  !== undefined) patch.branch_id     = updates.branchId || null;
      const { data, error } = await supabaseClient.from('users').update(patch).eq('id', userId).select().single();
      if (error) return logSupabaseError('updateUser', error);
      const idx = cache.users.findIndex(u => String(u.id) === String(userId));
      if (idx > -1) cache.users[idx] = data;
      return data;
    },
    async deleteUser(userId) {
      const { error } = await supabaseClient.from('users').delete().eq('id', userId);
      if (error) return logSupabaseError('deleteUser', error);
      cache.users = cache.users.filter(u => String(u.id) !== String(userId));
    },
    async addSecretary({ username, password, name, phone, branchId }) {
      if (!username?.trim() || !password?.trim() || !name?.trim())
        return { error: 'اسم المستخدم وكلمة المرور والاسم إجباريون' };
      return this.addUser({ username, password, role: 'secretary', name, phone, branchId });
    },
    async updateSecretary(secretaryId, updates) { return this.updateUser(secretaryId, updates); },
    async deleteSecretary(secretaryId)          { return this.deleteUser(secretaryId); },

    /* ------------------------------------------------------------------
       المراحل الدراسية (Grade Levels)
    ------------------------------------------------------------------ */
    getGradeLevelRows() {
      return [...cache.gradeLevels];
    },
    getGradeLevelById(gradeLevelId) {
      return cache.gradeLevels.find(l => String(l.id) === String(gradeLevelId)) || null;
    },
    /** أسماء المراحل فقط للقوائم المنسدلة */
    getGradeLevels() {
      return cache.gradeLevels.map(l => l.name);
    },
    async addGradeLevel({ name, branchId }) {
      const trimmedName = (name || '').trim();
      if (!trimmedName) return { error: 'اسم السنة الدراسية مطلوب' };
      const payload = { name: trimmedName, branch_id: branchId || cache.activeBranchId || null };
      const { data, error } = await supabaseClient.from('grade_levels').insert(payload).select().single();
      if (error) { logSupabaseError('addGradeLevel', error); return { error: error.message }; }
      cache.gradeLevels.push(data);
      return data;
    },
    async deleteGradeLevel(gradeLevelId) {
      const { error } = await supabaseClient.from('grade_levels').delete().eq('id', gradeLevelId);
      if (error) return logSupabaseError('deleteGradeLevel', error);
      cache.gradeLevels = cache.gradeLevels.filter(l => String(l.id) !== String(gradeLevelId));
    },

    /* ------------------------------------------------------------------
       المواد الدراسية (Subjects)
    ------------------------------------------------------------------ */
    getSubjects() {
      return [...cache.subjects];
    },
    getSubjectsByGradeLevelId(gradeLevelId) {
      return cache.subjects.filter(s => String(s.grade_level_id) === String(gradeLevelId));
    },
    getSubjectsByGradeLevel(gradeLevelId) {
      return this.getSubjectsByGradeLevelId(gradeLevelId);
    },
    async addSubject({ name, gradeLevelId }) {
      const trimmedName = (name || '').trim();
      if (!trimmedName || !gradeLevelId) return { error: 'اسم المادة والسنة الدراسية مطلوبان' };
      const { data, error } = await supabaseClient
        .from('subjects').insert({ name: trimmedName, grade_level_id: gradeLevelId }).select().single();
      if (error) { logSupabaseError('addSubject', error); return { error: error.message }; }
      cache.subjects.push(data);
      return data;
    },
    async deleteSubject(subjectId) {
      const { error } = await supabaseClient.from('subjects').delete().eq('id', subjectId);
      if (error) return logSupabaseError('deleteSubject', error);
      cache.subjects = cache.subjects.filter(s => String(s.id) !== String(subjectId));
    },

    /* ------------------------------------------------------------------
       المدرسون (Teachers)
    ------------------------------------------------------------------ */
    getTeachers() {
      return [...cache.teachers].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    },
    getTeacherById(teacherId) {
      return cache.teachers.find(t => String(t.id) === String(teacherId)) || null;
    },
    getStudentsCountForTeacher(teacherId) {
      const teacherGroupIds = cache.groups
        .filter(g => String(g.teacher_id) === String(teacherId))
        .map(g => g.id);
      const uniqueStudentIds = new Set(
        cache.studentGroups
          .filter(e => teacherGroupIds.includes(e.group_id))
          .map(e => e.student_id)
      );
      return uniqueStudentIds.size;
    },
    getGroupsByTeacherId(teacherId) {
      return cache.groups.filter(g => String(g.teacher_id) === String(teacherId));
    },
    getGroupsByTeacher(teacherId) {
      return this.getGroupsByTeacherId(teacherId);
    },
    async addTeacher({ name, subjectId, gradeLevel, gradeLevelId, phone, profitPercentage, userId, branchId }) {
      const payload = {
        name:               name.trim(),
        subject_id:         subjectId         || null,
        grade_level:        gradeLevel        || null,
        grade_level_id:     gradeLevelId      || null,
        phone:              phone             || '',
        profit_percentage:  Number(profitPercentage) || 0,
        user_id:            userId            || null,
        branch_id:          branchId          || cache.activeBranchId || null,
      };
      const { data, error } = await supabaseClient.from('teachers').insert(payload).select().single();
      if (error) { logSupabaseError('addTeacher', error); return null; }
      cache.teachers.push(data);
      return data;
    },
    async updateTeacher(teacherId, updates) {
      const patch = {};
      if (updates.name             !== undefined) patch.name               = updates.name;
      if (updates.subjectId        !== undefined) patch.subject_id         = updates.subjectId;
      if (updates.gradeLevel       !== undefined) patch.grade_level        = updates.gradeLevel;
      if (updates.gradeLevelId     !== undefined) patch.grade_level_id     = updates.gradeLevelId;
      if (updates.phone            !== undefined) patch.phone              = updates.phone;
      if (updates.profitPercentage !== undefined) patch.profit_percentage  = Number(updates.profitPercentage) || 0;
      if (updates.userId           !== undefined) patch.user_id            = updates.userId;
      if (updates.branchId         !== undefined) patch.branch_id          = updates.branchId || null;
      const { data, error } = await supabaseClient.from('teachers').update(patch).eq('id', teacherId).select().single();
      if (error) { logSupabaseError('updateTeacher', error); return null; }
      const idx = cache.teachers.findIndex(t => String(t.id) === String(teacherId));
      if (idx > -1) cache.teachers[idx] = data;
      return data;
    },
    async deleteTeacher(teacherId) {
      const teacher    = cache.teachers.find(t => String(t.id) === String(teacherId));
      const linkedUser = cache.users.find(u => String(u.teacher_id) === String(teacherId) || (teacher && String(u.id) === String(teacher.user_id)));
      if (linkedUser) await supabaseClient.from('users').delete().eq('id', linkedUser.id);
      const { error } = await supabaseClient.from('teachers').delete().eq('id', teacherId);
      if (error) return logSupabaseError('deleteTeacher', error);
      cache.teachers = cache.teachers.filter(t => String(t.id) !== String(teacherId));
      if (linkedUser) cache.users = cache.users.filter(u => u.id !== linkedUser.id);
    },

    /* ------------------------------------------------------------------
       المجموعات (Groups)
    ------------------------------------------------------------------ */
    getGroups() {
      return [...cache.groups];
    },
    getGroupById(groupId) {
      return cache.groups.find(g => String(g.id) === String(groupId)) || null;
    },
    getGroupsByGradeLevelName(gradeLevelName) {
      return cache.groups.filter(g => g.grade_level === gradeLevelName);
    },
    getGroupsByGradeLevel(gradeLevelName) {
      return this.getGroupsByGradeLevelName(gradeLevelName);
    },
    async addGroup({ teacherId, subjectId, gradeLevel, gradeLevelId, dayOfWeek, timeStart, pricePerSession, centerPercentage, branchId }) {
      const hasPct = centerPercentage !== undefined && centerPercentage !== null && centerPercentage !== '' && !isNaN(Number(centerPercentage));
      const payload = {
        teacher_id:         teacherId,
        subject_id:         subjectId,
        grade_level:        gradeLevel        || null,
        grade_level_id:     gradeLevelId      || null,
        day_of_week:        dayOfWeek         || null,
        time_start:         timeStart         || null,
        price_per_session:  Number(pricePerSession)  || 0,
        center_percentage:  hasPct ? Number(centerPercentage) : 30,
        branch_id:          branchId          || cache.activeBranchId || null,
      };
      const { data, error } = await supabaseClient.from('groups').insert(payload).select().single();
      if (error) { logSupabaseError('addGroup', error); return null; }
      cache.groups.push(data);
      return data;
    },
    async updateGroup(groupId, updates) {
      const patch = {};
      if (updates.teacherId        !== undefined) patch.teacher_id        = updates.teacherId;
      if (updates.subjectId        !== undefined) patch.subject_id        = updates.subjectId;
      if (updates.gradeLevel       !== undefined) patch.grade_level       = updates.gradeLevel;
      if (updates.gradeLevelId     !== undefined) patch.grade_level_id    = updates.gradeLevelId;
      if (updates.dayOfWeek        !== undefined) patch.day_of_week       = updates.dayOfWeek;
      if (updates.timeStart        !== undefined) patch.time_start        = updates.timeStart || null;
      if (updates.pricePerSession  !== undefined) patch.price_per_session = Number(updates.pricePerSession)  || 0;
      if (updates.centerPercentage !== undefined && updates.centerPercentage !== '' && !isNaN(Number(updates.centerPercentage)))
        patch.center_percentage = Number(updates.centerPercentage);
      if (updates.branchId         !== undefined) patch.branch_id         = updates.branchId || null;
      const { data, error } = await supabaseClient.from('groups').update(patch).eq('id', groupId).select().single();
      if (error) { logSupabaseError('updateGroup', error); return null; }
      const idx = cache.groups.findIndex(g => String(g.id) === String(groupId));
      if (idx > -1) cache.groups[idx] = data;
      return data;
    },
    async deleteGroup(groupId) {
      const { error } = await supabaseClient.from('groups').delete().eq('id', groupId);
      if (error) return logSupabaseError('deleteGroup', error);
      cache.groups = cache.groups.filter(g => String(g.id) !== String(groupId));
    },

    /* ------------------------------------------------------------------
       الطلاب (Students)
    ------------------------------------------------------------------ */
    getStudents() {
      return [...cache.students].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    },
    getStudentById(studentId) {
      return cache.students.find(
        s => String(s.id) === String(studentId) || s.student_code === String(studentId)
      ) || null;
    },
    getStudentByCode(studentCode) {
      return cache.students.find(s => s.student_code === String(studentCode)) || null;
    },
    getStudentGroupIds(studentId) {
      return cache.studentGroups
        .filter(e => String(e.student_id) === String(studentId))
        .map(e => e.group_id);
    },
    getGroupsForStudent(studentId) {
      const ids = this.getStudentGroupIds(studentId).map(String);
      return cache.groups.filter(g => ids.includes(String(g.id)));
    },
    getGroupsForStudentToday(studentId) {
      const todayName = getTodayArabicDayName();
      return this.getGroupsForStudent(studentId).filter(g => g.day_of_week === todayName);
    },
    getStudentsByGroup(groupId) {
      const studentIds = cache.studentGroups
        .filter(e => String(e.group_id) === String(groupId))
        .map(e => String(e.student_id));
      return cache.students.filter(s => studentIds.includes(String(s.id)));
    },
    /** الطلاب المسجلون في المجموعة وقت الحصة (joined_at <= تاريخ الحصة) */
    getStudentsByGroupAtDate(groupId, sessionDate) {
      const ids = cache.studentGroups
        .filter(e => String(e.group_id) === String(groupId) && (e.joined_at || '').slice(0, 10) <= sessionDate)
        .map(e => String(e.student_id));
      return cache.students.filter(s => ids.includes(String(s.id)));
    },
    getTodayDayName() { return getTodayArabicDayName(); },

    async addStudent({ studentCode, name, gradeLevel, gradeLevelId, phone, parentPhone, groupId, groupIds, branchId }) {
      const payload = {
        student_code:   studentCode.trim(),
        name:           name.trim(),
        grade_level:    gradeLevel   || null,
        grade_level_id: gradeLevelId || null,
        phone:          phone        || '',
        parent_phone:   parentPhone  || '',
        total_debt:     0,
        branch_id:      branchId     || cache.activeBranchId || null,
      };
      const { data, error } = await supabaseClient.from('students').insert(payload).select().single();
      if (error) { logSupabaseError('addStudent', error); return { error: error.message }; }
      cache.students.push(data);
      const toEnroll = Array.isArray(groupIds) && groupIds.length ? groupIds : (groupId ? [groupId] : []);
      for (const gid of toEnroll) await this.enrollStudentInGroup(data.id, gid);
      return data;
    },
    async updateStudent(studentId, updates) {
      const patch = {};
      if (updates.name         !== undefined) patch.name           = updates.name;
      if (updates.gradeLevel   !== undefined) patch.grade_level    = updates.gradeLevel;
      if (updates.gradeLevelId !== undefined) patch.grade_level_id = updates.gradeLevelId;
      if (updates.phone        !== undefined) patch.phone          = updates.phone;
      if (updates.parentPhone  !== undefined) patch.parent_phone   = updates.parentPhone;
      if (updates.totalDebt    !== undefined) patch.total_debt     = Number(updates.totalDebt) || 0;
      if (updates.studentCode  !== undefined) patch.student_code   = updates.studentCode;
      if (updates.branchId     !== undefined) patch.branch_id      = updates.branchId || null;
      const { data, error } = await supabaseClient.from('students').update(patch).eq('id', studentId).select().single();
      if (error) return logSupabaseError('updateStudent', error);
      const idx = cache.students.findIndex(s => String(s.id) === String(studentId));
      if (idx > -1) cache.students[idx] = data;
      return data;
    },
    async adjustStudentDebt(studentId, deltaAmount) {
      const student = this.getStudentById(studentId);
      if (!student) return null;
      const newDebt = Number(student.total_debt || 0) + Number(deltaAmount || 0);
      return this.updateStudent(studentId, { totalDebt: newDebt });
    },
    async deleteStudent(studentId) {
      await supabaseClient.from('student_groups').delete().eq('student_id', studentId);
      const { error } = await supabaseClient.from('students').delete().eq('id', studentId);
      if (error) return logSupabaseError('deleteStudent', error);
      cache.students      = cache.students.filter(s => String(s.id) !== String(studentId));
      cache.studentGroups = cache.studentGroups.filter(e => String(e.student_id) !== String(studentId));
    },
    async enrollStudentInGroup(studentId, groupId) {
      const { data, error } = await supabaseClient
        .from('student_groups')
        .insert({ student_id: studentId, group_id: groupId, joined_at: new Date().toISOString() })
        .select().single();
      if (error) return logSupabaseError('enrollStudentInGroup', error);
      cache.studentGroups.push(data);
      return data;
    },
    async unenrollStudentFromGroup(studentId, groupId) {
      const { error } = await supabaseClient
        .from('student_groups')
        .delete()
        .eq('student_id', studentId)
        .eq('group_id', groupId);
      if (error) return logSupabaseError('unenrollStudentFromGroup', error);
      cache.studentGroups = cache.studentGroups.filter(
        e => !(String(e.student_id) === String(studentId) && String(e.group_id) === String(groupId))
      );
    },

    /* ------------------------------------------------------------------
       السجلات اليومية (Daily Records)
    ------------------------------------------------------------------ */
    getDailyRecords() {
      return [...cache.dailyRecords];
    },
    getPendingRecords() {
      return cache.dailyRecords
        .filter(r => !r.is_approved)
        .sort((a, b) => new Date(b.session_date) - new Date(a.session_date));
    },
    getApprovedRecords() {
      return cache.dailyRecords.filter(r => r.is_approved);
    },
    getRecordForStudentToday(studentId, groupId) {
      const todayDate = getTodayDateString();
      if (groupId) {
        return cache.dailyRecords.find(
          r =>
            String(r.student_id) === String(studentId) &&
            String(r.group_id)   === String(groupId)   &&
            r.session_date       === todayDate
        ) || null;
      }
      return cache.dailyRecords.find(
        r => String(r.student_id) === String(studentId) && r.session_date === todayDate
      ) || null;
    },
    getPendingRecordForStudentToday(studentId, groupId) {
      const r = this.getRecordForStudentToday(studentId, groupId);
      return r && !r.is_approved ? r : null;
    },
    getApprovedRecordForStudentToday(studentId, groupId) {
      const r = this.getRecordForStudentToday(studentId, groupId);
      return r && r.is_approved ? r : null;
    },

    /** اسم السكرتير المسؤول عن السجل: من جدول users أولاً ثم secretary_name */
    getRecordSecretaryName(r) {
      const u = r?.secretary_id ? cache.users.find(x => String(x.id) === String(r.secretary_id)) : null;
      return u?.full_name || u?.username || r?.secretary_name || '—';
    },

    /**
     * saveRecord — يحفظ سجل الحضور والدفع ويحسب الأرباح تلقائياً.
     *
     * الإعفاء:
     *   exemptCenter  = true  →  كامل المبلغ يذهب للمدرس
     *   exemptTeacher = true  →  كامل المبلغ يذهب للأكاديمية
     *   الاثنان معاً          →  amount_paid = 0 (remaining_amount لا يُلمس)
     *
     * ✅ لو amountPaid / exemptCenter / exemptTeacher مش مبعوتين (مثلاً حفظ درجات المدرس)
     *    القيم القديمة للسجل الموجود بتتحفظ كما هي (مفيش تصفير للفلوس).
     *
     * is_locked = true يُضبط تلقائياً لمنع تعديل السكرتير للكارت بعد الحفظ.
     */
    async saveRecord(recordData) {
      const sessionDate = recordData.sessionDate || getTodayDateString();
      const groupId     = recordData.groupId     || this.getStudentGroupIds(recordData.studentId)[0] || null;

      // 1. السجل الموجود (للـ UPSERT والحفاظ على القيم القديمة)
      const existing = cache.dailyRecords.find(
        r =>
          String(r.student_id) === String(recordData.studentId) &&
          String(r.group_id)   === String(groupId) &&
          r.session_date       === sessionDate
      );
      const prevRemaining = Number(existing?.remaining_amount) || 0;
      const prevPaid      = Number(existing?.amount_paid)      || 0;

      // 2. حساب نسب الأرباح
      const group          = this.getGroupById(groupId);
      const centerPct      = centerPctOf(group);
      const teacherPct     = 100 - centerPct;
      const isExemptCenter  = recordData.exemptCenter  !== undefined ? recordData.exemptCenter  === true : existing?.exempt_center  === true;
      const isExemptTeacher = recordData.exemptTeacher !== undefined ? recordData.exemptTeacher === true : existing?.exempt_teacher === true;
      const isDoubleExempt  = isExemptCenter && isExemptTeacher;

      // الإعفاء المزدوج: amount_paid يتصفّر دايماً (remaining_amount مش له علاقة ومش بيتصفر)
      const amountPaid = isDoubleExempt
        ? 0
        : (recordData.amountPaid !== undefined ? (Number(recordData.amountPaid) || 0) : prevPaid);

      let centerProfit  = 0;
      let teacherProfit = 0;
      if (isDoubleExempt) {
        centerProfit  = 0;
        teacherProfit = 0;
      } else if (isExemptCenter) {
        centerProfit  = 0;
        teacherProfit = amountPaid;
      } else if (isExemptTeacher) {
        centerProfit  = amountPaid;
        teacherProfit = 0;
      } else {
        centerProfit  = (amountPaid * centerPct)  / 100;
        teacherProfit = (amountPaid * teacherPct) / 100;
      }

      const newRemaining  = recordData.remainingAmount !== undefined
        ? Number(recordData.remainingAmount)
        : prevRemaining;

      // 3. بناء الـ Payload
      const student = cache.students.find(s => String(s.id) === String(recordData.studentId));
      const payload = {
        student_id:        recordData.studentId,
        student_name:      student?.name || '',
        group_id:          groupId,
        session_date:      sessionDate,
        time_in:           recordData.timeIn         ?? existing?.time_in        ?? getCurrentTimeString(),
        attendance:        recordData.attendance      ?? existing?.attendance     ?? 'absent',
        payment_status:    recordData.paymentStatus   ?? existing?.payment_status ?? 'unpaid',
        amount_paid:       amountPaid,
        remaining_amount:  newRemaining,
        exempt_center:     isExemptCenter,
        exempt_teacher:    isExemptTeacher,
        center_profit:     centerProfit,
        teacher_profit:    teacherProfit,
        secretary_id:      recordData.secretaryId    ?? existing?.secretary_id   ?? null,
        secretary_name:    recordData.secretaryName  ?? existing?.secretary_name ?? '',
        exam_grade:        recordData.examGrade        !== undefined ? recordData.examGrade        : (existing?.exam_grade         ?? null),
        exam_out_of:       recordData.examOutOf        !== undefined ? recordData.examOutOf        : (existing?.exam_out_of        ?? 10),
        homework_grade:    recordData.homeworkGrade    !== undefined ? recordData.homeworkGrade    : (existing?.homework_grade     ?? null),
        homework_out_of:   recordData.homeworkOutOf    !== undefined ? recordData.homeworkOutOf    : (existing?.homework_out_of   ?? 10),
        teacher_notes:     recordData.teacherNotes     !== undefined ? recordData.teacherNotes     : (existing?.teacher_notes     ?? ''),
        teacher_submitted: recordData.teacherSubmitted !== undefined ? recordData.teacherSubmitted : (existing?.teacher_submitted ?? false),
        is_approved:       false,
        is_locked:         true,   // 🔒 قفل فوري بعد الحفظ
        is_sent:           false,
        approver_id:       null,
      };

      // 4. UPSERT على (student_id, group_id, session_date)
      const { data: saved, error } = await supabaseClient
        .from('daily_records')
        .upsert(payload, { onConflict: 'student_id,group_id,session_date' })
        .select().single();
      if (error) return logSupabaseError('saveRecord', error);

      // 5. تحديث الـ Cache
      const idx = cache.dailyRecords.findIndex(r => String(r.id) === String(saved.id));
      if (idx > -1) cache.dailyRecords[idx] = saved;
      else cache.dailyRecords.unshift(saved);

      // 6. تعديل المديونية بالفارق فقط
      const debtChange = newRemaining - prevRemaining;
      if (debtChange !== 0) await this.adjustStudentDebt(recordData.studentId, debtChange);

      // 7. تسجيل الدفعة في الخزنة (الفارق فقط — موجب أو سالب)
      const paidChange = amountPaid - prevPaid;
      if (paidChange !== 0) {
        await this.addPayment({
          studentId:   recordData.studentId,
          amount:      paidChange,
          secretaryId: recordData.secretaryId ?? existing?.secretary_id ?? null,
          notes:       recordData.paymentNotes || (existing ? (paidChange > 0 ? 'تحديث دفعة' : 'تقليل/تعديل دفعة') : 'دفع أثناء الحضور'),
        });
      }

      return saved;
    },

    async updateRecord(recordId, updates) {
      const existing = cache.dailyRecords.find(r => String(r.id) === String(recordId));
      if (!existing) return null;

      const prevPaid      = Number(existing.amount_paid)      || 0;
      const prevRemaining = Number(existing.remaining_amount) || 0;

      const group   = this.getGroupById(existing.group_id);
      const centerPct   = centerPctOf(group);
      const teacherPct  = 100 - centerPct;
      const isExemptCenter  = updates.exemptCenter  ?? existing.exempt_center  ?? false;
      const isExemptTeacher = updates.exemptTeacher ?? existing.exempt_teacher ?? false;
      const isDoubleExempt  = isExemptCenter && isExemptTeacher;

      // الإعفاء المزدوج: amount_paid يتصفّر (remaining_amount مش له علاقة)
      const newPaid      = isDoubleExempt ? 0 : (updates.amountPaid !== undefined ? Number(updates.amountPaid) : prevPaid);
      const newRemaining = updates.remainingAmount !== undefined ? Number(updates.remainingAmount) : prevRemaining;

      let centerProfit  = 0;
      let teacherProfit = 0;
      if (isDoubleExempt)        { centerProfit = 0;        teacherProfit = 0; }
      else if (isExemptCenter)   { centerProfit = 0;        teacherProfit = newPaid; }
      else if (isExemptTeacher)  { centerProfit = newPaid;  teacherProfit = 0; }
      else {
        centerProfit  = (newPaid * centerPct)  / 100;
        teacherProfit = (newPaid * teacherPct) / 100;
      }

      const patch = {};
      if (updates.attendance      !== undefined) patch.attendance       = updates.attendance;
      if (updates.paymentStatus   !== undefined) patch.payment_status   = updates.paymentStatus;
      if (updates.examGrade       !== undefined) patch.exam_grade       = updates.examGrade;
      if (updates.examOutOf       !== undefined) patch.exam_out_of      = updates.examOutOf;
      if (updates.homeworkGrade   !== undefined) patch.homework_grade   = updates.homeworkGrade;
      if (updates.homeworkOutOf   !== undefined) patch.homework_out_of  = updates.homeworkOutOf;
      if (updates.teacherNotes    !== undefined) patch.teacher_notes    = updates.teacherNotes;
      if (updates.amountPaid !== undefined || isDoubleExempt) patch.amount_paid = newPaid;
      if (updates.remainingAmount !== undefined) patch.remaining_amount = newRemaining;
      if (updates.exemptCenter    !== undefined) patch.exempt_center    = isExemptCenter;
      if (updates.exemptTeacher   !== undefined) patch.exempt_teacher   = isExemptTeacher;
      patch.center_profit  = centerProfit;
      patch.teacher_profit = teacherProfit;

      const { data: updated, error } = await supabaseClient
        .from('daily_records').update(patch).eq('id', recordId).select().single();
      if (error) return logSupabaseError('updateRecord', error);

      const debtChange = newRemaining - prevRemaining;
      if (debtChange !== 0) await this.adjustStudentDebt(existing.student_id, debtChange);

      // الفرق في المدفوع — موجب أو سالب، بما فيه تصفير الإعفاء المزدوج
      const paidChange = newPaid - prevPaid;
      if (paidChange !== 0) {
        await this.addPayment({
          studentId: existing.student_id,
          amount:    paidChange,
          secretaryId: existing.secretary_id ?? null,
          notes:    'تعديل دفعة (تسوية إدارية)',
        });
      }

      const updIdx = cache.dailyRecords.findIndex(r => String(r.id) === String(recordId));
      if (updIdx > -1) cache.dailyRecords[updIdx] = updated;
      return updated;
    },

    /**
     * approveRecord — اعتماد سجل وقفله نهائياً.
     */
    async approveRecord(recordId, approverId) {
      const existing = cache.dailyRecords.find(r => String(r.id) === String(recordId));
      if (!existing)          return null;
      if (existing.is_approved) return existing;

      const { data: approved, error } = await supabaseClient
        .from('daily_records')
        .update({ is_approved: true, approver_id: approverId || null })
        .eq('id', existing.id)
        .select().single();
      if (error) return logSupabaseError('approveRecord', error);

      const idx = cache.dailyRecords.findIndex(r => String(r.id) === String(existing.id));
      if (idx > -1) cache.dailyRecords[idx] = approved;
      return approved;
    },

    async approveAll(approverId) {
      const pendingIds = this.getPendingRecords().map(r => r.id);
      if (!pendingIds.length) return [];
      const { data, error } = await supabaseClient
        .from('daily_records')
        .update({ is_approved: true, approver_id: approverId || null })
        .in('id', pendingIds)
        .select();
      if (error) return logSupabaseError('approveAll', error);
      data.forEach(approved => {
        const idx = cache.dailyRecords.findIndex(r => String(r.id) === String(approved.id));
        if (idx > -1) cache.dailyRecords[idx] = approved;
      });
      return data;
    },

    async deleteRecord(recordId) {
      const existing = cache.dailyRecords.find(r => String(r.id) === String(recordId));
      if (existing) {
        const prevRemaining = Number(existing.remaining_amount) || 0;
        const prevPaid      = Number(existing.amount_paid)      || 0;
        if (prevRemaining !== 0)
          await this.adjustStudentDebt(existing.student_id, -prevRemaining);
        if (prevPaid > 0)
          await this.addPayment({ studentId: existing.student_id, amount: -prevPaid, secretaryId: existing.secretary_id ?? null, notes: 'إلغاء سجل (حذف)' });
      }
      const { error } = await supabaseClient.from('daily_records').delete().eq('id', recordId);
      if (error) return logSupabaseError('deleteRecord', error);
      cache.dailyRecords = cache.dailyRecords.filter(r => String(r.id) !== String(recordId));
    },

    /**
     * ✅ حفظ المدرس للدرجات: لا يمس المدفوع ولا الإعفاءات ولا اسم السكرتير لو السجل موجود.
     */
    async submitTeacherReport(studentId, { groupId, examGrade, examOutOf, homeworkGrade, homeworkOutOf, notes, teacherName }) {
      const hasRecord = !!this.getRecordForStudentToday(studentId, groupId);
      const data = {
        studentId, groupId,
        examGrade, examOutOf, homeworkGrade, homeworkOutOf,
        teacherNotes:     notes,
        teacherSubmitted: true,
      };
      if (!hasRecord) data.secretaryName = teacherName;
      return this.saveRecord(data);
    },

    async finalizeGroupReport(groupId, teacherName, sessionDate) {
      const targetDate    = sessionDate || getTodayDateString();
      const groupStudents = this.getStudentsByGroupAtDate(groupId, targetDate);
      const autoAbsent    = [];

      for (const student of groupStudents) {
        const hasRecord = cache.dailyRecords.find(
          r =>
            String(r.student_id) === String(student.id) &&
            String(r.group_id)   === String(groupId)    &&
            r.session_date       === targetDate
        );
        if (hasRecord) continue;
        const absentRec = await this.saveRecord({
          studentId:        student.id,
          groupId,
          sessionDate:      targetDate,
          attendance:       'absent',
          paymentStatus:    'unpaid',
          teacherSubmitted: true,
          secretaryName:    teacherName || 'المدرس',
        });
        if (absentRec) autoAbsent.push(absentRec);
      }
      return autoAbsent;
    },

    /* ------------------------------------------------------------------
       المدفوعات (Student Payments) — الخزنة
    ------------------------------------------------------------------ */
    getAllPayments() {
      return [...cache.studentPayments];
    },
    getPaymentsForStudent(studentId) {
      return cache.studentPayments
        .filter(p => String(p.student_id) === String(studentId))
        .sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date));
    },
    async addPayment({ studentId, amount, secretaryId, notes }) {
      const payload = {
        student_id:   studentId,
        amount:       Number(amount) || 0,
        secretary_id: secretaryId || null,
        payment_date: new Date().toISOString(),
        notes:        notes || '',
      };
      const { data, error } = await supabaseClient.from('student_payments').insert(payload).select().single();
      if (error) { logSupabaseError('addPayment', error); return null; }
      cache.studentPayments.unshift(data);
      return data;
    },
    async deletePayment(paymentId) {
      const { error } = await supabaseClient.from('student_payments').delete().eq('id', paymentId);
      if (error) return logSupabaseError('deletePayment', error);
      cache.studentPayments = cache.studentPayments.filter(p => String(p.id) !== String(paymentId));
    },

    /* ------------------------------------------------------------------
       المصروفات (Expenses)
    ------------------------------------------------------------------ */
    getExpenses() {
      return [...cache.expenses];
    },
    async addExpense({ name, amount, note, branchId, userId }) {
      const payload = {
        name:      name.trim(),
        amount:    Number(amount) || 0,
        note:      note     || '',
        branch_id: branchId || cache.activeBranchId || null,
        user_id:   userId   || null,
      };
      const { data, error } = await supabaseClient.from('expenses').insert(payload).select().single();
      if (error) { logSupabaseError('addExpense', error); return null; }
      cache.expenses.push(data);
      return data;
    },
    async deleteExpense(expenseId) {
      const { error } = await supabaseClient.from('expenses').delete().eq('id', expenseId);
      if (error) return logSupabaseError('deleteExpense', error);
      cache.expenses = cache.expenses.filter(e => String(e.id) !== String(expenseId));
    },

    /* ------------------------------------------------------------------
       الإحصائيات (Stats)
    ------------------------------------------------------------------ */
    getStats() {
      const today = getTodayDateString();
      return {
        totalStudents:    cache.students.length,
        activeGroups:     cache.groups.length,
        pendingApprovals: this.getPendingRecords().length,
        approvedToday:    cache.dailyRecords.filter(r => r.is_approved && r.session_date === today).length,
        totalTeachers:    cache.teachers.length,
        totalSecretaries: this.getSecretaries().length,
      };
    },

    /* ------------------------------------------------------------------
       التقارير المالية (Finance)
    ------------------------------------------------------------------ */
    _getGroupIdsSetForTeacher(teacherId) {
      if (!teacherId || teacherId === 'all') return null;
      return new Set(
        cache.groups.filter(g => String(g.teacher_id) === String(teacherId)).map(g => g.id)
      );
    },
    _getGroupIdsSetForBranch(branchId) {
      if (!branchId || branchId === 'all') return null;
      return new Set(
        cache.groups.filter(g => String(g.branch_id) === String(branchId)).map(g => g.id)
      );
    },

    // ملاحظة: totalCollected يُحسب من amount_paid/payments فقط — remaining_amount (المديونية) لا يدخل
    // في المحصّل إطلاقاً، ويظهر فقط في totalOutstanding (من students.total_debt) حتى يُدفع فعلياً.
    getFinanceSummary(fromDate, toDate, teacherId, groupId, branchId) {
      let records = cache.dailyRecords;
      if (fromDate) records = records.filter(r => r.session_date >= fromDate);
      if (toDate)   records = records.filter(r => r.session_date <= toDate);
      if (groupId && groupId !== 'all')
        records = records.filter(r => String(r.group_id) === String(groupId));

      const teacherGroupIds = this._getGroupIdsSetForTeacher(teacherId);
      if (teacherGroupIds) records = records.filter(r => teacherGroupIds.has(r.group_id));

      const branchGroupIds = this._getGroupIdsSetForBranch(branchId);
      if (branchGroupIds) records = records.filter(r => branchGroupIds.has(r.group_id));

      const hasCrossFilter = (teacherId && teacherId !== 'all') || (groupId && groupId !== 'all') || (branchId && branchId !== 'all');

      let payments = cache.studentPayments;
      if (fromDate) payments = payments.filter(p => (p.payment_date || '').slice(0, 10) >= fromDate);
      if (toDate)   payments = payments.filter(p => (p.payment_date || '').slice(0, 10) <= toDate);

      const totalCollected = hasCrossFilter
        ? records.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0)
        : (payments.length
          ? payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
          : records.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0));

      const totalCenterProfit  = records.reduce((sum, r) => sum + (Number(r.center_profit)  || 0), 0);
      const totalTeacherProfit = records.reduce((sum, r) => sum + (Number(r.teacher_profit) || 0), 0);
      const outstandingStudents = (branchId && branchId !== 'all')
        ? cache.students.filter(s => String(s.branch_id) === String(branchId))
        : cache.students;
      const totalOutstanding   = outstandingStudents.reduce((sum, s) => sum + (Number(s.total_debt) || 0), 0);
      const totalExpenses      = hasCrossFilter ? 0 : cache.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const netProfit          = totalCollected - totalExpenses;

      return {
        totalCollected,
        totalOutstanding,
        totalExpenses,
        netProfit,
        totalCenterProfit,
        totalTeacherProfit,
        centerProfit:  totalCenterProfit,
        teacherProfit: totalTeacherProfit,
        filteredRecords: records,
        filteredPayments: payments,
      };
    },

    /**
     * getPaymentLedgerRows — صفوف جدول "سجل الدفعات التفصيلي" (من daily_records)
     */
    getPaymentLedgerRows(fromDate, toDate, teacherId, groupId, branchId) {
      let records = cache.dailyRecords.filter(r => Number(r.amount_paid) > 0);

      if (fromDate) records = records.filter(r => r.session_date >= fromDate);
      if (toDate)   records = records.filter(r => r.session_date <= toDate);
      if (groupId && groupId !== 'all')
        records = records.filter(r => String(r.group_id) === String(groupId));

      const teacherGroupIds = this._getGroupIdsSetForTeacher(teacherId);
      if (teacherGroupIds) records = records.filter(r => teacherGroupIds.has(r.group_id));

      const branchGroupIds = this._getGroupIdsSetForBranch(branchId);
      if (branchGroupIds) records = records.filter(r => branchGroupIds.has(r.group_id));

      records = [...records].sort((a, b) => {
        const dateCompare = b.session_date.localeCompare(a.session_date);
        if (dateCompare !== 0) return dateCompare;
        return (b.time_in || '').localeCompare(a.time_in || '');
      });

      return records.map(r => {
        const student = this.getStudentById(r.student_id);
        return {
          id:            r.id,
          date:          r.session_date,
          time:          r.time_in || '',
          studentName:   student?.name         || '—',
          studentCode:   student?.student_code || '—',
          amount:        Number(r.amount_paid)     || 0,
          centerProfit:  Number(r.center_profit)   || 0,
          teacherProfit: Number(r.teacher_profit)  || 0,
          secretaryName: this.getRecordSecretaryName(r),
          isApproved:    r.is_approved || false,
          notes:         r.teacher_notes || '',
        };
      });
    },

    /**
     * ✅ المرحلة 4 — getSecretaryTotals(date)
     * يجمع المحصّل وأرباح السنتر والمدرسين لكل سكرتير ليوم واحد محدد.
     * يعتمد على سجلات الحضور (attendance = present) ليوم واحد، حتى لو المدفوع 0.
     * عدد السجلات يشمل الحضور بدون دفع.
     */
    getSecretaryTotals(date) {
      const target = date || getTodayDateString();
      const map = new Map();
      cache.dailyRecords
        .filter(r => r.session_date === target && r.attendance === 'present')
        .forEach(r => {
          const name = this.getRecordSecretaryName(r);
          const key  = r.secretary_id ? `id:${r.secretary_id}` : `name:${name}`;
          if (!map.has(key)) {
            map.set(key, { secretaryName: name, recordsCount: 0, totalCollected: 0, totalCenterProfit: 0, totalTeacherProfit: 0 });
          }
          const row = map.get(key);
          row.recordsCount      += 1;
          row.totalCollected    += Number(r.amount_paid)    || 0;
          row.totalCenterProfit += Number(r.center_profit)  || 0;
          row.totalTeacherProfit+= Number(r.teacher_profit) || 0;
        });
      return [...map.values()].sort((a, b) => b.totalCollected - a.totalCollected);
    },

    /**
     * ✅ المرحلة 4 — getDailyPrintRows(date)
     * صف منفصل لكل (طالب + مجموعة) في اليوم المختار:
     * الطالب المسجل في أكتر من مادة يظهر في كل مادة بصف منفصل.
     */
    getDailyPrintRows(date) {
      const target = date || getTodayDateString();
      return cache.dailyRecords
        .filter(r => r.session_date === target)
        .map(r => {
          const student = this.getStudentById(r.student_id);
          const group   = this.getGroupById(r.group_id);
          const teacher = group ? this.getTeacherById(group.teacher_id) : null;
          const subject = group ? cache.subjects.find(s => String(s.id) === String(group.subject_id)) : null;
          return {
            studentName:   student?.name || r.student_name || '—',
            studentCode:   student?.student_code || '—',
            teacherName:   teacher?.name || '—',
            gradeLevel:    group?.grade_level || student?.grade_level || '—',
            subjectName:   subject?.name || '—',
            groupLabel:    group ? `${group.day_of_week || ''} ${formatTime12(group.time_start)}`.trim() || '—' : '—',
            attendance:    r.attendance === 'present' ? 'حاضر' : r.attendance === 'absent' ? 'غائب' : '—',
            amountPaid:    Number(r.amount_paid) || 0,
            remaining:     Number(r.remaining_amount) || 0,
            secretaryName: this.getRecordSecretaryName(r),
          };
        })
        .sort((a, b) =>
          a.teacherName.localeCompare(b.teacherName, 'ar') ||
          a.subjectName.localeCompare(b.subjectName, 'ar') ||
          a.studentName.localeCompare(b.studentName, 'ar')
        );
    },

    getDebtDetailsForStudent(studentId) {
      return cache.dailyRecords
        .filter(r => String(r.student_id) === String(studentId))
        .map(r => {
          const group     = this.getGroupById(r.group_id);
          const remaining = Number(r.remaining_amount) || 0;
          return { r, group, remaining };
        })
        .filter(item => item.remaining > 0)
        .sort((a, b) => new Date(b.r.session_date) - new Date(a.r.session_date))
        .map(item => ({
          date:       item.r.session_date,
          groupLabel: item.group
            ? (this.getSubjects().find(s => String(s.id) === String(item.group.subject_id))?.name || item.group.grade_level || 'مجموعة')
            : '—',
          teacherName: item.group ? (this.getTeacherById(item.group.teacher_id)?.name || '—') : '—',
          remaining:  item.remaining,
        }));
    },

    /* ------------------------------------------------------------------
       الشيت المجمع (Master Table)
    ------------------------------------------------------------------ */
    getMasterTableRows(fromDate, toDate) {
      let records = cache.dailyRecords;
      if (fromDate) records = records.filter(r => r.session_date >= fromDate);
      if (toDate)   records = records.filter(r => r.session_date <= toDate);

      return records.map(r => {
        const student = this.getStudentById(r.student_id);
        const group   = this.getGroupById(r.group_id);
        const teacher = group ? this.getTeacherById(group.teacher_id) : null;
        const branch  = this.getBranchById(student?.branch_id ?? group?.branch_id);
        return {
          date:          r.session_date,
          studentCode:   student?.student_code || '—',
          studentName:   student?.name         || '—',
          branchName:    branch?.name          || '—',
          gradeLevel:    student?.grade_level  || '—',
          teacherName:   teacher?.name         || '—',
          timeIn:        r.time_in             || '—',
          attendance:    r.attendance === 'present' ? 'حاضر' : r.attendance === 'absent' ? 'غائب' : '—',
          amountPaid:    r.amount_paid        || 0,
          centerProfit:  r.center_profit      || 0,
          teacherProfit: r.teacher_profit     || 0,
          homework:      `${r.homework_grade ?? '—'}/${r.homework_out_of ?? '—'}`,
          exam:          `${r.exam_grade     ?? '—'}/${r.exam_out_of     ?? '—'}`,
          notes:         r.teacher_notes      || '',
          isApproved:    r.is_approved        ? 'نعم' : 'لا',
          isLocked:      r.is_locked          ? 'مقفول' : 'مفتوح',
          totalDebt:     student?.total_debt  || 0,
        };
      });
    },

    /* ------------------------------------------------------------------
       المزامنة اللحظية (Real-Time Sync)
    ------------------------------------------------------------------ */
    initRealtimeSync() {
      if (realtimeStarted) return;   // منع تكرار الاشتراك عند إعادة تسجيل الدخول
      realtimeStarted = true;
      supabaseClient
        .channel('elgazzar_realtime_channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_records' },
          ({ eventType, new: newRec, old: oldRec }) => {
            if (eventType === 'INSERT') {
              if (!cache.dailyRecords.some(r => String(r.id) === String(newRec.id))) cache.dailyRecords.unshift(newRec);
            }
            else if (eventType === 'UPDATE') {
              const idx = cache.dailyRecords.findIndex(r => String(r.id) === String(newRec.id));
              if (idx > -1) cache.dailyRecords[idx] = newRec;
              else cache.dailyRecords.unshift(newRec);
            }
            else if (eventType === 'DELETE') {
              cache.dailyRecords = cache.dailyRecords.filter(r => String(r.id) !== String(oldRec.id));
            }
            window.dispatchEvent(new CustomEvent('db_updated'));
          }
        )
        .subscribe();
    },

  };
})();
