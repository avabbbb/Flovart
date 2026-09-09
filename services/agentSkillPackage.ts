import workbuddySkill from '../integrations/workbuddy/flovart/skills/flovart/SKILL.md?raw';
import workflowReference from '../integrations/workbuddy/flovart/skills/flovart/references/workflow.md?raw';
import connectorMeta from '../integrations/workbuddy/flovart/connector-meta.json?raw';
import cliConfig from '../integrations/workbuddy/flovart/cli.json?raw';
import icon from '../integrations/workbuddy/flovart/icon.svg?raw';

export async function createWorkBuddySkillPackage(): Promise<Blob> {
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const archive = new ZipWriter(new BlobWriter('application/zip'));
  const files = {
    'connector-meta.json': connectorMeta,
    'cli.json': cliConfig,
    'icon.svg': icon,
    'skills/flovart/SKILL.md': workbuddySkill,
    'skills/flovart/references/workflow.md': workflowReference,
  };
  for (const [path, content] of Object.entries(files)) {
    await archive.add(`flovart-workbuddy/${path}`, new TextReader(content));
  }
  return archive.close();
}
