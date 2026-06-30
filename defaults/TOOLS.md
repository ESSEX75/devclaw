# TOOLS.md - DevClaw Tools

All DevClaw tools are registered as OpenClaw plugin tools. Use the tool schemas for parameter details.

## Config management

DevClaw config files (workflow.yaml, prompts) are **write-once**: created on first setup, never overwritten on restart. Your customizations are always preserved.

## Project-specific overrides

To override tool behavior for a specific project, create prompt files in:
`devclaw/projects/<name>/prompts/<role>.md`
