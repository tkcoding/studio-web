# assistant-mfe

Studio AI, the built-in kit `assistant` (ADR-0068 §7): the old prototype's
`studio-ai.tsx`, the assistant docked to the right edge of the shell.

- One extension in the **sidebar** domain (`presentation.kit: "assistant"`).
  The shell's `layout/KitDock.tsx` mounts it only while the kit is installed
  where the person is, and never over the editor.
- It answers through studio-llm-proxy on the person's own key
  (`/cf/studio-llm/v1/[workspaces/{id}/]client-config` and
  `…/chat/completions`, streamed). No key: the server's sentence saying where
  to add one, and no composer.
- The thread lives in the panel; nothing is stored. Model, tool and message
  types arrive with ADR-0070 phase 8, not here.
