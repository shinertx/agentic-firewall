import Anthropic from '@anthropic-ai/sdk';

const proxyUrl = (process.env.FIREWALL_BASE_URL || process.env.VIBE_BILLING_PROXY_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');

// Route through the Agentic Firewall via a configurable endpoint
const anthropic = new Anthropic({
    apiKey: 'dummy_key', // You don't even need a real key to see the proxy catch it!
    baseURL: proxyUrl,
});

async function run() {
    console.log('Sending massive codebase dump (600k characters) to Claude...');
    console.log(`Routing through Agentic Firewall at ${proxyUrl}\n`);

    try {
        const msg = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: 'You are a senior engineer. Here is my 600k character codebase: ' + 'A'.repeat(600000),
            messages: [
                { role: 'user', content: 'What does this code do?' }
            ]
        });
        console.log(msg);
    } catch (error: any) {
        if (error.status === 401 || error.status === 400) {
            console.log('✅ Request successfully reached Anthropic through the proxy (failed Auth because we used a dummy key).');
            console.log('👉 Check your dashboard to see the Context CDN Savings!');
        } else {
            console.error('Error:', error);
        }
    }
}

run();
