/** The renderer can navigate only within this workspace. */
export const isAppRoute = (route: unknown): route is string => typeof route === 'string' &&
  (['', '/meetings', '/chat', '/trash', '/settings', '/projects'].includes(route) || /^\/(?:note|chat|folder)\/[\w-]+$/.test(route)
    || /^\/project\/[\w-]+$/.test(route))
