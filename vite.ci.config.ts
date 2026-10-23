import { defineConfig, mergeConfig } from 'vite';
import appConfig from './vite.config.ts';

export default mergeConfig(
  appConfig,
  defineConfig({
    build: {
      rollupOptions: {
        // AppDeploy injects this SDK at runtime; keep it external only in CI.
        external: ['@appdeploy/client'],
      },
    },
  })
);
