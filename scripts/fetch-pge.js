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
  });
  const page = await context.newPage();

  // Przechwytuj wszystkie requesty API
  const apiResponses = [];
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (
      contentType.includes('application/json') ||
      url.includes('/api/') ||
      url.includes('/rest/') ||
      url.includes('/notice') ||
      url.includes('/demand') ||
      url.includes('/tender')
    ) {
      try {
        const body = await response.text();
        if (body && body.length > 10 && body.length < 500000) {
          apiResponses.push({ url, status: response.status(), body: body.substring(0, 1000) });
          console.log('API response:', url, response.status());
        }
      } catch (e) {}
    }
  });

  console.log('Otwieranie portalu PGE SWPP2...');
  await page.goto(
    'https://swpp2.gkpge.pl/app/demand/notice/public/current/list',
    { waitUntil: 'networkidle', timeout: 60000 }
  );
  await page.waitForTimeout(5000);

  if (apiResponses.length === 0) {
    console.log('Brak odpowiedzi API - sprawdzam wszystkie requesty...');
    // Wypisz WSZYSTKIE requesty jakie poszły
    const allRequests = [];
    page.on('request', req => {
      allRequests.push(req.url());
    });
    // Odpal scroll żeby wymusić lazy load
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    console.log('Requesty:', JSON.stringify(allRequests.slice(0, 30)));
  } else {
    console.log('Znalezione API responses:');
    apiResponses.forEach(r => {
      console.log('URL:', r.url);
      console.log('Body:', r.body);
      console.log('---');
    });
  }

  // Spróbuj też bezpośrednio uderzyć w REST API PGE
  console.log('Próba bezpośredniego API...');
  try {
    const cookies = await context.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    const apiUrl = 'https://swpp2.gkpge.pl/api/demand/notice/public/current/list';
    const resp = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      const text = await r.text();
      return { status: r.status, body: text.substring(0, 2000) };
    }, apiUrl);
    console.log('Bezposrednie API:', JSON.stringify(resp));
  } catch (e) {
    console.log('Blad bezposredniego API:', e.message);
  }

  await browser.close();
  console.log('Gotowe');
})();
