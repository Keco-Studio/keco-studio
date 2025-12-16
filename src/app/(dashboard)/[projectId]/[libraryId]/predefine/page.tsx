'use client';

import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';

type FieldType = 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date';

type FieldConfig = {
  id: string;
  label: string;
  dataType: FieldType;
  required: boolean;
  enumOptions?: string[];
};

type SectionConfig = {
  id: string;
  name: string;
  fields: FieldConfig[];
};

const fieldSchema = z.object({
  label: z.string().trim().min(1, 'Label is required'),
  dataType: z.enum(['string', 'int', 'float', 'boolean', 'enum', 'date']),
  required: z.boolean(),
  enumOptions: z.array(z.string().trim().min(1)).optional(),
});

const sectionSchema = z.object({
  name: z.string().trim().min(1, 'Section name is required'),
  fields: z.array(fieldSchema).min(1, 'At least one field'),
});

function uid() {
  return Math.random().toString(16).slice(2, 10);
}

export default function PredefinePage() {
  const supabase = useSupabase();
  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;

  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [draftSection, setDraftSection] = useState<{ name: string }>({ name: '' });
  const [draftField, setDraftField] = useState<Omit<FieldConfig, 'id'>>({
    label: '',
    dataType: 'string',
    required: false,
    enumOptions: [],
  });
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) || null,
    [sections, activeSectionId]
  );

  const resetField = () =>
    setDraftField({
      label: '',
      dataType: 'string',
      required: false,
      enumOptions: [],
    });

  const addSection = () => {
    const parse = sectionSchema.pick({ name: true }).safeParse({ name: draftSection.name });
    if (!parse.success) {
      setErrors(parse.error.issues.map((i) => i.message));
      return;
    }
    const id = uid();
    const next: SectionConfig = { id, name: draftSection.name.trim(), fields: [] };
    setSections((prev) => [...prev, next]);
    setActiveSectionId(id);
    setDraftSection({ name: '' });
    setErrors([]);
  };

  const addField = () => {
    if (!activeSection) {
      setErrors(['请先选择一个 Section']);
      return;
    }

    const payload = {
      ...draftField,
      enumOptions:
        draftField.dataType === 'enum'
          ? (draftField.enumOptions || []).filter((v) => v.trim().length > 0)
          : undefined,
    };

    const parsed = fieldSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    const field: FieldConfig = {
      id: uid(),
      ...parsed.data,
    };

    setSections((prev) =>
      prev.map((s) =>
        s.id === activeSection.id
          ? {
              ...s,
              fields: [...s.fields, field],
            }
          : s
      )
    );
    resetField();
    setErrors([]);
  };

  const removeField = (sectionId: string, fieldId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s
      )
    );
  };

  const removeSection = (sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    if (activeSectionId === sectionId) {
      setActiveSectionId(null);
    }
  };

  const saveSchema = () => {
    if (!libraryId) {
      setErrors(['缺少 libraryId，无法保存']);
      return;
    }

    const parsed = z.array(sectionSchema).safeParse(
      sections.map((s) => ({
        name: s.name,
        fields: s.fields.map((f) => ({
          label: f.label,
          dataType: f.dataType,
          required: f.required,
          enumOptions: f.enumOptions,
        })),
      }))
    );
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    const payload = sections.flatMap((section, sectionIdx) =>
      section.fields.map((field, fieldIdx) => ({
        library_id: libraryId,
        section: section.name,
        label: field.label,
        data_type: field.dataType,
        enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
        required: field.required,
        order_index: sectionIdx * 1000 + fieldIdx, // 粗略顺序；可改更精细的排序逻辑
      }))
    );

    const persist = async () => {
      setSaving(true);
      setSaveResult(null);
      setErrors([]);
      try {
        // 先清空当前 library 的定义，再写入新的
        const { error: delErr } = await supabase
          .from('library_field_definitions')
          .delete()
          .eq('library_id', libraryId);
        if (delErr) throw delErr;

        if (payload.length > 0) {
          const { error: insErr } = await supabase.from('library_field_definitions').insert(payload);
          if (insErr) throw insErr;
        }

        setSaveResult('保存成功');
      } catch (e: any) {
        setErrors([e?.message || '保存失败']);
      } finally {
        setSaving(false);
      }
    };

    void persist();
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px', padding: '16px' }}>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#fff' }}>
        <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>Sections</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            style={{ flex: 1, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}
            placeholder="Section name"
            value={draftSection.name}
            onChange={(e) => setDraftSection({ name: e.target.value })}
          />
          <button onClick={addSection} style={{ padding: '8px 12px', borderRadius: 6 }}>
            Add
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sections.map((section) => (
            <div
              key={section.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 6,
                border: activeSectionId === section.id ? '1px solid #4f46e5' : '1px solid #e5e7eb',
                cursor: 'pointer',
              }}
              onClick={() => setActiveSectionId(section.id)}
            >
              <span>{section.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeSection(section.id);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#dc2626',
                  cursor: 'pointer',
                }}
                aria-label="Remove section"
              >
                ×
              </button>
            </div>
          ))}
          {sections.length === 0 && <div style={{ color: '#94a3b8' }}>No sections yet.</div>}
        </div>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            {activeSection ? `Fields in "${activeSection.name}"` : 'Select a section'}
          </h3>
          <button
            onClick={saveSchema}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              background: '#4f46e5',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Schema'}
          </button>
        </div>

        {errors.length > 0 && (
          <div
            style={{
              marginTop: 8,
              marginBottom: 12,
              padding: 10,
              borderRadius: 6,
              background: '#fef2f2',
              color: '#b91c1c',
            }}
          >
            {errors.map((err, idx) => (
              <div key={idx}>{err}</div>
            ))}
          </div>
        )}
        {saveResult && (
          <div
            style={{
              marginTop: 8,
              marginBottom: 12,
              padding: 10,
              borderRadius: 6,
              background: '#ecfdf3',
              color: '#166534',
            }}
          >
            {saveResult}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginTop: 12,
            padding: 12,
            border: '1px dashed #cbd5e1',
            borderRadius: 8,
          }}
        >
          <input
            placeholder="Label"
            value={draftField.label}
            onChange={(e) => setDraftField((p) => ({ ...p, label: e.target.value }))}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
          />
          <select
            value={draftField.dataType}
            onChange={(e) =>
              setDraftField((p) => ({
                ...p,
                dataType: e.target.value as FieldType,
                enumOptions: e.target.value === 'enum' ? p.enumOptions ?? [] : undefined,
              }))
            }
            style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
          >
            <option value="string">String</option>
            <option value="int">Int</option>
            <option value="float">Float</option>
            <option value="boolean">Boolean</option>
            <option value="enum">Enum</option>
            <option value="date">Date</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={draftField.required}
              onChange={(e) => setDraftField((p) => ({ ...p, required: e.target.checked }))}
            />
            Required
          </label>
          {draftField.dataType === 'enum' && (
            <input
              placeholder="Enum options (comma separated)"
              value={(draftField.enumOptions || []).join(',')}
              onChange={(e) =>
                setDraftField((p) => ({
                  ...p,
                  enumOptions: e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter((v) => v.length > 0),
                }))
              }
              style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          )}
          <button
            onClick={addField}
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #4f46e5',
              color: '#4f46e5',
              cursor: 'pointer',
              background: '#f8fafc',
            }}
          >
            Add Field
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          {activeSection && activeSection.fields.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeSection.fields.map((field) => (
                <div
                  key={field.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 140px 100px 80px',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{field.label}</div>
                  <div style={{ color: '#475569' }}>{field.dataType}</div>
                  <div style={{ color: field.required ? '#dc2626' : '#94a3b8' }}>
                    {field.required ? 'Required' : 'Optional'}
                  </div>
                  <button
                    onClick={() => removeField(activeSection.id, field.id)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#dc2626',
                      cursor: 'pointer',
                    }}
                    aria-label="Remove field"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#94a3b8' }}>
              {activeSection ? 'No fields yet.' : 'Select a section to start adding fields.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


