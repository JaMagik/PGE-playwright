const { createClient } = require('@supabase/supabase-js');

const REGION_KEYWORDS = ['Skarżysko', 'Rzeszów', 'Łódź', 'Warszawa'];

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  console.log('Pobieranie przez ScrapingBee...');

  const url = 'https://swpp2.gkpge.pl/app/demand/notice/public/current/list';
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  // Scenariusz JS - czekaj na załadowanie wierszy tabeli
  const jsScenario = JSON.stringify({
    instructions: [
      { wait: 8000 },
      { wait_for: 'tr' },
      { wait: 3000 }
    ]
  });

  const params = new URLSearchParams({
    api_key: apiKey,
    url: url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'pl',
    js_scenario: jsScenario,
    json_response: 'false',
  });

  const response = await fetch('https://app.scrapingbee.com/api/v1/?' + params);
  const html = await response.text();

  console.log('Status ScrapingBee:', response.status);

  if (response.status !== 200) {
    console.log('Błąd ScrapingBee:', html.substring(0, 500));
    process.exit(1);
  }

  // Sprawdź ile jest wierszy tabeli w HTML
  const trCount = (html.match(/<tr/gi) || []).length;
  const tdCount = (html.match(/<td/gi) || []).length;
  console.log(`Znaleziono w HTML: ${trCount} tr, ${tdCount} td`);

  // Wypisz fragment gdzie powinna być tabela
  const tableIndex = html.indexOf('<table');
  if (tableIndex > -1) {
    console.log('Fragment tabeli:', html.substring(tableIndex, tableIndex + 3000));
  } else {
    console.log('Brak tagu table - szukam danych...');
    // Szukaj charakterystycznych fragmentów
    const searchTerms = ['Skarżysko', 'Rzeszów', 'Łódź', 'Warszawa', 'PGE', 'przetarg', 'notice'];
    searchTerms.forEach(term => {
      const idx = html.indexOf(term);
      if (idx > -1) {
        console.log(`Znaleziono "${term}" na pozycji ${idx}:`, html.substring(idx - 50, idx + 200));
      }
    });
    // Wypisz środkową część HTML
    const mid = Math.floor(html.length / 2);
    console.log('Środek HTML:', html.substring(mid, mid + 2000));
  }

  console.log('Długość HTML:', html.length);
  console.log('Gotowe!');
})();
