# Node Type: text

Text elements are for canvas notes, scripts, shot descriptions, template instructions, and QA comments.

The project rule says external agent canvas automation is media-first. Use text elements only when documenting canvas structure or when the user explicitly wants scripts/storyboards visible on the canvas.

## Create Text Element

```bash
npm run flovart:cli -- element.create --type text --name "story-outline" --x 420 --y 120 --width 360 --height 220 --json
```

## Update Text Content

```bash
npm run flovart:cli -- canvas.update-element --id <text-id> --updates-json "{\"text\":\"Hook: the intern can see the first lie each coworker will tell today.\"}" --json
```

## Use Cases

- `brief`: original user requirement.
- `story-outline`: high-level story.
- `script`: dialogue and action.
- `unit-list`: shot/unit table.
- `qa-notes`: failed nodes, retry strategy, human review notes.

Do not put API keys or secrets in text elements.
