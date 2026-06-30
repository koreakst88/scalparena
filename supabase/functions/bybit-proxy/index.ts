import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const PROXY_VERSION = '2026-06-30-raw-json-v1';
const BYBIT_BASES = (Deno.env.get('BYBIT_PROXY_BASES') ||
  'https://api.bybit.com,https://api.bytick.com,https://api.bybit-tr.com,https://api.bybit.kz')
  .split(',')
  .map((base) => base.trim())
  .filter(Boolean);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-scalparena-proxy-version': PROXY_VERSION },
  });
}

function bybitJsonResponse(text: string) {
  return new Response(text, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-scalparena-proxy-version': PROXY_VERSION },
  });
}

function preview(text: string) {
  return text.replace(/\s+/g, ' ').trim().substring(0, 180);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    const params = url.searchParams.get('params');

    if (!path) {
      return jsonResponse({ error: 'Missing path parameter' }, 400);
    }

    const attempts: Array<Record<string, unknown>> = [];

    for (const base of BYBIT_BASES) {
      const bybitUrl = `${base}${path}${params ? `?${params}` : ''}`;
      console.log('Proxying to:', bybitUrl);

      try {
        const response = await fetch(bybitUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
          },
        });

        const text = await response.text();
        console.log('Response status:', response.status);
        console.log('Response preview:', preview(text));

        if (!response.ok) {
          attempts.push({ base, status: response.status, preview: preview(text) });
          continue;
        }

        if (text.startsWith('<') || text.startsWith('<!')) {
          attempts.push({ base, status: response.status, error: 'HTML response', preview: preview(text) });
          continue;
        }

        return bybitJsonResponse(text);
      } catch (error) {
        attempts.push({ base, error: errorMessage(error) });
      }
    }

    console.error('All Bybit proxy attempts failed:', attempts);

    return jsonResponse({ error: 'All Bybit proxy attempts failed', attempts }, 502);
  } catch (error) {
    console.error('Proxy error:', errorMessage(error));
    return jsonResponse({ error: errorMessage(error) }, 500);
  }
});
