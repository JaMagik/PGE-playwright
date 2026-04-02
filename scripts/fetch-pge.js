const { createClient } = require('@supabase/supabase-js');

const REGION_MAP = [
  { region: 'Skarżysko', keywords: ['skarżysk', 'skarzysk', '/OSK/'] },
  { region: 'Rzeszów',   keywords: ['rzeszow', 'rzeszów', '/ORZ/'] },
  { region: 'Łódź',      keywords: ['łódź', 'łodzi', 'łódzk', 'lodz', '/OL/'] },
  { region: 'Warszawa',  keywords: ['warszaw', '/OW/'] },
];

function detectRegion(text) {
  const lower = text.toLowerCase();
  for (const entry of REGION_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) return entry.region;
    }
  }
  return null;
}

const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchHtml(apiKey, targetUrl) {
  const jsScenario = JSON.stringify({
    instructions: [
      { wait: 8000 },
      { wait_for: 'tr.dataRow' },
      { wait: 3000 }
    ]
  });

  const params = new URLSearchParams({
    api_key: apiKey,
    url: targetUrl,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'pl',
    js_scenario: jsScenario,
    json_response: 'false',
  });

  const res = await fetch('https://app.scrapingbee.com/api/v1/?' + params);
  if (res.status !== 200) throw new Error(`ScrapingBee error: ${res.status}`);
  return res.text();
}

function parseRows(html) {
  const dataRowRegex = /<tr[^>]*class="dataRow[^"]*"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const rows = [];

  let rowMatch;
  while ((rowMatch = dataRowRegex.exec(html)) !== null) {
    const rowId = rowMatch[1];
    const rowHtml = rowMatch[2];

    const cells = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(stripTags(tdMatch[1]));
    }
    if (cells.length < 5) continue;

    rows.push({ rowId, cells });
  }
  return rows;
}

function getTotalPages(html) {
  // Szukaj "Pozycje X-Y z Z" lub podobnego
  const m = html.match(/z\s+<[^>]*>(\d+)<\/[^>]*>\s*pozycj/i) ||
            html.match(/z\s+(\d+)\s+pozycj/i) ||
            html.match(/(\d+)\s*pozycj/i);
  if (m) {
    const total = parseInt(m[1]);
    console.log(`Łącznie pozycji: ${total}`);
    return Math.ceil(total / 25);
  }
  return 1;
}

