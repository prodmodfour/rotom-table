export const routeParamAsString = (value: unknown): string => String(value ?? '')

export const routeSlugParam = (params: { slug?: unknown }): string => routeParamAsString(params.slug)
