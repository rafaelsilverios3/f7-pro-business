const ascii = (value, maxLength) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9 $%*+\-./:]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, maxLength);
const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

export function crc16ccitt(text) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildStaticPixPayload({ pixKey, receiver, city, amount, txid = '***' }) {
  const key = String(pixKey || '').trim();
  const merchant = ascii(receiver, 25);
  const merchantCity = ascii(city, 15);
  const transactionId = ascii(txid, 25) || '***';
  const value = Number(amount);
  if (!/^[\x21-\x7E]{1,77}$/.test(key)) throw new Error('Cadastre uma chave Pix válida da empresa, com caracteres ASCII imprimíveis.');
  if (!merchant) throw new Error('Informe o nome do recebedor para gerar o Pix.');
  if (!merchantCity) throw new Error('Informe a cidade do recebedor para gerar o Pix.');
  if (!Number.isFinite(value) || value <= 0 || value > 99999999999.99) throw new Error('O valor do Pix deve ser maior que zero e caber no padrão BR Code.');
  const pixAccount = field('00', 'BR.GOV.BCB.PIX') + field('01', key);
  const additional = field('05', transactionId);
  const payload = [field('00', '01'), field('01', '12'), field('26', pixAccount), field('52', '0000'), field('53', '986'), field('54', value.toFixed(2)), field('58', 'BR'), field('59', merchant), field('60', merchantCity), field('62', additional), '6304'].join('');
  return payload + crc16ccitt(payload);
}

