#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const server = new Server(
    {
        name: "Agentic Firewall MCP",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_firewall_status",
                description: "Fetch real-time stats from the local Agentic Firewall Proxy. Use this to determine if the agent is stuck in loops or wasting tokens.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_firewall_status") {
        try {
            const resp = await axios.get("http://localhost:4000/api/stats");
            const stats = resp.data;
            const text = `Agentic Firewall Status:
- Total Money Saved: $${stats.savedMoney.toFixed(2)}
- Tokens Cached: ${stats.savedTokens}
- Blocked Agent Loops: ${stats.blockedLoops}

Proxy is running and intercepting traffic to protect your wallet.`;

            return {
                content: [{ type: "text", text }],
            };
        } catch (e) {
            return {
                content: [{ type: "text", text: "Error connecting to Agentic Firewall proxy on port 4000." }],
                isError: true,
            };
        }
    }

    throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
