const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// API endpoint to get proxies
app.get('/api/proxies', async (req, res) => {
    try {
        const proxies = await scrapeProxies();
        const workingProxies = await testProxies(proxies);
        
        res.json({
            success: true,
            proxies: workingProxies,
            count: workingProxies.length,
            sources: Object.keys(proxies.bySource).map(source => ({
                name: source,
                count: proxies.bySource[source].length,
                type: getSourceType(source)
            }))
        });
    } catch (error) {
        console.error('Error:', error);
        res.json({
            success: false,
            error: 'Failed to fetch proxies',
            proxies: [],
            sources: []
        });
    }
});

// Enhanced proxy sources - NO LOGIN REQUIRED
const proxySources = [
    // Free Sources
    {
        name: 'FreeProxyList',
        url: 'https://free-proxy-list.net/',
        type: 'free',
        parser: (html) => {
            const proxies = [];
            const $ = cheerio.load(html);
            $('#proxylisttable tbody tr').each((i, row) => {
                const cells = $(row).find('td');
                const ip = $(cells[0]).text().trim();
                const port = $(cells[1]).text().trim();
                if (ip && port) {
                    proxies.push(`${ip}:${port}`);
                }
            });
            return proxies;
        }
    },
    {
        name: 'ProxyScrape',
        url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
        type: 'free',
        parser: (text) => {
            return text.split('\n')
                .map(proxy => proxy.trim())
                .filter(proxy => proxy && proxy.includes(':'));
        }
    },
    {
        name: 'Geonode',
        url: 'https://proxylist.geonode.com/api/proxy-list?protocols=http%2Chttps&limit=150&page=1&sort_by=lastChecked&sort_type=desc',
        type: 'free',
        parser: (json) => {
            try {
                const data = JSON.parse(json);
                return data.data.map(proxy => `${proxy.ip}:${proxy.port}`);
            } catch (e) {
                return [];
            }
        }
    },
    {
        name: 'ProxyListDownload',
        url: 'https://www.proxy-list.download/api/v1/get?type=http',
        type: 'free',
        parser: (text) => {
            return text.split('\r\n')
                .filter(proxy => proxy.trim() && proxy.includes(':'));
        }
    },
    {
        name: 'SpysOne',
        url: 'https://spys.me/proxy.txt',
        type: 'free',
        parser: (text) => {
            const proxies = [];
            const lines = text.split('\n');
            lines.forEach(line => {
                if (line.includes(':')) {
                    const match = line.match(/(\d+\.\d+\.\d+\.\d+:\d+)/);
                    if (match) {
                        proxies.push(match[1]);
                    }
                }
            });
            return proxies;
        }
    },
    // Premium-like Sources (No auth required)
    {
        name: 'Proxyscan',
        url: 'https://www.proxyscan.io/api/proxy?limit=50&type=http,https',
        type: 'premium',
        parser: (json) => {
            try {
                const data = JSON.parse(json);
                return data.map(proxy => `${proxy.Ip}:${proxy.Port}`);
            } catch (e) {
                return [];
            }
        }
    },
    {
        name: 'ProxyPrime',
        url: 'https://proxyprime.net/api/proxy-list.php?type=http&anon=elite&limit=50',
        type: 'premium',
        parser: (text) => {
            return text.split('\n')
                .map(proxy => proxy.trim())
                .filter(proxy => proxy && proxy.includes(':'));
        }
    },
    {
        name: 'OpenProxies',
        url: 'https://openproxies.com/api/v1/proxies?protocol=http&limit=50',
        type: 'premium',
        parser: (json) => {
            try {
                const data = JSON.parse(json);
                return data.proxies.map(proxy => `${proxy.ip}:${proxy.port}`);
            } catch (e) {
                return [];
            }
        }
    },
    // Additional Free Sources
    {
        name: 'Webshare',
        url: 'https://www.webshare.io/api/proxy/list/?mode=direct&page=1&limit=50',
        type: 'free',
        parser: (json) => {
            try {
                const data = JSON.parse(json);
                return data.results.map(proxy => `${proxy.proxy_address}:${proxy.port}`);
            } catch (e) {
                return [];
            }
        }
    },
    {
        name: 'Proxy4Free',
        url: 'https://www.proxy4free.com/list/webproxy1.html',
        type: 'free',
        parser: (html) => {
            const proxies = [];
            const $ = cheerio.load(html);
            $('.proxy-list tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const ip = $(cells[0]).text().trim();
                    const port = $(cells[1]).text().trim();
                    if (ip && port) {
                        proxies.push(`${ip}:${port}`);
                    }
                }
            });
            return proxies;
        }
    }
];

function getSourceType(sourceName) {
    const source = proxySources.find(s => s.name === sourceName);
    return source ? source.type : 'free';
}

async function scrapeProxies() {
    let allProxies = [];
    const bySource = {};
    
    // Scrape sources in parallel with timeout
    const scrapePromises = proxySources.map(async (source) => {
        try {
            console.log(`Scraping from ${source.name}...`);
            
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            
            const response = await axios.get(source.url, {
                timeout: 10000,
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            
            clearTimeout(timeout);
            const proxies = source.parser(response.data);
            bySource[source.name] = proxies;
            
            console.log(`Found ${proxies.length} proxies from ${source.name}`);
            return proxies;
            
        } catch (error) {
            console.error(`Error scraping ${source.name}:`, error.message);
            bySource[source.name] = [];
            return [];
        }
    });
    
    const results = await Promise.allSettled(scrapePromises);
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            allProxies = [...allProxies, ...result.value];
        }
    });
    
    // Remove duplicates
    const uniqueProxies = [...new Set(allProxies)];
    
    return {
        all: uniqueProxies,
        bySource: bySource
    };
}

async function testProxies(proxyData, timeout = 4000) {
    const workingProxies = [];
    const testUrl = 'http://httpbin.org/ip';
    
    // Test only first 40 proxies to avoid timeout
    const proxiesToTest = proxyData.all.slice(0, 40);
    
    console.log(`Testing ${proxiesToTest.length} proxies...`);
    
    const testPromises = proxiesToTest.map(async (proxy) => {
        try {
            const [ip, port] = proxy.split(':');
            const response = await axios.get(testUrl, {
                timeout: timeout,
                proxy: {
                    protocol: 'http',
                    host: ip,
                    port: parseInt(port)
                },
                validateStatus: false // Don't throw on HTTP errors
            });
            
            if (response.status === 200 && response.data && response.data.origin) {
                return {
                    proxy: proxy,
                    source: findProxySource(proxy, proxyData.bySource),
                    type: getSourceType(findProxySource(proxy, proxyData.bySource))
                };
            }
        } catch (error) {
            return null;
        }
    });
    
    const results = await Promise.allSettled(testPromises);
    
    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            workingProxies.push(result.value);
        }
    });
    
    console.log(`Found ${workingProxies.length} working proxies`);
    return workingProxies;
}

function findProxySource(proxy, bySource) {
    for (const [source, proxies] of Object.entries(bySource)) {
        if (proxies.includes(proxy)) {
            return source;
        }
    }
    return 'Unknown';
}

// Root endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const proxies = await scrapeProxies();
        const workingProxies = await testProxies(proxies);
        
        res.json({
            totalProxies: proxies.all.length,
            workingProxies: workingProxies.length,
            successRate: ((workingProxies.length / Math.min(proxies.all.length, 40)) * 100).toFixed(2),
            sources: Object.keys(proxies.bySource).map(source => ({
                name: source,
                count: proxies.bySource[source].length,
                type: getSourceType(source)
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Visit: http://localhost:${PORT}`);
});