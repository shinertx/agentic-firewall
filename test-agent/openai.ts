import OpenAI from 'openai';

// Route through the Agentic Firewall via the secure HTTPS endpoint
const openai = new OpenAI({
    apiKey: 'dummy_key', // You don't even need a real key to see the proxy catch it!
    baseURL: 'https://api.jockeyvc.com/v1',
});

async function run() {
    console.log('Sending massive codebase dump (600k characters) to OpenAI...');
    console.log('Routing through Agentic Firewall at https://api.jockeyvc.com\n');

    try {
        const msg = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a senior engineer. Here is my 600k character codebase: ' + 'A'.repeat(600000) },
                { role: 'user', content: 'What does this code do?' }
            ]
        });
        console.log(msg);
    } catch (error: any) {
        if (error.status === 401 || error.status === 400 || error.message.includes('401')) {
            console.log('✅ Request successfully reached OpenAI through the proxy (failed Auth because we used a dummy key).');
            console.log('👉 Check your dashboard to see the Context CDN Savings!');
        } else {
            console.error('Error:', error);
        }
    }
}

run();
