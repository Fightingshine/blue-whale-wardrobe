import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const reference = fileURLToPath(new URL('../../public/skins/original/reference.png', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '全部皮肤图鉴' })).toBeVisible();
});

test('图鉴加载、筛选、多套扩展无上限与真实空结果', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await expect(page).toHaveTitle(/大肥鱼衣橱/u);
  await expect(page.locator('.skin-card')).toHaveCount(4);
  await expect(page.getByText(/已收录 4 套/u)).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索皮肤' }).fill('针织装');
  await expect(page.locator('.skin-card')).toHaveCount(1);
  await expect(page.locator('.skin-card h3')).toHaveText('毛衣大肥鱼');
  await page.getByRole('searchbox').fill('不存在的皮肤');
  await expect(page.getByText('这件新衣还没放进衣橱。')).toBeVisible();
  await page.getByRole('button', { name: '查看全部皮肤' }).click();
  await page.getByRole('button', { name: '像素', exact: true }).click();
  await expect(page.locator('.skin-card h3')).toHaveText('像素风大肥鱼');

  // 验证超过 4 套（如新投稿已收录共创皮肤）时全部显示且无数量限制
  await page.route('**/skins/catalog.json', async route => {
    const res = await route.fetch();
    const data = await res.json();
    const extra1 = { ...data.skins[0], id: 'issue-21', name: '海盐水手大肥鱼', category: 'community', categoryLabel: '共创', issueUrl: 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/21' };
    const extra2 = { ...data.skins[1], id: 'issue-22', name: '春日樱花大肥鱼', category: 'community', categoryLabel: '共创', description: '', appearance: '' };
    await route.fulfill({ json: { ...data, skins: [...data.skins, extra1, extra2] } });
  });
  await page.reload();
  await expect(page.locator('.skin-card')).toHaveCount(6);
  await expect(page.getByText(/已收录 6 套/u)).toBeVisible();
  await page.getByRole('button', { name: '共创', exact: true }).click();
  await expect(page.locator('.skin-card')).toHaveCount(2);
  const emptyCard = page.locator('.skin-card', { hasText: '春日樱花大肥鱼' });
  await expect(emptyCard.locator('.card-caption p')).toHaveCount(0);
  await emptyCard.getByRole('button', { name: '查看春日樱花大肥鱼三视图', exact: true }).click();
  const emptyDetail = page.getByRole('dialog', { name: '春日樱花大肥鱼三视图' });
  await expect(emptyDetail.locator('.detail-heading p')).toHaveCount(0);
  await expect(emptyDetail.getByRole('heading', { name: '触发关键词' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('完整三视图与下载入口及关闭弹窗', async ({ page }) => {
  await page.getByRole('button', { name: '查看冬装大肥鱼三视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '冬装大肥鱼三视图' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText('冬装大肥鱼完整正面、侧面、背面三视图')).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: '下载原图' }).click();
  expect((await download).suggestedFilename()).toBe('reference.jpg');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('通过选题点选完成投稿并生成安全的GitHub草稿', async ({ page }) => {
  await page.addInitScript(() => {
    window.__issues = [];
    window.open = url => {
      window.__issues.push(url);
      return null;
    };
  });
  await page.reload();
  await page.getByRole('button', { name: '投稿我的皮肤', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '皮肤投稿', exact: true });

  await dialog.getByRole('button', { name: '去 GitHub 附图投稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('三视图');

  await dialog.getByLabel('选择三视图图片').setInputFiles(reference);
  await expect(dialog.getByText(/本地预览已就绪/u)).toBeVisible();

  await dialog.getByLabel('皮肤名称').fill('学院风大肥鱼');
  await dialog.getByLabel('作者署名').fill('共创测试');
  await dialog.getByLabel('触发关键词').fill('学院风、校园装');

  // 点选设计说明主题与细节（选填）
  await dialog.getByRole('button', { name: '学院制服' }).click();
  await expect(dialog.getByRole('button', { name: '学院制服' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel(/补充配色或细节想法/u).fill('深蓝水手服搭配白百褶裙。');

  // 点选素材来源卡片与开放使用范围（选填，且支持再次点击取消）
  const originalCard = dialog.getByRole('radio', { name: /原创绘制/u });
  await originalCard.click();
  await expect(originalCard).toHaveAttribute('aria-checked', 'true');
  const scopeChip = dialog.getByRole('button', { name: '在衣橱图鉴公开展示' });
  await scopeChip.click();
  await expect(scopeChip).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('checkbox', { name: /我同意将这套三视图公开投稿至 GitHub/u }).check();
  await dialog.getByRole('button', { name: '去 GitHub 附图投稿', exact: true }).click();

  const urls = await page.evaluate(() => window.__issues);
  expect(urls).toHaveLength(1);
  const url = new URL(urls[0]);
  expect(url.origin).toBe('https://github.com');
  expect(url.pathname).toBe('/Fightingshine/blue-whale-wardrobe/issues/new');
  const body = url.searchParams.get('body');
  expect(body).toContain('【在这里附上图片】');
  expect(body).toContain('学院制服');
  expect(body).toContain('原创绘制');
  expect(body).not.toContain('blob:');

  await expect(dialog.getByText(/已在新标签页为你准备好 GitHub 投稿页/u)).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '投稿我的皮肤', exact: true }).click();
  await expect(page.getByText(/三视图排版示范/u)).toBeVisible();
});

test('设计说明和素材来源留空不选也能顺利提交', async ({ page }) => {
  await page.addInitScript(() => {
    window.__issues = [];
    window.open = url => {
      window.__issues.push(url);
      return null;
    };
  });
  await page.reload();
  await page.getByRole('button', { name: '投稿我的皮肤', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '皮肤投稿', exact: true });
  await dialog.getByLabel('选择三视图图片').setInputFiles(reference);
  await dialog.getByLabel('皮肤名称').fill('水手大肥鱼');
  await dialog.getByLabel('作者署名').fill('省心同学');
  await dialog.getByLabel('触发关键词').fill('水手装');
  await dialog.getByRole('checkbox', { name: /我同意将这套三视图公开投稿至 GitHub/u }).check();
  await dialog.getByRole('button', { name: '去 GitHub 附图投稿', exact: true }).click();
  const urls = await page.evaluate(() => window.__issues);
  expect(urls).toHaveLength(1);
  expect(new URL(urls[0]).searchParams.get('body')).toContain('未额外填写');
});

test('拒绝SVG与损坏文件', async ({ page }) => {
  await page.getByRole('button', { name: '投稿我的皮肤', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '皮肤投稿', exact: true });
  await dialog.getByLabel('选择三视图图片').setInputFiles({
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(dialog.getByRole('alert')).toContainText('不支持 SVG');
  await dialog.getByLabel('选择三视图图片').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an actual png image at all'),
  });
  await expect(dialog.getByRole('alert')).toContainText('格式不一致');
});

test('规范弹窗与手机布局无横向溢出', async ({ page }) => {
  await page.getByRole('button', { name: '查看投稿规范', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '三视图投稿规范' });
  await expect(dialog.getByRole('heading', { name: '三面看清，才是一套完整的新衣。' })).toBeVisible();
  await dialog.getByRole('button', { name: '开始投稿' }).click();
  await expect(page.getByRole('dialog', { name: '皮肤投稿', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('生成验收截图', async ({ page }, info) => {
  if (!process.env.QA_DIR) return;
  fs.mkdirSync(process.env.QA_DIR, { recursive: true });
  await page.locator('img').evaluateAll(async images => {
    for (const img of images) img.loading = 'eager';
    await Promise.all(images.map(img => img.decode()));
  });
  await page.locator('.featured-skin img').evaluate(img => img.decode());
  await page.screenshot({ path: path.join(process.env.QA_DIR, `gallery-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '投稿我的皮肤', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '皮肤投稿', exact: true });
  await page.screenshot({ path: path.join(process.env.QA_DIR, `submission-idle-${info.project.name}.png`), fullPage: false, animations: 'disabled' });
  await dialog.getByLabel('选择三视图图片').setInputFiles(reference);
  await expect(dialog.getByText(/本地预览已就绪/u)).toBeVisible();
  await dialog.getByRole('button', { name: '学院制服' }).click();
  await dialog.getByRole('radio', { name: /原创绘制/u }).click();
  await expect(dialog.getByRole('radio', { name: /原创绘制/u })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: path.join(process.env.QA_DIR, `submission-selected-${info.project.name}.png`), fullPage: false, animations: 'disabled' });
});

test('启用网页直传时通过人机验证免跳转提交成功并支持失败回退', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.__issues = [];
    window.open = url => {
      window.__issues.push(url);
      return null;
    };
    window.__WARDROBE_TEST_CONFIG__ = {
      submitApiUrl: 'https://submit.example.test',
      turnstileSiteKey: '1x00000000000000000000AA',
    };
    window.__turnstileState = { renders: 0, resets: 0, callback: null };
    window.turnstile = {
      render(container, options) {
        window.__turnstileState.renders += 1;
        window.__turnstileState.callback = options.callback;
        container.innerHTML = '<button type="button" data-testid="mock-turnstile-pass">完成安全验证</button>';
        container.querySelector('[data-testid="mock-turnstile-pass"]').addEventListener('click', () => {
          options.callback('mock-turnstile-token-ok');
        });
        return 'widget-1';
      },
      reset() {
        window.__turnstileState.resets += 1;
      },
      remove() {},
    };
  });

  let mode = 'fail';
  let capturedBody = '';
  await page.route('https://submit.example.test/api/submit', async route => {
    capturedBody = route.request().postDataBuffer()?.toString('latin1') || '';
    if (mode === 'fail') {
      await route.fulfill({ status: 429, json: { ok: false, error: '提交太频繁啦，请稍等一分钟后再试。' } });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        ok: true,
        issueNumber: 88,
        issueUrl: 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/88',
        imageUrl: 'https://raw.githubusercontent.com/Fightingshine/blue-whale-wardrobe/abc/submissions/ref.png',
        name: '直传测试大肥鱼',
      },
    });
  });

  await page.reload();
  await page.getByRole('button', { name: '投稿我的皮肤', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '皮肤投稿', exact: true });
  await expect(dialog.getByRole('button', { name: '直接提交投稿', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'GitHub 手动投稿', exact: true })).toBeVisible();

  await dialog.getByLabel('选择三视图图片').setInputFiles(reference);
  await dialog.getByLabel('皮肤名称').fill('直传测试大肥鱼');
  await dialog.getByLabel('作者署名').fill('直传作者');
  await dialog.getByLabel('触发关键词').fill('直传风');
  await dialog.getByRole('checkbox', { name: /我同意将这套三视图公开投稿至 GitHub/u }).check();

  // 未点人机验证时先拦住提示
  await dialog.getByRole('button', { name: '直接提交投稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('人机验证');

  // 完成 Turnstile 后遇到 429 报错能友好提示并重置小部件
  await dialog.getByTestId('mock-turnstile-pass').click();
  await dialog.getByRole('button', { name: '直接提交投稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('提交太频繁');
  expect(await page.evaluate(() => window.__turnstileState.resets)).toBe(1);

  // 重试直传成功并渲染无跳转回执卡
  mode = 'ok';
  await dialog.getByTestId('mock-turnstile-pass').click();
  if (process.env.QA_DIR) {
    fs.mkdirSync(process.env.QA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.QA_DIR, `direct-form-${info.project.name}.png`), fullPage: false, animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: '直接提交投稿', exact: true }).click();
  await expect(dialog.getByText(/投稿已收到，正在等待审核/u)).toBeVisible();
  if (process.env.QA_DIR) {
    await page.screenshot({ path: path.join(process.env.QA_DIR, `direct-success-${info.project.name}.png`), fullPage: false, animations: 'disabled' });
  }
  await expect(dialog.getByRole('link', { name: /#88/u })).toHaveAttribute('href', 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/88');
  expect(capturedBody).toContain('mock-turnstile-token-ok');
  expect(capturedBody).toContain('reference.png');
  expect(await page.evaluate(() => window.__issues)).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('目录请求声明 cache: no-cache 以避免浏览器命中 GitHub Pages 短缓存', async ({ page }) => {
  await page.addInitScript(() => {
    const rawFetch = window.fetch.bind(window);
    window.__catalogFetchCalls = [];
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('skins/catalog.json')) {
        window.__catalogFetchCalls.push({ url, cache: init?.cache ?? 'default' });
      }
      return rawFetch(input, init);
    };
  });
  await page.goto('/');
  await expect(page.locator('.skin-card')).toHaveCount(4);
  const calls = await page.evaluate(() => window.__catalogFetchCalls);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(call => call.cache === 'no-cache')).toBe(true);
});
