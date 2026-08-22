export const ONBOARDING_PATH = '/onboarding'
export const ONBOARDING_POLICY_PATH = '/onboarding/policy'
export const onboardingBuilderPath = (draftId: string): string => `${ONBOARDING_PATH}/draft/${draftId}`

export const isOnboardingPath = (path: string): boolean =>
  path === ONBOARDING_PATH || path.startsWith(`${ONBOARDING_PATH}/`)
