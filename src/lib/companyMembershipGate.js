/** Keep pending, failed, inactive, and authorized membership states distinct. */
export function companyMembershipGateState(membership, companyId) {
  if (membership?.loading || (companyId && membership?.companyId !== companyId)) return 'loading';
  if (membership?.error) return 'error';
  if (!membership?.active || !membership?.role) return 'inactive';
  return 'active';
}
