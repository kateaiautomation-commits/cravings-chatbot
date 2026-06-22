const { randomUUID } = require("crypto");

const DEFAULT_MODEL = "gemini-3.5-flash";
const MAX_QUESTION_LENGTH = 8000;
const REQUEST_TIMEOUT_MS = 30000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function getCorsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const allowAnyOrigin = allowedOrigins.length === 0;
  const allowedOrigin = allowAnyOrigin || allowedOrigins.includes(origin)
    ? origin || "*"
    : allowedOrigins[0] || "null";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonResponse(statusCode, body, headers) {
  return {
    statusCode,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  return JSON.parse(rawBody);
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

exports.handler = async function handler(event, context) {
  const startedAt = Date.now();
  const requestId = context?.awsRequestId || randomUUID();
  const corsHeaders = getCorsHeaders(event);

  console.log("[gemini]", {
    requestId,
    phase: "start",
    method: event.httpMethod,
    origin: event.headers?.origin || event.headers?.Origin || null,
    path: event.path,
  });

  if (event.httpMethod === "OPTIONS") {
    console.log("[gemini]", { requestId, phase: "cors-preflight" });
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    console.warn("[gemini]", { requestId, phase: "method-not-allowed" });
    return jsonResponse(405, { error: "Method not allowed" }, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }

  const apiKeySource = process.env.GOOGLE_API_KEY
    ? "GOOGLE_API_KEY"
    : process.env.GEMINI_API_KEY
      ? "GEMINI_API_KEY"
      : null;
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

  console.log("[gemini]", {
    requestId,
    phase: "config",
    hasApiKey: Boolean(apiKey),
    apiKeySource,
    model,
    nodeVersion: process.version,
    hasFetch: typeof fetch === "function",
  });

  if (!apiKey) {
    console.error("[gemini]", { requestId, phase: "missing-api-key" });
    return jsonResponse(500, { error: "Server configuration error" }, corsHeaders);
  }

  if (typeof fetch !== "function") {
    console.error("[gemini]", { requestId, phase: "missing-fetch", nodeVersion: process.version });
    return jsonResponse(500, { error: "Server runtime does not support fetch" }, corsHeaders);
  }

  let question;

  try {
    const body = parseBody(event);
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch (error) {
    console.warn("[gemini]", { requestId, phase: "invalid-json", message: error.message });
    return jsonResponse(400, { error: "Request body must be valid JSON" }, corsHeaders);
  }

  if (!question) {
    console.warn("[gemini]", { requestId, phase: "missing-question" });
    return jsonResponse(400, { error: "question is required" }, corsHeaders);
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    console.warn("[gemini]", {
      requestId,
      phase: "question-too-long",
      length: question.length,
      max: MAX_QUESTION_LENGTH,
    });
    return jsonResponse(413, { error: "question is too long" }, corsHeaders);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: question }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    };

    console.log("[gemini]", {
      requestId,
      phase: "gemini-request",
      model,
      questionLength: question.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data;

    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = { raw: responseText };
    }

    console.log("[gemini]", {
      requestId,
      phase: "gemini-response",
      status: response.status,
      ok: response.ok,
      finishReason: data?.candidates?.[0]?.finishReason || null,
      promptTokenCount: data?.usageMetadata?.promptTokenCount || null,
      candidatesTokenCount: data?.usageMetadata?.candidatesTokenCount || null,
    });

    if (!response.ok) {
      console.error("[gemini]", {
        requestId,
        phase: "gemini-error",
        status: response.status,
        statusText: response.statusText,
        geminiError: data?.error?.message || data,
      });

      return jsonResponse(response.status, {
        error: "Gemini API request failed",
        status: response.status,
      }, corsHeaders);
    }

    const answer = extractGeminiText(data);

    if (!answer) {
      console.warn("[gemini]", {
        requestId,
        phase: "empty-answer",
        finishReason: data?.candidates?.[0]?.finishReason || null,
      });
      return jsonResponse(502, { error: "Gemini returned no text" }, corsHeaders);
    }

    return jsonResponse(200, { answer }, corsHeaders);
  } catch (error) {
    const isTimeout = error.name === "AbortError";

    console.error("[gemini]", {
      requestId,
      phase: isTimeout ? "timeout" : "unhandled-error",
      name: error.name,
      message: error.message,
      stack: error.stack,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(isTimeout ? 504 : 500, {
      error: isTimeout ? "Gemini API request timed out" : "Internal server error",
    }, corsHeaders);
  } finally {
    clearTimeout(timeout);
    console.log("[gemini]", {
      requestId,
      phase: "end",
      durationMs: Date.now() - startedAt,
    });
  }
};
