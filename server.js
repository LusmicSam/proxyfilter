const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
    NSFW_API_BASE: 'http://aimodel.ddns.net:8000',
    PORT: process.env.PORT || 3000
};

// ==================== UTIL: URL DECODER ====================
function decodeImageUrl(encodedUrl) {
    try {
        let decoded = encodedUrl;
        while (decoded.includes('%') && decoded !== decodeURIComponent(decoded)) {
            decoded = decodeURIComponent(decoded);
        }
        return decoded;
    } catch (error) {
        console.log('URL decoding failed, using original');
        return encodedUrl;
    }
}

// ==================== MAIN SMART FILTER ENDPOINT ====================
app.get('/filter', async (req, res) => {
    try {
        const encodedImageUrl = req.query.url;
        console.log('\n=== STARTING SMART FILTER ===');
        console.log('Received encoded URL:', encodedImageUrl);

        if (!encodedImageUrl) {
            return res.status(400).json({ error: 'Missing image URL' });
        }

        // Step 1: Decode URL
        const actualImageUrl = decodeImageUrl(encodedImageUrl);
        console.log('Decoded URL:', actualImageUrl);

        // Step 2: Download image
        console.log('Downloading image...');
        const imageResponse = await axios({
            method: 'GET',
            url: actualImageUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.aliexpress.com/',
                'Accept': 'image/webp,image/apng,image/*,*/*'
            }
        });

        const imageBuffer = Buffer.from(imageResponse.data);
        const originalContentType = imageResponse.headers['content-type'] || 'image/jpeg';
        console.log('✅ Image downloaded, size:', imageBuffer.length, 'bytes');

        // Step 3: Check with NSFW API
        console.log('Checking with NSFW API...');
        let isSafe = false;
        let nsfwCategory = 'unknown';

        try {
            const formData = new FormData();
            formData.append('file', imageBuffer, {
                filename: 'check.jpg',
                contentType: 'image/jpeg'
            });

            const nsfwResponse = await axios.post(
                `${CONFIG.NSFW_API_BASE}/predict/single`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 20000
                }
            );

            // 🔥 Debug log the full NSFW API response
            console.log('NSFW API Response:', nsfwResponse.data);

            // Safe parsing
            nsfwCategory = nsfwResponse.data?.ensemble_category || 'unknown';
            isSafe = nsfwCategory === 'male_only';

            console.log(`NSFW Result: ${nsfwCategory}, Safe: ${isSafe}`);
        } catch (nsfwError) {
            console.log('⚠️ NSFW API failed, defaulting to blur:', nsfwError.message);
            isSafe = false;
            nsfwCategory = 'api_error';
        }

        // Step 4: Return appropriate image
        if (isSafe) {
            console.log('✅ Returning original safe image');
            res.setHeader('Content-Type', originalContentType);
            res.setHeader('X-NSFW-Status', 'safe');
            res.setHeader('X-NSFW-Category', nsfwCategory || 'unknown');
            res.send(imageBuffer);
        } else {
            console.log('⚠️ Applying blur to unsafe image');
            const blurredImage = await sharp(imageBuffer)
                .blur(20)
                .png()
                .toBuffer();

            res.setHeader('Content-Type', 'image/png');
            res.setHeader('X-NSFW-Status', 'blurred');
            res.setHeader('X-NSFW-Category', nsfwCategory || 'unknown');
            res.send(blurredImage);
        }

        console.log('=== FILTERING COMPLETE ===\n');
    } catch (error) {
        console.error('❌ FATAL ERROR:', error.message);
        res.status(500).json({
            error: 'Filter failed',
            message: error.message
        });
    }
});

// ==================== SIMPLE IMAGE PROXY ====================
app.get('/proxy', async (req, res) => {
    try {
        const encodedUrl = req.query.url;
        const decodedUrl = decodeImageUrl(encodedUrl);

        console.log('Proxying image:', decodedUrl);

        const response = await axios({
            method: 'GET',
            url: decodedUrl,
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.aliexpress.com/'
            }
        });

        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.send(Buffer.from(response.data));
    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).json({ error: 'Proxy failed' });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Smart Image Filter',
        timestamp: new Date().toISOString()
    });
});

// ==================== TEST ENDPOINT ====================
app.get('/test', (req, res) => {
    const testUrl = 'https%3A%2F%2Fae01.alicdn.com%2Fkf%2FS48cec483fac04ff9b5d824a4760f021ff%2F48x48.png';
    res.json({
        message: 'Smart Filter Server is running! 🚀',
        usage: {
            main: `GET /filter?url=ENCODED_IMAGE_URL`,
            example: `http://localhost:${CONFIG.PORT}/filter?url=${testUrl}`,
            fallback: `GET /proxy?url=ENCODED_IMAGE_URL`
        },
        test_links: {
            filtered: `/filter?url=${testUrl}`,
            direct: `/proxy?url=${testUrl}`
        }
    });
});

// ==================== START SERVER ====================
app.listen(CONFIG.PORT, () => {
    console.log(`\n🎯 Smart Filter Server running on port ${CONFIG.PORT}`);
    console.log(`📍 Health: http://localhost:${CONFIG.PORT}/health`);
    console.log(`📍 Test: http://localhost:${CONFIG.PORT}/test`);
    console.log(`🚀 Main endpoint: GET /filter?url=ENCODED_IMAGE_URL`);
});
