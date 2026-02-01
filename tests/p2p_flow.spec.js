const { test, expect } = require('@playwright/test');

test('Supersonic P2P Flow: Upload (Sender) & Download (Receiver)', async ({ browser }) => {
    // Use a longer timeout for P2P connection (it can take time to negotiate)
    test.setTimeout(60000);

    // --- USER A (SENDER) ---
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // 1. Go to App
    // Note: In GitHub Actions, this will be 'http://localhost:3000' or similar
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    await pageA.goto(baseUrl);

    // 2. Upload File
    // We'll create a dummy buffer to upload
    await pageA.setInputFiles('#fileInput', {
        name: 'supersonic_test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('This is a 100% verified Supersonic Transfer!')
    });

    // 3. Set PIN and Settings
    await pageA.fill('#uploadPin', '1234');
    // Optional: Set expiry to 1 hour (default is usually fine)

    // 4. Click Upload
    await pageA.click('#startUploadBtn');

    // 5. Wait for "Done!" or Link
    // The UI shows "File Ready!" in #shareResultArea or "Done!" in status text
    await expect(pageA.locator('#uploadStatusText')).toHaveText('Done!', { timeout: 15000 });
    await pageA.waitForSelector('#shareResultArea:not(.hidden)');

    // 6. Get Link
    const shareLink = await pageA.inputValue('#shareLinkInput');
    console.log('Sender generated link:', shareLink);
    expect(shareLink).toContain('?id=');

    // --- USER B (RECEIVER) ---
    // Completely separate context (like a new machine)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // 1. Go to Link
    await pageB.goto(shareLink);

    // 2. Enter PIN
    await pageB.fill('#downloadPin', '1234');

    // 3. Click Download & Handle File
    // Setup download listener BEFORE clicking
    const downloadPromise = pageB.waitForEvent('download');

    await pageB.click('#startDownloadBtn');

    const download = await downloadPromise;

    // 4. Verification
    // Wait for the download to complete
    const stream = await download.createReadStream();
    // Simple buffer read
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const content = buffer.toString('utf-8');

    console.log('Receiver downloaded content:', content);

    // THE GOLDEN CHECK
    expect(content).toBe('This is a 100% verified Supersonic Transfer!');

    await contextA.close();
    await contextB.close();
});

test('Supersonic P2P: Wrong PIN Handling', async ({ browser }) => {
    // SENDER
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto('http://localhost:5000'); // Assume base url from config

    // Upload File
    await pageA.setInputFiles('#fileInput', {
        name: 'secret.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Secret Data')
    });
    await pageA.fill('#uploadPin', '5555');
    await pageA.click('#startUploadBtn');
    await expect(pageA.locator('#uploadStatusText')).toHaveText('Done!', { timeout: 15000 });
    const shareLink = await pageA.inputValue('#shareLinkInput');

    // RECEIVER (Attacker)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(shareLink);

    // Wrong PIN
    await pageB.fill('#downloadPin', '0000');

    // Listen for dialog (alert)
    pageB.on('dialog', async dialog => {
        expect(dialog.message()).toContain('Incorrect PIN');
        await dialog.dismiss();
    });

    await pageB.click('#startDownloadBtn');

    // Verify Error UI
    await expect(pageB.locator('#downloadStatusText')).toContainText('Error');

    await contextA.close();
    await contextB.close();
});