function getNextPageUrl(html, baseUrl) {
  // Szukaj linku do następnej strony
  const nextMatch = html.match(/href="([^"]*[?&]start=(\d+)[^"]*)"[^>]*>(?:[^<]*(?:następn|next|>)[^<]*)<\/a>/i) ||
                    html.match(/javascript:goToPage\(searchform[^)]*,\s*'(\d+)'\)/i);
  if (nextMatch) {
    const startVal = nextMatch[2];
    if (startVal) return `${baseUrl}?start=${startVal}`;
  }

  // Szukaj parametru start w paginacji
  const allPageLinks = [...html.matchAll(/goToPage[^)]*'(\d+)'/g)];
  return allPageLinks;
}

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const baseUrl = 'https://swpp2.gkpge.pl/app/demand/notice/public/current/list';
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  const allTenders = [];

  // Strona 1
  console.log('Pobieranie strony 1...');
  const html1 = await fetchHtml(apiKey, baseUrl);
  console.log('Długość HTML strony 1:', html1.length);

  // Sprawdź paginację
  const totalPages = getTotalPages(html1);
  console.log(`Liczba stron: ${totalPages}`);

  // Wypisz fragment paginacji do diagnozy
  const paginIdx = html1.indexOf('goToPage');
  if (paginIdx > -1) {
    console.log('Fragment paginacji:', html1.substring(paginIdx - 100, paginIdx + 300));
  }

  // Parsuj stronę 1
  const rows1 = parseRows(html1);
  console.log(`Strona 1: ${rows1.length} wierszy`);

  // Próbuj pobrać więcej wyników przez parametr pageSize
  // PGE używa parametru 'start' lub 'page' do paginacji
  const urlVariants = [
    `${baseUrl}?pageSize=100`,
    `${baseUrl}?rows=100`,
    `${baseUrl}?limit=100`,
    `${baseUrl}?start=25`,
    `${baseUrl}?page=2`,
  ];

  // Na razie przetworz stronę 1
  for (const { rowId, cells } of rows1) {
    const number   = cells[0] || '';
    const name     = cells[1] || '';
    const organizer = cells[5] || '';
    const company  = cells[6] || '';
    const fullText = [number, name, organizer, company].join(' ');

    const isPGE = fullText.toLowerCase().includes('pge') || company.toLowerCase().includes('pge');
    if (!isPGE) continue;

    const region = detectRegion(fullText);
    console.log(`[${region || 'BRAK'}] ${rowId}: ${name.substring(0, 70)}`);
    if (!region) continue;

    const deadlineText = cells[9] || '';
    const dateMatch = deadlineText.match(/(\d{2})[-.](\d{2})[-.](\d{4})/);
    const deadline = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    allTenders.push({
      external_id: rowId,
      title: name || number,
      source: 'PGE',
      region,
      status: 'Nowy',
      deadline,
      url: `https://swpp2.gkpge.pl/app/demand/notice/public/current/demandPublic.html?noticeId=${rowId}`,
      raw_data: {
        number,
        buyer: organizer || company,
        company,
        scraped_at: new Date().toISOString(),
      }
    });
  }

  // Jeśli jest więcej stron, pobierz je (max 5 stron = 125 wyników)
  if (totalPages > 1) {
    const maxPages = Math.min(totalPages, 5);
    for (let page = 2; page <= maxPages; page++) {
      const pageUrl = `${baseUrl}?start=${(page - 1) * 25}`;
      console.log(`\nPobieranie strony ${page}: ${pageUrl}`);
      try {
        await new Promise(r => setTimeout(r, 2000)); // przerwa 2s między stronami
        const htmlN = await fetchHtml(apiKey, pageUrl);
        const rowsN = parseRows(htmlN);
        console.log(`Strona ${page}: ${rowsN.length} wierszy`);

        for (const { rowId, cells } of rowsN) {
          const number    = cells[0] || '';
          const name      = cells[1] || '';
          const organizer = cells[5] || '';
          const company   = cells[6] || '';
          const fullText  = [number, name, organizer, company].join(' ');

          if (!fullText.toLowerCase().includes('pge')) continue;
          const region = detectRegion(fullText);
          console.log(`[${region || 'BRAK'}] ${rowId}: ${name.substring(0, 70)}`);
          if (!region) continue;

          const deadlineText = cells[9] || '';
          const dateMatch = deadlineText.match(/(\d{2})[-.](\d{2})[-.](\d{4})/);
          const deadline = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

          allTenders.push({
            external_id: rowId,
            title: name || number,
            source: 'PGE',
            region,
            status: 'Nowy',
            deadline,
            url: `https://swpp2.gkpge.pl/app/demand/notice/public/current/demandPublic.html?noticeId=${rowId}`,
            raw_data: {
              number,
              buyer: organizer || company,
              company,
              scraped_at: new Date().toISOString(),
            }
          });
        }
      } catch (e) {
        console.log(`Błąd strony ${page}:`, e.message);
        break;
      }
    }
  }

  console.log(`\nŁącznie znaleziono ${allTenders.length} przetargów dla docelowych regionów`);

  for (const tender of allTenders) {
    console.log(`✓ ${tender.region}: ${tender.title.substring(0, 70)}`);
    const { error } = await supabase.from('tenders').upsert(tender, { onConflict: 'external_id' });
    if (error) console.error('Błąd upsert:', error.message);
  }

  console.log('Gotowe!');
})();
