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
  console.log('Fetching:', targetUrl);
  const jsScenario = JSON.stringify({
    instructions: [
      { wait: 10000 },
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
    const cells = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(rowMatch[2])) !== null) {
      cells.push(stripTags(tdMatch[1]));
    }
    if (cells.length >= 5) rows.push({ rowId: rowMatch[1], cells });
  }
  return rows;
}

function rowToTender(rowId, cells) {
  const number    = cells[0] || '';
  const name      = cells[1] || '';
  const organizer = cells[5] || '';
  const company   = cells[6] || '';
  const fullText  = [number, name, organizer, company].join(' ');

  if (!fullText.toLowerCase().includes('pge')) return null;
  const region = detectRegion(fullText);
  if (!region) return null;

  const deadlineText = cells[9] || '';
  const dateMatch = deadlineText.match(/(\d{2})[-.](\d{2})[-.](\d{4})/);
  const deadline = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  return {
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
  };
}

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  const baseUrl = 'https://swpp2.gkpge.pl/app/demand/notice/public/current/list';
  const allTenders = [];
  const seenIds = new Set();

  // Próbuj różne URL z parametrami zwiększającymi limit
  const urlsToTry = [
    baseUrl,
    `${baseUrl}?rows=99999999`,
    `${baseUrl}?pageSize=99999999`,
    `${baseUrl}?start=25`,
    `${baseUrl}?start=50`,
    `${baseUrl}?start=75`,
    `${baseUrl}?start=100`,
    `${baseUrl}?start=125`,
    `${baseUrl}?start=150`,
    `${baseUrl}?start=175`,
    `${baseUrl}?start=200`,
  ];

  for (const url of urlsToTry) {
    console.log(`\nPobieranie: ${url}`);
    try {
      const html = await fetchHtml(apiKey, url);
      const rows = parseRows(html);
      console.log(`Wierszy: ${rows.length}`);

      if (rows.length === 0) {
        console.log('Brak wierszy - pomijam');
        continue;
      }

      let newCount = 0;
      for (const { rowId, cells } of rows) {
        if (seenIds.has(rowId)) continue;
        seenIds.add(rowId);
        newCount++;
        const tender = rowToTender(rowId, cells);
        if (tender) {
          allTenders.push(tender);
          console.log(`✓ [${tender.region}] ${tender.title.substring(0, 60)}`);
        }
      }

      console.log(`Nowych unikalnych wierszy: ${newCount}`);

      // Jeśli URL z rows=99999999 zadziałał i dał >25 wyników - stop
      if (url.includes('rows=') && rows.length > 25) {
        console.log('Duży pageSize zadziałał! Pobrano wszystko.');
        break;
      }

      // Jeśli start= i 0 nowych wierszy - koniec paginacji
      if (url.includes('start=') && newCount === 0) {
        console.log('Koniec paginacji');
        break;
      }

      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log(`Błąd: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nŁącznie znaleziono ${allTenders.length} przetargów dla docelowych regionów`);

  for (const tender of allTenders) {
    const { error } = await supabase.from('tenders').upsert(tender, { onConflict: 'external_id' });
    if (error) console.error('Błąd upsert:', error.message);
  }

  console.log('Gotowe!');
})();
