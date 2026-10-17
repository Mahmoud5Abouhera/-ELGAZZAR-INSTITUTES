-- أكاديمية الجزار — فحوصات قراءة فقط قبل أي migration.
-- لا يغيّر هذا الملف قاعدة البيانات.

-- 1) الأعمدة والقيود والفهارس الفعلية للجداول المحاسبية.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('daily_records','student_payments','users','groups','students')
ORDER BY table_name, ordinal_position;

SELECT t.relname AS table_name, i.relname AS index_name, pg_get_indexdef(i.oid) AS index_definition
FROM pg_class t
JOIN pg_index x ON x.indrelid=t.oid
JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public'
  AND t.relname IN ('daily_records','student_payments')
ORDER BY t.relname, i.relname;

-- 2) سياسات RLS الفعلية (لا يكفي مخطط CREATE TABLE وحده).
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, policyname;

SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY c.relname;

-- 3) هل الجداول مضافة إلى Realtime publication؟
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE schemaname='public'
ORDER BY pubname, tablename;

-- 4) الـ triggers والـ functions الموجودة فعليًا.
SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema='public'
ORDER BY event_object_table, trigger_name;

SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
ORDER BY p.proname;

-- 5) كشف التكرارات قبل إضافة unique index المطلوب لعملية upsert في الكود.
SELECT student_id, group_id, session_date, COUNT(*) AS duplicate_count,
       ARRAY_AGG(id ORDER BY id) AS record_ids
FROM public.daily_records
GROUP BY student_id, group_id, session_date
HAVING COUNT(*) > 1
ORDER BY session_date DESC;

-- 6) إحصاء الدفعات التاريخية التي لا يمكن تصنيفها تلقائيًا دون تخمين.
SELECT COUNT(*) AS payments_count,
       COALESCE(SUM(amount),0) AS net_amount
FROM public.student_payments;
