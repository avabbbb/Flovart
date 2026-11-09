import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMarkdown, parseAgentMarkdown } from '../components/workflow/AgentMarkdown';
import { WorkflowAgentMessages } from '../components/workflow/WorkflowAgentMessages';

const STAR = String.fromCharCode(42);
const TICK = String.fromCharCode(96);
const LBRACKET = String.fromCharCode(91);
const FENCE = TICK.repeat(3);
const EL = 'agent-md' + '_'.repeat(2);
const SITE = 'https:/' + '/example.com';

describe('AgentMarkdown', () => {
  it('parses headings, lists, code fences and tables', () => {
    const source = ['## 结果', '', '- 第一项', '- 第二项', '', '1. 步骤', '2. 再一步', '', FENCE + 'ts', 'const a = 1;', FENCE, '', '| 名称 | 值 |', '| :-- | --: |', '| a | 1 |'].join('\n');
    expect(parseAgentMarkdown(source).map(block => block.kind)).toEqual(['heading', 'list', 'list', 'code', 'table']);
  });

  it('renders inline code, bold and only safe links', () => {
    const text = '用 ' + TICK + 'npm i' + TICK + ' 安装，' + STAR + STAR + '重要' + STAR + STAR + '，见 ' + LBRACKET + '文档](' + SITE + ') 与 ' + LBRACKET + '坏链](javascript:alert(1))';
    const html = renderToStaticMarkup(<AgentMarkdown text={text} />);
    expect(html).toContain('<code class="' + EL + 'inline-code">npm i</code>');
    expect(html).toContain('<strong>重要</strong>');
    expect(html).toContain('href="' + SITE + '"');
    expect(html).not.toContain('href="javascript');
  });

  it('keeps snake_case identifiers intact', () => {
    const html = renderToStaticMarkup(<AgentMarkdown text="call update_node_params now" />);
    expect(html).toContain('update_node_params');
    expect(html).not.toContain('<em>');
  });

  it('renders code blocks with language label and copy button, even when unclosed', () => {
    const html = renderToStaticMarkup(<AgentMarkdown text={FENCE + 'ts\nconst a = 1;'} />);
    expect(html).toContain(EL + 'code');
    expect(html).toContain('<span>ts</span>');
    expect(html).toContain('复制');
    expect(html).toContain('const a = 1;');
  });

  it('renders markdown only for agent messages', () => {
    const html = renderToStaticMarkup(<WorkflowAgentMessages messages={[{ id: 'u', role: 'user', text: '# 不是标题' }, { id: 'a', role: 'assistant', text: '# 标题' }]} />);
    expect(html).toContain('<p># 不是标题</p>');
    expect(html).toContain(EL + 'h1');
  });
});
