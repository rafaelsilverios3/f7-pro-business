export function resolvePublicAppUrl(configuredUrl, hostname = '') {
  const normalizedHost = String(hostname).trim().toLowerCase();
  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost.endsWith('.vercel.app')) {
    return '/login';
  }

  return configuredUrl || '/login';
}
