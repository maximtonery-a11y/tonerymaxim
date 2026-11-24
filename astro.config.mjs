// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://www.tonerymaxim.sk',
  base: '/',
  trailingSlash: 'ignore',
  output: 'server',
  security: {
    checkOrigin: true,
    // TLS terminates at Traefik. Resolve only the shop's known HTTPS origins
    // before Astro's form CSRF check; arbitrary forwarded hosts stay untrusted.
    allowedDomains: [
      { hostname: 'www.tonerymaxim.sk', protocol: 'https' },
      { hostname: 'tonerymaxim.sk', protocol: 'https' },
      { hostname: 'www.tonerymaxim.info', protocol: 'https' },
      { hostname: 'tonerymaxim.info', protocol: 'https' },
    ],
  },
  adapter: node({
    mode: 'standalone'
  })
});
