module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Ambil full path setelah /api/proxy/
    // Contoh req.url: "/api/proxy/YUhSMGNITTZMeTl5WTJn..." atau "/api/proxy?url=..."
    let rawPath = req.url.replace('/api/proxy', '');
    
    // Hilangkan karakter slash pertama atau query tanda tanya jika ada
    if (rawPath.startsWith('/')) rawPath = rawPath.substring(1);
    if (rawPath.startsWith('?url=')) rawPath = rawPath.replace('?url=', '');

    if (!rawPath || rawPath === '/') {
        res.status(200).send("Proxy Server Aktif.");
        return;
    }

    let targetUrl = '';

    // Cek apakah request datang dari gabungan Clean URL (terdapat nama file di ujung path)
    // Misal: [BASE64_DIR]/FIFAWCCh1-video=1374000.dash
    if (rawPath.includes('/')) {
        const parts = rawPath.split('/');
        const base64Part = parts[0]; // Bagian Base64 folder
        const fileName = parts.slice(1).join('/'); // Nama file segmen (.dash)

        try {
            const decodedDir = Buffer.from(base64Part, 'base64').toString('utf8');
            // Gabungkan alamat asli remote folder dengan nama file
            targetUrl = decodedDir.endsWith('/') ? `${decodedDir}${fileName}` : `${decodedDir}/${fileName}`;
        } catch (e) {
            res.status(400).send("Gagal decode Clean URL Base64.");
            return;
        }
    } else {
        // Jika request murni base64 tanpa tambahan path (biasanya request pertama dari PHP)
        try {
            targetUrl = Buffer.from(rawPath, 'base64').toString('utf8');
        } catch (e) {
            // Fallback jika dikirim plaintext url biasa
            if (rawPath.startsWith('http')) {
                targetUrl = rawPath;
            } else {
                res.status(400).send("Format Base64 tidak valid.");
                return;
            }
        }
    }

    try {
        // 2. Fetch data dari upstream server
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.starhubgo.com/',
                'Origin': 'https://www.starhubgo.com'
            }
        });

        const contentType = response.headers.get('content-type') || '';
        const bufferData = await response.arrayBuffer();
        const nodeBuffer = Buffer.from(bufferData);

        // 3. Jika respons adalah file manifest MPD
        if (targetUrl.includes('.mpd') || contentType.includes('xml') || contentType.includes('dash+xml')) {
            let responseData = nodeBuffer.toString('utf8');

            // Ambil base directory dari link .mpd asli termasuk folder /dash/
            const baseRemoteDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const absoluteBaseUrl = `${baseRemoteDir}dash/`;
            
            // Encode base remote folder ke Base64
            const base64AbsoluteUrl = Buffer.from(absoluteBaseUrl).toString('base64');
            
            // Susun BaseURL baru menggunakan struktur Clean Path tanpa tanda tanya (?)
            const hostUrl = `https://${req.headers.host}/api/proxy/${base64AbsoluteUrl}/`;

            // Rewrite tag <BaseURL> di dalam XML
            if (responseData.includes('<BaseURL>')) {
                responseData = responseData.replace(/<BaseURL>.*?<\/BaseURL>/g, `<BaseURL>${hostUrl}</BaseURL>`);
            } else {
                responseData = responseData.replace('<Period id="1" start="PT0S">', `<Period id="1" start="PT0S">\n    <BaseURL>${hostUrl}</BaseURL>`);
            }

            res.setHeader('Content-Type', 'application/dash+xml');
            res.status(response.status).send(responseData);
            return;
        }

        // 4. Jika respons adalah biner segmen (.dash)
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        } else {
            res.setHeader('Content-Type', 'application/octet-stream');
        }
        res.status(response.status).send(nodeBuffer);

    } catch (error) {
        res.status(500).send("Proxy Error: " + error.message);
    }
};
