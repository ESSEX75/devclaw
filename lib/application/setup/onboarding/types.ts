/** Contracts owned by setup onboarding. */

import type { ValueOf } from "../../../types.js";
import type { ONBOARDING_MODE } from "./const.js";

/** Selected onboarding scenario. */
export type OnboardingMode = ValueOf<typeof ONBOARDING_MODE>;
