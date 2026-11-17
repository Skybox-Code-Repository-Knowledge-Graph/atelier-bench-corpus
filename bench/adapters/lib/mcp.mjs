// A minimal MCP client over stdio: newline-delimited JSON-RPC 2.0. Node built-ins only.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class McpStdioClient {
    /** Spawn `command args` with `env` and complete the MCP handshake. */
    static async start(command, args, { env = process.env, clientName = "atelier-bench-adapter", timeoutMs = 60000 } = {}) {
        const client = new McpStdioClient(command, args, env, timeoutMs);
        await client.request("initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: clientName, version: "1" },
        });
        client.notify("notifications/initialized", {});
        return client;
    }

    constructor(command, args, env, timeoutMs) {
        this.timeoutMs = timeoutMs;
        this.pending = new Map();
        this.nextId = 1;
        this.stderr = "";
        this.exited = null;

        this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
        this.child.stderr.on("data", (chunk) => {
            this.stderr = (this.stderr + chunk).slice(-4000);
        });
        this.child.on("exit", (code, signal) => {
            this.exited = { code, signal };
            for (const { reject } of this.pending.values()) {
                reject(new Error(`server exited (code ${code}, signal ${signal}): ${this.stderr.slice(-400)}`));
            }
            this.pending.clear();
        });
        createInterface({ input: this.child.stdout }).on("line", (line) => this.#receive(line));
    }

    #receive(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            return;
        }
        if (message.id === undefined || !this.pending.has(message.id)) {
            return;
        }
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) {
            reject(new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`));
        } else {
            resolve(message.result);
        }
    }

    request(method, params) {
        if (this.exited) {
            return Promise.reject(new Error(`server already exited (code ${this.exited.code})`));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timed out after ${this.timeoutMs} ms: ${method}`));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        });
    }

    notify(method, params) {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    }

    /** Call a tool and return its text content joined, or throw when the call reports an error. */
    async callTool(name, args) {
        const result = await this.request("tools/call", { name, arguments: args });
        const text = (result?.content ?? []).map((part) => (typeof part.text === "string" ? part.text : "")).join("\n");
        if (result?.isError) {
            throw new Error(`tool ${name} reported an error: ${text.slice(0, 300)}`);
        }
        return text;
    }

    close() {
        if (!this.exited) {
            this.child.stdin.end();
            this.child.kill();
        }
    }
}
