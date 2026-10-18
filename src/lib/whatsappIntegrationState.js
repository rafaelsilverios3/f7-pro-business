export function getWhatsAppIntegrationState(health, integration) {
  const providerEnabled = health?.provider_enabled === true;
  const connected = integration?.status === 'connected' || health?.status === 'connected';

  let status = 'pending';
  if (health?.provider_enabled === false) status = 'disabled';
  else if (connected) status = 'connected';
  else if (providerEnabled) status = integration?.status || 'not_configured';

  return { providerEnabled, connected, status };
}
