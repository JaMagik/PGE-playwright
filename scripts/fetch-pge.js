const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');

chromium.use(StealthPlugin());

const REGION_KEYWORDS = ['Skarżysko', 'Rzeszów', 'Łódź', 'Warszawa'];

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    locale: 'pl-PL',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Zbieraj WSZYSTKIE odpowiedzi JSON/API
  const captured = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/TSPD/')) return; // ignoruj challenge
    try {
      const body = await response.text();
      if (!body || body.length < 5) return;
      // Złap wszystko co wygląda na dane (JSON lub XML z danymi)
      if (
        body.includes('notice') ||
        body.includes('demand') ||
        body.includes('tender') ||
        body.includes('przetarg') ||
        body.startsWith('[') ||
        body.startsWith('{"') ||
        (body.startsWith('{') && body.includes('data'))
      ) {
        captured.push({ url, status: response.status(), body: body.substring(0, 3000) });
      }
    } catch (e) {}
  });

  console.log('Ładowanie strony PGE...');
  await page.goto(
    'https://swpp2.gkpge.pl/app/demand/notice/public/current/list',
    { waitUntil: 'load', timeout: 60000 }
  );

  // Czekaj aż challenge F5 się rozwiąże (do 30s)
  console.log('Czekam na przejście challenge F5...');
  try {
    await page.waitForFunction(
      () => !document.body.innerHTML.includes('bobcmn') && document.querySelectorAll('tbody tr').length > 0,
      { timeout: 30000 }
    );
    console.log('Challenge przeszedł, tabela załadowana!');
  } catch (e) {
    console.log('Timeout na challenge, próbuję mimo to...');
  }

  await page.waitForTimeout(5000);

  // Sprawdź czy tabela ma dane
  const tableRows = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  console.log('Wiersze w tabeli po czekaniu:', tableRows);

  // Próbuj pobrać dane przez fetch z cookies sesji (już po challengu)
  const apiData = await page.evaluate(async () => {
    const endpoints = [
      '/api/demand/notice/public/current/list',
      '/api/demand/notice/public/list',
      '/app/demand/notice/public/current/list?format=json',
    ];
    const results = [];
    for (const ep of endpoints) {
      try {
        const r = await fetch(ep, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
          }
        });
        const text = await r.text();
        results.push({ ep, status: r.status, body: text.substring(0, 2000) });
      } catch (e) {
        results.push({ ep, error: e.message });
      }
    }
    return results;
  });

  console.log('Wyniki API:');
  apiData.forEach(r => console.log(JSON.stringify(r)));

  // Wypisz złapane odpowiedzi
  console.log(`\nZłapane odpowiedzi (${captured.length}):`);
  captured.forEach(c => {
    console.log('URL:', c.url);
    console.log('Body:', c.body.substring(0, 500));
    console.log('---');
  });

  // Wypisz aktualny HTML tabeli
  const tableHTML = await page.evaluate(() => {
    const tbody = document.querySelector('tbody');
    return tbody ? tbody.innerHTML.substring(0, 2000) : 'brak tbody';
  });
  console.log('HTML tabeli:', tableHTML);

  await browser.close();
})();
