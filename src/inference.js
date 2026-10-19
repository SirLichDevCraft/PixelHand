"use strict";
const { setTimeout: delay } = require("timers/promises");
const { randomUUID } = require("crypto");

function validateConfig(config) {
  if (!["ollama", "chat-completions"].includes(config.provider))
    throw new Error("provider must be ollama or chat-completions");
  if (typeof config.model !== "string" || !config.model.trim())
    throw new Error("Set an explicit model name");
  const url = new URL(config.base_url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "base_url must be an HTTP(S) endpoint without embedded credentials, query or fragment",
    );
  if (
    config.local_only &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("local_only requires a loopback endpoint");
  if (config.api_key !== undefined)
    throw new Error(
      "Use api_key_env; credentials must not be stored in configuration files",
    );
  for (const flag of ["vision", "local_only", "tools"])
    if (config[flag] !== undefined && typeof config[flag] !== "boolean")
      throw new Error(`${flag} must be boolean`);
  if (
    config.quality_effort !== undefined &&
    !["low", "medium", "high"].includes(config.quality_effort)
  )
    throw new Error("quality_effort must be low, medium or high");
  if (config.tools === false)
    throw new Error(
      "The agent runner requires a model that supports tool calls",
    );
  if (
    config.billing &&
    ![
      config.billing.input_per_million,
      config.billing.output_per_million,
    ].every((n) => Number.isFinite(n) && n >= 0)
  )
    throw new Error(
      "Billing rates must be nonnegative numbers per million tokens",
    );
  if (config.api_key_env && !process.env[config.api_key_env])
    throw new Error(`Environment variable ${config.api_key_env} is not set`);
  for (const [key, value] of Object.entries({
    timeout_ms: config.timeout_ms ?? 60000,
    max_output_tokens: config.max_output_tokens ?? 2048,
  })) {
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > (key === "timeout_ms" ? 300000 : 65536)
    )
      throw new Error(`Invalid ${key}`);
  }
  return {
    ...config,
    base_url: url.toString().replace(/\/$/, ""),
    timeout_ms: config.timeout_ms ?? 60000,
    max_output_tokens: config.max_output_tokens ?? 2048,
    quality_effort: config.quality_effort ?? "medium",
  };
}
function createProvider(input) {
  const config = validateConfig(input);
  async function request(route, body, signal) {
    const headers = { "Content-Type": "application/json" };
    if (config.api_key_env)
      headers.Authorization = `Bearer ${process.env[config.api_key_env]}`;
    const endpoint = config.base_url + route;
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(config.timeout_ms);
      const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
      const response = await fetch(endpoint, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: combined,
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (
          [429, 500, 502, 503, 504].includes(response.status) &&
          attempt < 2
        ) {
          await delay(250 * 2 ** attempt, undefined, { signal });
          continue;
        }
        // Provider bodies may contain secrets or echoed prompts; do not include them in logs.
        throw new Error(`Inference endpoint returned HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Inference response exceeds 16 MiB");
        }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
  }
  function encodeMessages(messages) {
    return messages.map((m) => {
      if (config.provider !== "ollama") {
        const { tool_name, ...standard } = m;
        return standard;
      }
      const result = {
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : m.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n"),
      };
      if (Array.isArray(m.content))
        result.images = m.content
          .filter((c) => c.type === "image_url")
          .map((c) => c.image_url.url.split(",")[1]);
      if (m.tool_calls)
        result.tool_calls = m.tool_calls.map((c) => ({
          function: {
            name: c.function.name,
            arguments:
              typeof c.function.arguments === "string"
                ? JSON.parse(c.function.arguments)
                : c.function.arguments,
          },
        }));
      if (m.tool_name) result.tool_name = m.tool_name;
      return result;
    });
  }
  return {
    config,
    async probe(signal) {
      const data = await request(
        config.provider === "ollama" ? "/api/tags" : "/models",
        undefined,
        signal,
      );
      const models = (data.models || data.data || []).map(
        (m) => m.name || m.id,
      );
      const available =
        models.includes(config.model) ||
        models.includes(config.model + ":latest");
      return {
        available,
        models,
        model: config.model,
        capabilities: {
          vision: config.vision === true,
          tools: config.tools !== false,
        },
        capability_source:
          "configuration; run evaluation to verify model behavior",
      };
    },
    async chat(messages, tools, signal) {
      const definitions = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
      const body = {
        model: config.model,
        messages: encodeMessages(messages),
        stream: false,
        tools: definitions,
      };
      if (config.provider === "ollama")
        body.options = {
          num_predict: config.max_output_tokens,
          temperature: config.temperature ?? 0.2,
        };
      else {
        body.max_tokens = config.max_output_tokens;
        if (config.temperature !== undefined)
          body.temperature = config.temperature;
      }
      const result = await request(
        config.provider === "ollama" ? "/api/chat" : "/chat/completions",
        body,
        signal,
      );
      const message =
        config.provider === "ollama"
          ? result.message
          : result.choices?.[0]?.message;
      if (!message || message.role !== "assistant")
        throw new Error("Inference endpoint returned no assistant message");
      const tool_calls = (message.tool_calls || []).map((call) => ({
        id: call.id || `call_${randomUUID()}`,
        type: "function",
        function: {
          name: call.function?.name,
          arguments:
            typeof call.function?.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function?.arguments || {}),
        },
      }));
      const prompt =
        result.usage?.prompt_tokens ?? result.prompt_eval_count ?? null;
      const completion =
        result.usage?.completion_tokens ?? result.eval_count ?? null;
      return {
        message: {
          role: "assistant",
          content: message.content || "",
          ...(tool_calls.length ? { tool_calls } : {}),
        },
        usage: { prompt_tokens: prompt, completion_tokens: completion },
        finish_reason:
          result.choices?.[0]?.finish_reason ?? result.done_reason ?? null,
      };
    },
  };
}
module.exports = { createProvider, validateConfig };
