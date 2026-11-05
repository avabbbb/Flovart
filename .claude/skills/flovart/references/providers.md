# AI services (Providers)

Generation runs through AI services the user adds in Flovart Settings. The
browser stores the keys encrypted; the local Agent keeps a masked mirror so
`flovart provider.status --json` can report them. You never handle a key.

## Routes

| Need | Default model | Service that can serve it | Provider id in `provider.status` | Variable name in a key file |
| --- | --- | --- | --- | --- |
| Image | `flovart:gpt-image-2` | OpenAI | `openai` | `OPENAI_API_KEY` |
| Image, text | `gemini-3-flash-preview` (text) | Google Gemini | `google` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Video (Seedance 2.0) | `flovart:seedance-2` | Volcengine Ark | `volcengine` | `ARK_API_KEY` or `VOLCENGINE_API_KEY` |
| Video (Seedance 2.0), ComfyUI workflows | `flovart:seedance-2` | RunningHub | `runningHub` | `RUNNINGHUB_API_KEY` |
| Text | — | Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |

Seedance 2.0 is ready when `volcengine` or `runningHub` is listed. The models
in use are chosen in Flovart Settings; `flovart doctor --json` shows the
current selection.

## What to tell the user

Name the one service the task needs, then give them the three ways to add it,
all in Flovart Settings, in the API keys section:

1. Type or paste the key into the add form.
2. Click **导入 / Import** and choose a `.env` or `.txt` file. Each line is
   either `NAME=value` with a variable name from the table, or one key on its
   own. Lines starting with `#` and non-key variables such as base URLs are
   ignored.
3. Copy the key, then click **从剪贴板粘贴 / Paste from clipboard**.

Keys whose service cannot be recognised, and keys already added, are skipped
and counted in the import message.

You may offer to create an empty template for option 2, for example a file
the user names containing:

```text
# Fill in the keys you have, then import this file in Flovart Settings.
ARK_API_KEY=
OPENAI_API_KEY=
```

Write only empty values. Never open, read, copy or delete that file after the
user fills it in, and never ask them to paste a key into the conversation.

## Verify

After the user says they added it, run `flovart provider.status --json` and
check that the provider id is listed and `ready` is true. Tell the user it is
set up by service name; never repeat a masked value.

## Retired commands

`provider.begin-setup`, `provider.select-model` and `provider.test` are
retired and return `COMMAND_RETIRED`. Do not call them; use Settings and
`provider.status` as above.
