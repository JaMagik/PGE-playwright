const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');

chromium.use(StealthPlugin());

const REGION_KEYWORDS = {
  'Skarżysko': 'Skarżysko',
  'Rzeszów': 'Rzeszów',
  'Łódź': 'Łódź',
  'Warszawa': 'Warszawa',
};

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

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
  await page.waitForTimeout(4000);

  // Wypisz zawartość wszystkich wierszy tabeli
  const rowsData = await page.evaluate(() => {
    const rows = document.querySelectorAll('tbody tr');
    return Array.from(rows).map(row => ({
      text: row.innerText?.trim().substring(0, 200),
      html: row.innerHTML?.substring(0, 300),
      links: Array.from(row.querySelectorAll('a')).map(a => ({
        text: a.innerText?.trim(),
        href: a.href
      }))
    }));
  });

  console.log('Wiersze tabeli:');
  rowsData.forEach((r, i) => console.log(`Row ${i}:`, JSON.stringify(r)));

  // Wypisz wszystkie linki do notice/demand
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="notice"], a[href*="demand"]'))
      .map(a => ({ text: a.innerText?.trim(), href: a.href }));
  });
  console.log('Wszystkie linki:', JSON.stringify(allLinks));

  await browser.close();
})();
