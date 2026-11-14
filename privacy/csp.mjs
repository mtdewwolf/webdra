/**
 * Single source of truth for Webdra's Content-Security-Policy.
 * The meta tag cannot express frame-ancestors; the HTTP header can.
 * worker-src is 'self' only. Production workers are same-origin module scripts.
 * img-src is 'self' only. The UI does not render data: or blob: images.
 */

/** @type {[string, string[]][]} */
export const sharedDirectives = [
  ['default-src', ["'none'"]],
  ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
  ['connect-src', ["'self'"]],
  ['img-src', ["'self'"]],
  ['worker-src', ["'self'"]],
  ['style-src', ["'self'"]],
  ['font-src', ["'self'"]],
  ['manifest-src', ["'self'"]],
  ['form-action', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['object-src', ["'none'"]],
  ['frame-src', ["'none'"]],
];

/** @param {[string, string[]][]} directives */
export function serializeCsp(directives) {
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

export const metaCsp = serializeCsp(sharedDirectives);

export const headerCsp = serializeCsp([
  ...sharedDirectives,
  ['frame-ancestors', ["'none'"]],
]);

export const extraHeaders = {
  'Content-Security-Policy': headerCsp,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
};

export function renderHeadersFile() {
  const lines = [
    '/*',
    '  # Strict-Transport-Security is for a custom HTTPS domain. Uncomment when you serve Webdra on your own domain:',
    '  # Strict-Transport-Security: max-age=31536000; includeSubDomains',
  ];
  for (const [name, value] of Object.entries(extraHeaders)) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push('');
  return lines.join('\n');
}
