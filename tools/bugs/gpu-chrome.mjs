// Test-only preload for the unchanged shared scenarios on Modal's real GPU. It verifies renderer identity at capture.
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const launch = chromium.launch.bind(chromium);
chromium.launch = async (options = {}) => {
  const browser = await launch({ ...options, args: [...(options.args ?? []), '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'] });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args), newPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      const page = await newPage(...pageArgs), screenshot = page.screenshot.bind(page);
      page.screenshot = async (...shotArgs) => {
        const gpu = await page.evaluate(() => {
          const existing = window.__soulsEntity?.renderer?.getContext(), gl = existing ?? document.createElement('canvas').getContext('webgl2');
          if (!gl) return null;
          const ext = gl.getExtension('WEBGL_debug_renderer_info'), value = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          if (!existing) gl.getExtension('WEBGL_lose_context')?.loseContext();
          return String(value);
        });
        if (!gpu || /swiftshader|llvmpipe|software|softpipe/i.test(gpu)) throw new Error('browser proof refuses software rendering');
        console.log(`Browser proof GPU: ${gpu}`);
        return screenshot(...shotArgs);
      };
      return page;
    };
    return context;
  };
  return browser;
};
