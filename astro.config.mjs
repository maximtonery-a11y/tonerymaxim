// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://tonerymaxim.sk',
  base: '/novy',
  trailingSlash: 'ignore',
  output: 'server',
  adapter: node({
    mode: 'standalone'
  })
});
