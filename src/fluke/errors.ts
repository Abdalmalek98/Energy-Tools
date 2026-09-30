export class FlukeError extends Error {
  constructor(message: string, public signature?: string, public kind: 'binary' | 'format' | 'empty' = 'format') {
    super(message);
  }
}

export function signatureOf(bytes: Uint8Array): string {
  const n = Math.min(16, bytes.length);
  const hex = Array.from(bytes.subarray(0, n)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(bytes.subarray(0, n)).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
  return `${hex}  |${ascii}|`;
}

export function binaryMessage(signature: string): string {
  return [
    'This file appears to be a closed binary format.',
    '',
    'Please open it in Energy Analyze Plus and use:',
    '',
    'Export → CSV',
    '',
    'Include:',
    '- Date/Time',
    '- Total Active Power Average',
    '- Active Energy',
    '',
    `File signature: ${signature}`,
  ].join('\n');
}
