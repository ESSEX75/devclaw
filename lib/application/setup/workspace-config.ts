/** Coordinates explicit configuration resets and read-only workflow comparisons. */
import { type DefaultsScope, readWorkflowDocuments, resetWorkspaceConfiguration } from "../../state/index.js";

/** Reset the selected default files while preserving project runtime state.
 * @param workspacePath - Target workspace.
 * @param scope - Validated reset selection.
 */
export async function resetWorkspaceConfig(workspacePath: string, scope: DefaultsScope): Promise<string[]> {
  return (await resetWorkspaceConfiguration(workspacePath, scope)).written;
}

/** Compare workspace configuration to packaged defaults without writes.
 * @param workspacePath - Target workspace.
 */
export async function compareWorkspaceConfig(workspacePath: string): Promise<{ missing: boolean; differences: string[] }> {
  const { current, template } = await readWorkflowDocuments(workspacePath);

  if (current === null) return { missing: true, differences: [] };
  if (current.trim() === template.trim()) return { missing: false, differences: [] };
  const currentLines = current.split("\n");
  const templateLines = template.split("\n");
  const differences: string[] = [];

  for (let i = 0; i < Math.max(currentLines.length, templateLines.length); i++) {
    const existing = currentLines[i] ?? "";
    const expected = templateLines[i] ?? "";

    if (existing === expected) continue;
    if (existing) differences.push(`-${i + 1}: ${existing}`);
    if (expected) differences.push(`+${i + 1}: ${expected}`);
  }

  return { missing: false, differences };
}
