// omp 的 ask 契约：模型给一个 HTML <form>，宿主渲染表单并回传 JSON。
// 浏览器里不做 innerHTML，而是解析成受控字段；脚本/样式/按钮一律不执行。
export type AgentAskInputType = 'text' | 'number' | 'date' | 'email' | 'url';

export interface AgentAskOption {
  value: string;
  label: string;
  checked: boolean;
}

export type AgentAskField =
  | {
    kind: 'text'; name: string; label: string; inputType: AgentAskInputType;
    placeholder?: string; required: boolean; value: string; min?: string; max?: string; pattern?: string;
  }
  | { kind: 'textarea'; name: string; label: string; placeholder?: string; required: boolean; value: string; rows?: number }
  | { kind: 'select'; name: string; label: string; required: boolean; multiple: boolean; options: AgentAskOption[] }
  | { kind: 'radio'; name: string; label: string; required: boolean; options: AgentAskOption[] }
  | { kind: 'checkbox'; name: string; label: string; required: boolean; options: AgentAskOption[] };

export interface AgentAskForm {
  context: string[];
  fields: AgentAskField[];
}

export type AgentAskParseResult = { ok: true; form: AgentAskForm } | { ok: false; error: string };
export type AgentAskAnswers = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const CONTROL_SELECTOR = 'input, select, textarea';
const CONTEXT_SELECTOR = 'p, ul, ol, pre, h1, h2, h3, h4, h5, h6';
const MAX_CONTEXT_ITEMS = 8;
const MAX_FIELDS = 12;

