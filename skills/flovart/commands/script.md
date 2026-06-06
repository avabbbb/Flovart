# Script Commands

Script commands convert planning text into canvas structure.

## script.storyboard

Create storyboard image nodes from script text.

```bash
npm run flovart:cli -- script.storyboard --script "A founder opens the box. The product lights up." --count 2 --group Storyboard --json
```

Use a script text node:

```bash
npm run flovart:cli -- script.storyboard --script-node <textNodeId> --count 6 --group Storyboard --json
```

Behavior:

- Splits script text into shot lines.
- Creates image nodes named `storyboard-01`, `storyboard-02`, and so on.
- Writes explicit keyframe prompts into each image node.
- If `--group` is provided, creates/uses that group first so generated storyboard nodes inherit the active group.

After review, run individual nodes:

```bash
npm run flovart:cli -- node run <storyboardNodeId> --json
```
