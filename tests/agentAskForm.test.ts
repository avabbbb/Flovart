import { describe, expect, it } from 'vitest';
import { collectAgentAskAnswers, parseAgentAskHtml } from '../components/agent/agentAskForm';

const html = `<form>
  <p>需要你确认两项：名称和风格。</p>
  <label>名称 <input name="name" value="海报" required></label>
  <fieldset>
    <legend>风格</legend>
    <label><input type="radio" name="style" value="fresh" checked> 清新</label>
    <label><input type="radio" name="style" value="cinema"> 电影感</label>
  </fieldset>
  <fieldset>
    <legend>附加项</legend>
    <label><input type="checkbox" name="extras" value="hd" checked> 高清</label>
    <label><input type="checkbox" name="extras" value="gif"> GIF</label>
  </fieldset>
  <select name="ratio"><option value="1:1">方图</option><option value="16:9" selected>横图</option></select>
  <label>备注 <textarea name="note">第一行</textarea></label>
  <label>数量 <input type="number" name="count" value="3"></label>
</form>`;

describe('agent ask form', () => {
  it('parses named controls and context without executing markup', () => {
    const parsed = parseAgentAskHtml(html);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.form.context).toContain('需要你确认两项：名称和风格。');
    expect(parsed.form.fields.map(field => [field.name, field.kind])).toEqual([
      ['name', 'text'], ['style', 'radio'], ['extras', 'checkbox'], ['ratio', 'select'], ['note', 'textarea'], ['count', 'text'],
    ]);
    const styleField = parsed.form.fields.find(field => field.name === 'style');
    expect(styleField).toMatchObject({ label: '风格' });
    if (styleField?.kind !== 'radio') throw new Error('style should be a radio group');
    expect(styleField.options).toHaveLength(2);
    expect(styleField.options[0]).toMatchObject({ value: 'fresh', checked: true });
    expect(parsed.form.fields.find(field => field.name === 'count')).toMatchObject({ inputType: 'number' });
  });

  it('collects radio, checkbox, number and Other answers', () => {
    const parsed = parseAgentAskHtml(html);
    if ('error' in parsed) throw new Error(parsed.error);
    const result = collectAgentAskAnswers(parsed.form, {
      name: '海报', style: '', extras: ['hd'], ratio: '16:9', note: '第一行', count: '3',
    }, { style: '自定义风格' });
    expect(result).toEqual({ ok: true, data: {
      name: '海报', style: '自定义风格', extras: ['hd'], ratio: '16:9', note: '第一行', count: 3,
    } });
  });

  it('rejects a missing required field and a non-numeric number', () => {
    const parsed = parseAgentAskHtml(html);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(collectAgentAskAnswers(parsed.form, { name: '', style: 'fresh', extras: ['hd'] })).toMatchObject({ ok: false });
    expect(collectAgentAskAnswers(parsed.form, { name: '海报', style: 'fresh', count: 'x' })).toMatchObject({ ok: false });
  });

  it('rejects a form without named controls', () => {
    expect(parseAgentAskHtml('<form><p>hello</p></form>')).toMatchObject({ ok: false });
    expect(parseAgentAskHtml('<p>no form</p>')).toMatchObject({ ok: false });
  });
});
