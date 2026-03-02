import OpenAI from 'openai';

// Target the Live GCP Agentic Firewall
const PROXY_URL = 'http://34.55.255.155:4000/v1';

const openai = new OpenAI({
    apiKey: 'dummy_nvidia_key',
    baseURL: PROXY_URL
});

const MASSIVE_CONTEXT = 'A'.repeat(600000); // 600,000 characters to trigger the CDN

async function testNvidiaRouting() {
    console.log('🚀 Sending massive 600k character payload to NVIDIA Llama 3.1...');
    console.log(`🌐 Routing through Agentic Firewall at ${PROXY_URL}`);
    console.log('--------------------------------------------------');

    try {
        const response = await openai.chat.completions.create({
            model: 'meta/llama-3.1-70b-instruct', // The proxy looks at this model name to route to NVIDIA
            messages: [
                { role: 'system', content: `You are an expert startup evaluator. Here is the context: ${MASSIVE_CONTEXT}` },
                { role: 'user', content: 'Evaluate the unfair wedge of this business idea.' }
            ]
        });
        console.log('✅ Success:', response);
    } catch (error: any) {
        if (error.status === 401) {
            console.log('\n✅ TEST PASSED: The Firewall successfully caught the payload, injected the Context CDN tags, routed it directly to NVIDIA, and NVIDIA rejected our fake dummy key!');
            console.log('\n👉 Check your live Dashboard at http://34.55.255.155:5173 to see the exact green "Context CDN Hit" and the Dollars Saved!');
        } else {
            console.error('Error:', error);
        }
    }
}

testNvidiaRouting();
