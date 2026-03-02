import Anthropic from '@anthropic-ai/sdk';

// We override the default URL to point to our Agentic Firewall Proxy
const anthropic = new Anthropic({
    apiKey: 'dummy_key', // You don't even need a real key to see the proxy catch it!
    baseURL: 'http://34.55.255.155:4000',
});

async function run() {
    console.log('Sending massive codebase dump (600k characters) to Claude...');
    console.log('Routing through GCP Agentic Firewall Proxy at http://34.55.255.155:4000\n');

    try {
        const msg = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20240620',
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
            console.log('👉 Check your dashboard at http://localhost:5173 to see the Context CDN Savings!');
        } else {
            console.error('Error:', error);
        }
    }
}

run();
