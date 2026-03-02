import os
from openai import OpenAI
from anthropic import Anthropic

print("=== Python SDK Proxy Stress Test ===\n")

openai_client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY"),
    base_url="https://api.jockeyvc.com/v1"
)

anthropic_client = Anthropic(
    api_key=os.environ.get("ANTHROPIC_API_KEY"),
    base_url="https://api.jockeyvc.com"
)

# 1. OpenAI Small Request (Proof of routing)
try:
    print("Running OpenAI GPT-4o-mini request...")
    res = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say hello world from OpenAI via Python SDK over proxy."}]
    )
    print(f"OpenAI Response: {res.choices[0].message.content}\n")
except Exception as e:
    print(f"OpenAI Error: {e}")

# 2. Anthropic Small Request (Proof of routing)
try:
    print("Running Anthropic Claude Sonnet 4.6 request...")
    res = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=100,
        messages=[{"role": "user", "content": "Say hello world from Anthropic via Python SDK over proxy."}]
    )
    print(f"Anthropic Response: {res.content[0].text}\n")
except Exception as e:
    print(f"Anthropic Error: {e}")

# 3. OpenAI Massive RAG Simulation (Trigger Context CDN math)
try:
    print("Running OpenAI GPT-4o massive context injection...")
    long_text = "This is a massive payload to test Context CDN optimization over standard Python connections. " * 60000
    res = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": long_text + " Summarize this."}]
    )
    print(f"OpenAI Massive Response Received ({res.usage.total_tokens} tokens processed).\n")
except Exception as e:
    print(f"OpenAI Massive Error: {e}")

# 4. Anthropic Massive RAG Simulation (Trigger Context CDN block header injection)
try:
    print("Running Anthropic massive context injection...")
    long_text = "This is a huge anthropic payload looking for a cache control header block. " * 60000
    res = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=100,
        system=long_text,
        messages=[{"role": "user", "content": "Summarize this system message."}]
    )
    print("Anthropic Massive Response Received.\n")
except Exception as e:
    print(f"Anthropic Massive Error: {e}")

print("=== Python Testing Complete ===")
