import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Replace with your GCP server IP if testing remotely, or leave locally
const PROXY_URL = 'http://34.55.255.155:4000';

const openai = new OpenAI({ apiKey: 'dummy', baseURL: `${PROXY_URL}/v1` });
const anthropic = new Anthropic({ apiKey: 'dummy', baseURL: PROXY_URL });

const MASSIVE_PROMPT = 'A'.repeat(500000); // 500k characters to trigger CDN

async function simulateAgentLoop(agentId: string, provider: 'openai' | 'anthropic', iterations: number) {
    console.log(`[Agent ${agentId}] 🚀 Starting ${provider} loop for ${iterations} iterations...`);

    for (let i = 1; i <= iterations; i++) {
        try {
            console.log(`[Agent ${agentId}] ⏳ Sending Request ${i}/${iterations}...`);

            if (provider === 'openai') {
                await openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: `You are Agent ${agentId}. Codebase: ${MASSIVE_PROMPT}` },
                        { role: 'user', content: 'List the files.' }
                    ]
                });
            } else {
                await anthropic.messages.create({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 100,
                    system: `You are Agent ${agentId}. Codebase: ${MASSIVE_PROMPT}`,
                    messages: [{ role: 'user', content: 'List the files.' }]
                });
            }
        } catch (error: any) {
            if (error.status === 400 && error.error?.type === 'agentic_firewall_blocked') {
                console.log(`\n🛑 [Agent ${agentId}] FIREWALL TRIPPED! Infinite loop blocked on request ${i}!`);
                console.log(`🛑 Reason: ${error.error.message}\n`);
                break; // The firewall stopped the agent, end the simulation
            } else if (error.status === 401) {
                console.log(`[Agent ${agentId}] ✅ Request ${i} successfully processed by proxy Context CDN (Auth failed at destination).`);
            } else {
                console.log(`[Agent ${agentId}] Error: ${error.message}`);
            }
        }

        // Wait 1 second between agent loops
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function runStressTest() {
    console.log('🔥 STARTING AGENTIC FIREWALL STRESS TEST 🔥\n');
    console.log(`🎯 Target: ${PROXY_URL}`);
    console.log('📊 Open your dashboard at http://34.55.255.155:5173 to watch the savings explode!\n');

    // Simulate 3 different agents going rogue at the exact same time
    await Promise.all([
        simulateAgentLoop('Alpha', 'openai', 5),    // Will get cut off by circuit breaker at request 4
        simulateAgentLoop('Bravo', 'anthropic', 5), // Will get cut off by circuit breaker at request 4
        simulateAgentLoop('Charlie', 'openai', 2)   // Normal agent, does not trigger circuit breaker
    ]);

    console.log('\n✨ STRESS TEST COMPLETE ✨');
    console.log('Check your dashboard to see total money saved and loops blocked!');
}

runStressTest();
