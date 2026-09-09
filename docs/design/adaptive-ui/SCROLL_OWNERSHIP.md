# Scroll ownership

| Surface | Primary scroll owner | Secondary scroll region | Body scroll |
| --- | --- | --- | --- |
| AppShell / Studio | active workspace | none | disabled while shell is mounted |
| Workflow canvas | internal pan/zoom surface | sidebar/drawer content | disabled |
| Workflow sidebar | layers/assets list | asset menu/popover | disabled |
| Workflow right drawer | active tab content | history list / Agent messages | disabled |
| Table | source list or preview tools | tool list | disabled |
| Agent | context body or conversation messages | session/artifact lists | disabled |
| Settings dialog | detail body | tab strip and provider/model lists | disabled |
| Onboarding / Modal | dialog body | folder/model lists | disabled |
| Home / Community / Enterprise pages | page content | local tables/cards | shell decides |

Nested scrolling is intentional only when the cell itself is a data list or a canvas-local interaction surface. New components must document their owner before adding `overflow: auto`.
