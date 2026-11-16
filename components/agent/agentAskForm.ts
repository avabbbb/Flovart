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

function attrLabel(element: Element | null): string {
  if (!element) return '';
  for (const attr of ['aria-label', 'title', 'data-label']) {
    const value = element.getAttribute(attr)?.replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
}

/** 组 / 控件的人话标题：legend → fieldset 的 aria-label/title/data-label → 控件自身的同名属性 → <label for> → name。 */
function groupLabel(control: Element, name: string): string {
  const fieldset = control.closest('fieldset');
  const legend = fieldset ? Array.from(fieldset.children).find(child => child.tagName === 'LEGEND') : undefined;
  const id = control.getAttribute('id');
  const forLabel = id ? Array.from(control.ownerDocument.querySelectorAll('label[for]')).find(label => label.getAttribute('for') === id) : undefined;
  return textOf(legend || null) || attrLabel(fieldset) || attrLabel(control) || textOf(forLabel || null) || name;
}

/** 标题是否只是回退成了控件 name（模型没给人话标题）。卡片据此弱化显示。 */
export function isFallbackLabel(field: Pick<AgentAskField, 'name' | 'label'>): boolean {
  return field.label === field.name;
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

// ---------------------------------------------------------------------------
// 结构化提问：模型给 questions[]，这里直接转成受控表单，不再让模型写 HTML。
// ---------------------------------------------------------------------------

export type AgentAskQuestionType = 'single' | 'multi' | 'text';

export interface AgentAskQuestionOption {
  /** 回传给模型的值；缺省用 label */
  value?: string;
  /** 选项标题；可以是一句完整方案，例如「15 秒竖屏 9:16，3 段，每段 5 秒」 */
  label: string;
  /** 方案细节，显示在标题后 */
  description?: string;
  /** 推荐项，默认选中 */
  recommended?: boolean;
}

export interface AgentAskQuestion {
  /** 回传 JSON 的键，如 duration、aspect_ratio */
  id: string;
  /** 中文问题 */
  question: string;
  /** single 单选（默认，有 options 时）/ multi 多选 / text 自由输入（无 options 时默认） */
  type?: AgentAskQuestionType;
  options?: AgentAskQuestionOption[];
  required?: boolean;
  placeholder?: string;
  /** text 时是否多行 */
  multiline?: boolean;
}

export interface AgentAskSpec {
  /** 卡片标题：为什么要问 */
  title?: string;
  /** 补充说明，每项一段 */
  context?: string[];
  questions: AgentAskQuestion[];
}

const MAX_OPTIONS = 8;
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** questions[] → AgentAskForm；校验 id 唯一、选项非空、推荐项预选（单选只认第一个推荐项）。 */
export function buildAgentAskForm(spec: AgentAskSpec): AgentAskParseResult {
  const questions = Array.isArray(spec?.questions) ? spec.questions : [];
  if (!questions.length) return { ok: false, error: 'questions 至少需要一个问题。' };
  if (questions.length > MAX_FIELDS) return { ok: false, error: '一次最多问 ' + MAX_FIELDS + ' 个问题。' };
  const context: string[] = [];
  const title = cleanText(spec.title);
  if (title) context.push(title);
  for (const item of spec.context || []) {
    const text = cleanText(item);
    if (text && !context.includes(text)) context.push(text);
    if (context.length >= MAX_CONTEXT_ITEMS) break;
  }
  const seen = new Set<string>();
  const fields: AgentAskField[] = [];
  for (const [index, question] of questions.entries()) {
    const id = cleanText(question?.id);
    const label = cleanText(question?.question);
    if (!ID_PATTERN.test(id)) return { ok: false, error: '第 ' + (index + 1) + ' 个问题的 id 需要是 1–40 位字母、数字、下划线。' };
    if (seen.has(id)) return { ok: false, error: '问题 id「' + id + '」重复。' };
    seen.add(id);
    if (!label) return { ok: false, error: '问题「' + id + '」缺少 question 文本。' };
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const type: AgentAskQuestionType = question.type ?? (rawOptions.length ? 'single' : 'text');
    const required = question.required ?? true;
    if (type === 'text') {
      const placeholder = cleanText(question.placeholder) || undefined;
      fields.push(question.multiline
        ? { kind: 'textarea', name: id, label, placeholder, required, value: '', rows: 3 }
        : { kind: 'text', name: id, label, inputType: 'text', placeholder, required, value: '' });
      continue;
    }
    if (!rawOptions.length) return { ok: false, error: '问题「' + id + '」是 ' + type + '，需要 options。' };
    if (rawOptions.length > MAX_OPTIONS) return { ok: false, error: '问题「' + id + '」最多 ' + MAX_OPTIONS + ' 个选项。' };
    const options: AgentAskOption[] = [];
    const values = new Set<string>();
    let recommendedTaken = false;
    for (const option of rawOptions) {
      const optionLabel = cleanText(option?.label);
      if (!optionLabel) return { ok: false, error: '问题「' + id + '」有空选项。' };
      const value = cleanText(option.value) || optionLabel;
      if (values.has(value)) return { ok: false, error: '问题「' + id + '」的选项「' + value + '」重复。' };
      values.add(value);
      const description = cleanText(option.description);
      const checked = Boolean(option.recommended) && (type === 'multi' || !recommendedTaken);
      if (checked) recommendedTaken = true;
      options.push({ value, label: description ? optionLabel + ' — ' + description : optionLabel, checked });
    }
    fields.push(type === 'multi'
      ? { kind: 'checkbox', name: id, label, required, options }
      : { kind: 'radio', name: id, label, required, options });
  }
  return { ok: true, form: { context, fields } };
}
