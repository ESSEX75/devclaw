/**
 * testing/ — Test infrastructure for DevClaw integration tests.
 *
 * Exports:
 * - TestProvider: In-memory IssueProvider with call tracking
 * - createTestHarness: Scaffolds temp workspace + mock runCommand
 */
export {
  type BootstrapResult,
  type CapturedCommand,
  type CommandInterceptor,
  createTestHarness,
  type HarnessOptions,
  type TestHarness,
} from "./harness.js";
export { type ProviderCall,TestProvider } from "./test-provider.js";
