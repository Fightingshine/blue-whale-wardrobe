import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const reference = fileURLToPath(new URL('../../public/skins/original/reference.png', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '衣橱里的四套皮肤' })).toBeVisible();
});

test('图鉴加载、筛选与真实空结果', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await expect(page).toHaveTitle(/大肥鱼衣橱/u);
  await expect(page.locator('.skin-card')).toHaveCount(4);
  await page.getByRole('searchbox', { name: '搜索皮肤' }).fill('针织装');
  await expect(page.locator('.skin-card')).toHaveCount(1);
  await expect(page.locator('.skin-card h3')).toHaveText('毛衣大肥鱼');
  await page.getByRole('searchbox').fill('不存在的皮肤');
  await expect(page.getByText('这件新衣还没放进衣橱。')).toBeVisible();
  await page.getByRole('button', { name: '查看全部皮肤' }).click();
  await page.getByRole('button', { name: '像素', exact: true }).click();
  await expect(page.locator('.skin-card h3')).toHaveText('像素风大肥鱼');
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
