/** The renderer can navigate only within this workspace. */
export const isAppRoute = (route: unknown): route is string => typeof route === 'string' &&
  (['', '/meetings', '/chat', '/trash', '/settings', '/projects'].includes(route) || /^\/(?:note|chat|folder)\/[\w-]+$/.test(route)
    // a Markdown file in the workspace folder, as encodeURIComponent writes its path
    || /^\/file\/[A-Za-z0-9%._~!*'()-]+$/.test(route))
