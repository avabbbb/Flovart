import workbuddySkill from '../integrations/workbuddy/iris/skills/iris/SKILL.md?raw';
import workflowReference from '../integrations/workbuddy/iris/skills/iris/references/workflow.md?raw';
import connectorMeta from '../integrations/workbuddy/iris/connector-meta.json?raw';
import cliConfig from '../integrations/workbuddy/iris/cli.json?raw';
import icon from '../integrations/workbuddy/iris/icon.svg?raw';

export async function createWorkBuddySkillPackage(): Promise<Blob> {
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const archive = new ZipWriter(new BlobWriter('application/zip'));
  const files = {
    'connector-meta.json': connectorMeta,
    'cli.json': cliConfig,
    'icon.svg': icon,
    'skills/iris/SKILL.md': workbuddySkill,
    'skills/iris/references/workflow.md': workflowReference,
  };
  for (const [path, content] of Object.entries(files)) {
    await archive.add(`iris-workbuddy/${path}`, new TextReader(content));
  }
  return archive.close();
}