function textOf(element: Element | null): string {
  return (element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function closestLabel(input: Element): string {
  const label = input.closest('label');
  if (!label) return '';
  const clone = label.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(CONTROL_SELECTOR).forEach(control => control.remove());
  return textOf(clone);
}

function groupLabel(control: Element, name: string): string {
  const fieldset = control.closest('fieldset');
  const legend = fieldset ? Array.from(fieldset.children).find(child => child.tagName === 'LEGEND') : undefined;
  return textOf(legend || null) || name;
}

/** 解析 form；只接受文本/数字/日期/选择类控件，忽略隐藏域、按钮和脚本。 */
export function parseAgentAskHtml(html: string): AgentAskParseResult {
  if (typeof DOMParser === 'undefined') return { ok: false, error: '当前环境无法解析表单。' };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const form = doc.querySelector('form');
  if (!form) return { ok: false, error: 'html 里需要一个 <form>。' };
  form.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());

  const context: string[] = [];
  for (const node of Array.from(form.querySelectorAll(CONTEXT_SELECTOR))) {
    if (node.querySelector(CONTROL_SELECTOR)) continue;
    if (node.closest('label')) continue;
    const text = textOf(node);
    if (text && !context.includes(text)) context.push(text);
    if (context.length >= MAX_CONTEXT_ITEMS) break;
  }

  const fields: AgentAskField[] = [];
  const groupIndex = new Map<string, number>();
  for (const control of Array.from(form.querySelectorAll(CONTROL_SELECTOR))) {
    if (fields.length >= MAX_FIELDS) break;
    const name = control.getAttribute('name')?.trim() || '';
    if (!name) continue;
    const tag = control.tagName.toLowerCase();
    const type = (control.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'input' && ['button', 'submit', 'reset', 'hidden', 'file', 'image'].includes(type)) continue;
    if (tag === 'input' && type === 'radio') {
      const existing = groupIndex.get('r:' + name);
      if (existing !== undefined) {
        const field = fields[existing];
        if (field.kind === 'radio') field.options.push({ value: control.getAttribute('value') ?? 'on', label: closestLabel(control) || control.getAttribute('value') || '选项', checked: control.hasAttribute('checked') });
        continue;
      }
      groupIndex.set('r:' + name, fields.length);
      fields.push({ kind: 'radio', name, label: groupLabel(control, name), required: control.hasAttribute('required'), options: [{ value: control.getAttribute('value') ?? 'on', label: closestLabel(control) || control.getAttribute('value') || '选项', checked: control.hasAttribute('checked') }] });
      continue;
    }
    if (tag === 'input' && type === 'checkbox') {
      const existing = groupIndex.get('c:' + name);
      if (existing !== undefined) {
        const field = fields[existing];
        if (field.kind === 'checkbox') field.options.push({ value: control.getAttribute('value') ?? 'on', label: closestLabel(control) || control.getAttribute('value') || '选项', checked: control.hasAttribute('checked') });
        continue;
      }
      groupIndex.set('c:' + name, fields.length);
      fields.push({ kind: 'checkbox', name, label: groupLabel(control, name), required: control.hasAttribute('required'), options: [{ value: control.getAttribute('value') ?? 'on', label: closestLabel(control) || control.getAttribute('value') || '选项', checked: control.hasAttribute('checked') }] });
      continue;
    }
    if (tag === 'select') {
      const multiple = control.hasAttribute('multiple');
      const options = Array.from(control.querySelectorAll('option')).map(option => ({
        value: option.getAttribute('value') ?? textOf(option),
        label: textOf(option) || option.getAttribute('value') || '选项',
        checked: option.hasAttribute('selected'),
      }));
      if (!options.length) continue;
      fields.push({ kind: 'select', name, label: groupLabel(control, name), required: control.hasAttribute('required'), multiple, options });
      continue;
    }
    if (tag === 'textarea') {
      fields.push({
        kind: 'textarea',
        name,
        label: closestLabel(control) || groupLabel(control, name),
        placeholder: control.getAttribute('placeholder') || undefined,
        required: control.hasAttribute('required'),
        value: control.textContent || '',
        rows: Math.min(8, Math.max(2, Number(control.getAttribute('rows')) || 3)),
      });
      continue;
    }
    if (tag === 'input') {
      const inputType: AgentAskInputType = ['number', 'date', 'email', 'url'].includes(type) ? type as AgentAskInputType : 'text';
      fields.push({
        kind: 'text',
        name,
        label: closestLabel(control) || groupLabel(control, name),
        inputType,
        placeholder: control.getAttribute('placeholder') || undefined,
        required: control.hasAttribute('required'),
        value: control.getAttribute('value') || '',
        min: control.getAttribute('min') || undefined,
        max: control.getAttribute('max') || undefined,
        pattern: control.getAttribute('pattern') || undefined,
      });
    }
  }

  if (!fields.length) return { ok: false, error: '表单里至少需要一个带 name 的文本/选择控件。' };
  return { ok: true, form: { context, fields } };
}

export function collectAgentAskAnswers(
  form: AgentAskForm,
  values: Readonly<Record<string, string | string[]>>,
  other: Readonly<Record<string, string>> = {},
): AgentAskAnswers {
  const data: Record<string, unknown> = {};
  for (const field of form.fields) {
    const value = values[field.name];
    const extra = (other[field.name] || '').trim();
    if (field.kind === 'checkbox') {
      const picked = Array.isArray(value) ? value.filter(Boolean) : [];
      if (extra) picked.push(extra);
      if (!picked.length && field.required) return { ok: false, error: '请选择「' + field.label + '」。' };
      if (picked.length) data[field.name] = picked;
      continue;
    }
    if (field.kind === 'select' && field.multiple) {
      const picked = Array.isArray(value) ? value.filter(Boolean) : [];
      if (!picked.length && field.required) return { ok: false, error: '请选择「' + field.label + '」。' };
      if (picked.length) data[field.name] = picked;
      continue;
    }
    const single = typeof value === 'string' ? value.trim() : '';
    // 单选/下拉的 Other 优先于仍留在控件里的预选项；checkbox 的 Other 已追加。
    const answer = extra || single;
    if (!answer) {
      if (field.required) return { ok: false, error: '请填写「' + field.label + '」。' };
      continue;
    }
    if (field.kind === 'radio' || field.kind === 'select') {
      data[field.name] = answer;
    } else if (field.kind === 'text' && field.inputType === 'number') {
      const number = Number(answer);
      if (!Number.isFinite(number)) return { ok: false, error: '「' + field.label + '」需要数字。' };
      data[field.name] = number;
    } else {
      data[field.name] = answer;
    }
  }
  return { ok: true, data };
}
