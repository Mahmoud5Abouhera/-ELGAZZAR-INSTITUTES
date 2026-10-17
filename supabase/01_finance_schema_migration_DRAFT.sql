-- مسودة migration للمراجعة فقط — لا تشغّلها قبل مراجعة نتائج 00_preflight_read_only.sql.
-- لا تتضمن ترحيل مصادقة/RLS الكامل، ولا تُعدّ هذه المسودة وحدها تصريحًا بالنشر.
BEGIN;

-- لا نضع default على payment_type عمدًا: لا يمكن استنتاج نوع الدفعات التاريخية بأمان.
ALTER TABLE public.student_payments
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS daily_record_id bigint REFERENCES public.daily_records(id) ON DELETE SET NULL;

-- نوع الدفعة للبيانات الجديدة فقط. تبقى السجلات القديمة NULL حتى تتم مراجعتها/تصنيفها.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='student_payments_payment_type_check') THEN
    ALTER TABLE public.student_payments
      ADD CONSTRAINT student_payments_payment_type_check
      CHECK (payment_type IS NULL OR payment_type IN ('current_session','old_debt'));
  END IF;
END $$;


CREATE INDEX IF NOT EXISTS student_payments_payment_date_idx
  ON public.student_payments(payment_date);
CREATE INDEX IF NOT EXISTS student_payments_type_date_idx
  ON public.student_payments(payment_type, payment_date);

-- daily_records upsert في الكود يتطلب uniqueness لهذا المفتاح.
-- يتوقف هذا الجزء إذا وُجدت تكرارات حتى لا نحذف/نختار سجلات ماليًا بالنيابة عنك.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.daily_records
    GROUP BY student_id, group_id, session_date
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate daily_records found for (student_id, group_id, session_date). Review duplicates before creating the unique index.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS daily_records_student_group_date_uidx
  ON public.daily_records(student_id, group_id, session_date);

-- سجل تعديل/حذف السجلات المعتمدة. record_id بلا FK عمدًا للاحتفاظ بسجل الحذف.
CREATE TABLE IF NOT EXISTS public.daily_record_edit_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id bigint NOT NULL,
  edited_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'update' CHECK (action IN ('update','delete')),
  edit_reason text NOT NULL CHECK (length(btrim(edit_reason)) > 0),
  old_values jsonb NOT NULL,
  new_values jsonb,
  outcome text NOT NULL DEFAULT 'requested' CHECK (outcome IN ('requested','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_record_edit_audit_record_idx
  ON public.daily_record_edit_audit(record_id, created_at DESC);

-- Fail-closed: لا توجد سياسات وصول للجدول الجديد في هذه المسودة.
-- لذلك عمليات audit من واجهة التطبيق سترفض حتى تُصمم سياسات آمنة مع Supabase Auth.
ALTER TABLE public.daily_record_edit_audit ENABLE ROW LEVEL SECURITY;

COMMIT;

-- تنبيه: لا تُصنّف payment_type التاريخي آليًا. راجع الدفعات القديمة يدويًا/بتقرير موثوق.
-- تنبيه: يجب ربط صلاحيات المدير بهوية موثوقة من Supabase Auth وRLS/RPC؛ role من localStorage قابل للتلاعب.
