# pi-tools

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [scribe](extensions/scribe/) | Capture durable engineering decisions and conventions from recent conversation turns. |

## Skills

| Skill | Description |
|-------|-------------|
| _TBD_ | _TBD_ |

## Install (pi package manager)

```bash
pi install git:github.com/timsvoice/pi-tools
```

To enable only a subset, replace the package entry in `~/.pi/agent/settings.json` with a filtered one:

```json
{
  "packages": [
    {
      "source": "git:github.com/timsvoice/pi-tools",
      "extensions": ["extensions/scribe/index.ts"]
    }
  ]
}
```

## Quick Setup

If you keep a local clone, add extensions to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-tools/extensions/scribe"
  ]
}
```

See each extension's README for details.
