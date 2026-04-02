const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');

chromium.use(StealthPlugin());

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    locale: 'pl-PL',
  });
  const page = await context.newPage();

  console.log('Otwieranie portalu PGE SWPP2...');
  await page.goto(
    'https://swpp2.gkpge.pl/app/demand/notice/public/current/list',
    { waitUntil: 'networkidle', timeout: 60000 }
  );

  // Czekaj chwilę na JS
  await page.waitForTimeout(3000);

  // DIAGNOSTYKA - wypisz tytuł i fragment HTML
  const title = await page.title();
  console.log('Tytul strony:', title);

  const url = page.url();
  console.log('Aktualny URL:', url);

  // Wypisz pierwsze 3000 znaków HTML body
  const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
  console.log('Fragment HTML:', bodyHTML);

  // Sprawdz dostepne selektory
  const selectors = await page.evaluate(() => {
    const results = {};
    results['table'] = document.querySelectorAll('table').length;
    results['tr'] = document.querySelectorAll('tr').length;
    results['tbody tr'] = document.querySelectorAll('tbody tr').length;
    results['.tender'] = document.querySelectorAll('[class*="tender"]').length;
    results['.notice'] = document.querySelectorAll('[class*="notice"]').length;
    results['.list'] = document.querySelectorAll('[class*="list"]').length;
    results['.row'] = document.querySelectorAll('[class*="row"]').length;
    results['a[href*="notice"]'] = document.querySelectorAll('a[href*="notice"]').length;
    results['a[href*="demand"]'] = document.querySelectorAll('a[href*="demand"]').length;
    return results;
  });
  console.log('Selektory:', JSON.stringify(selectors, null, 2));

  await browser.close();
  console.log('Diagnostyka zakonczona');
})();
