export function hasInternalServiceAuthorization(req: Request, serviceKey: string) {
  return Boolean(serviceKey && req.headers.get('authorization') === `Bearer ${serviceKey}`);
}
