export function permissionsPolicy(pathname: string) {
  const camera = /^\/hladat-fotkou\/?$/.test(pathname) ? '(self)' : '()';
  return `camera=${camera}, microphone=(), geolocation=(), payment=(self)`;
}
