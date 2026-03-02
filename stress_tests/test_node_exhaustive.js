const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

async function runTests() {
    console.log("=== Node.js SDK Proxy Stress Test ===\n");

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: 'https://api.jockeyvc.com/v1'
    });

    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: 'https://api.jockeyvc.com'
    });

    // 1. OpenAI Small Request (Proof of routing)
    try {
        console.log("Running OpenAI GPT-4o-mini request...");
        const openaiRes = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say hello world from OpenAI via Node.js SDK over proxy." }]
        });
        console.log(`OpenAI Response: ${openaiRes.choices[0].message.content}\n`);
    } catch (e) {
        console.error("OpenAI Error:", e.message);
    }

    // 2. Anthropic Small Request (Proof of routing)
    try {
        console.log("Running Anthropic Claude Sonnet 4.6 request...");
        const anthropicRes = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 100,
            messages: [{ role: "user", content: "Say hello world from Anthropic via Node.js SDK over proxy." }]
        });
        console.log(`Anthropic Response: ${anthropicRes.content[0].text}\n`);
    } catch (e) {
        console.error("Anthropic Error:", e.message);
    }

    // 3. OpenAI Massive RAG Simulation (Trigger Context CDN math)
    try {
        console.log("Running OpenAI GPT-4o massive context injection...");
        const longText = "This is a massive payload to test Context CDN optimization over standard SDK connections. ".repeat(60000);
        const openaiHugeRes = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: longText + " Summarize this." }]
        });
        console.log(`OpenAI Massive Response Received (${openaiHugeRes.usage.total_tokens} tokens processed).\n`);
    } catch (e) {
        console.error("OpenAI Massive Error:", e.message);
    }

    // 4. Anthropic Massive RAG Simulation (Trigger Context CDN block header injection)
    try {
        console.log("Running Anthropic massive context injection...");
        const longText = "This is a huge anthropic payload looking for a cache control header block. ".repeat(60000);
        const anthropicHugeRes = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 100,
            system: longText,
            messages: [{ role: "user", content: "Summarize this system message." }]
        });
        console.log(`Anthropic Massive Response Received.\n`);
    } catch (e) {
        console.error("Anthropic Massive Error:", e.message);
    }

    console.log("=== Node.js Testing Complete ===");
}

runTests();
