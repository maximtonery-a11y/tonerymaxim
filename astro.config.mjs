// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://www.tonerymaxim.sk',
  base: '/',
  trailingSlash: 'ignore',
  output: 'server',
  adapter: node({
    mode: 'standalone'
  })
});
