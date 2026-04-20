/**
 * Upload game icons to Supabase Storage
 * Since Firebase Storage is blocked, we'll download via CDN cache and re-upload
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = 'https://zrucdzkgrmtwhykvplqs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydWNkemtncm10d2h5a3ZwbHFzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU4MTA2MSwiZXhwIjoyMDkyMTU3MDYxfQ.RSCz-7CuCymwtgZrzvfm8ZQqqAq9AiD6dy0avkcdArw';

const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

// Game icon URLs from Supabase games table
async function main() {
    // 1. Create storage bucket if not exists
    const { data: buckets } = await supa.storage.listBuckets();
    const exists = buckets?.some(b => b.name === 'game-icons');
    if (!exists) {
        const { error } = await supa.storage.createBucket('game-icons', {
            public: true,
            fileSizeLimit: 5 * 1024 * 1024 // 5MB
        });
        if (error) console.error('Bucket create error:', error.message);
        else console.log('✅ Created game-icons bucket');
    }

    // Also create slider bucket
    const sliderExists = buckets?.some(b => b.name === 'slider');
    if (!sliderExists) {
        await supa.storage.createBucket('slider', {
            public: true,
            fileSizeLimit: 5 * 1024 * 1024
        });
        console.log('✅ Created slider bucket');
    }

    // 2. Get game icons from Supabase
    const { data: games } = await supa.from('games').select('id, name, icon');
    console.log(`Found ${games?.length || 0} games`);

    for (const game of (games || [])) {
        if (!game.icon || !game.icon.includes('firebasestorage')) {
            console.log(`⏭  ${game.name}: no Firebase icon`);
            continue;
        }

        try {
            console.log(`⬇  Downloading: ${game.name}...`);
            const imageBuffer = await downloadImage(game.icon);
            
            if (!imageBuffer || imageBuffer.length < 100) {
                console.log(`❌ ${game.name}: download failed (${imageBuffer?.length || 0} bytes)`);
                continue;
            }

            // Upload to Supabase Storage
            const fileName = `${game.id}.png`;
            const { error } = await supa.storage
                .from('game-icons')
                .upload(fileName, imageBuffer, {
                    contentType: 'image/png',
                    upsert: true
                });

            if (error) {
                console.log(`❌ ${game.name}: upload failed - ${error.message}`);
                continue;
            }

            // Get public URL
            const { data: urlData } = supa.storage.from('game-icons').getPublicUrl(fileName);
            const newUrl = urlData.publicUrl;
            console.log(`✅ ${game.name}: ${newUrl}`);

            // Update games table with new URL
            await supa.from('games').update({ icon: newUrl }).eq('id', game.id);
            console.log(`   Updated DB record`);

        } catch (e) {
            console.log(`❌ ${game.name}: ${e.message}`);
        }
    }

    // 3. Also update slider images
    const { data: sliders } = await supa.from('slider_images').select('id, image_url');
    for (const slide of (sliders || [])) {
        if (!slide.image_url || !slide.image_url.includes('firebasestorage')) continue;
        
        try {
            console.log(`⬇  Downloading slider ${slide.id}...`);
            const buf = await downloadImage(slide.image_url);
            if (!buf || buf.length < 100) continue;

            const fileName = `slide_${slide.id}.png`;
            const { error } = await supa.storage.from('slider').upload(fileName, buf, {
                contentType: 'image/png',
                upsert: true
            });
            if (error) { console.log(`❌ Slider ${slide.id}: ${error.message}`); continue; }

            const { data: urlData } = supa.storage.from('slider').getPublicUrl(fileName);
            await supa.from('slider_images').update({ image_url: urlData.publicUrl }).eq('id', slide.id);
            console.log(`✅ Slider ${slide.id} uploaded`);
        } catch (e) {
            console.log(`❌ Slider ${slide.id}: ${e.message}`);
        }
    }

    console.log('\n🏁 Done!');
}

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 10000 }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadImage(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

main().catch(console.error);
