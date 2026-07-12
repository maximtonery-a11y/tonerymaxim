export function getAdminAccessKey(locals?: any): string {
  const runtime = locals?.runtime?.env || {};
  return String(
    runtime.TM_ANALYTICS_ADMIN_KEY ||
    runtime.ADMIN_API_SECRET ||
    process.env.TM_ANALYTICS_ADMIN_KEY ||
    process.env.ADMIN_API_SECRET ||
    import.meta.env.TM_ANALYTICS_ADMIN_KEY ||
    import.meta.env.ADMIN_API_SECRET ||
    ''
  ).trim();
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
