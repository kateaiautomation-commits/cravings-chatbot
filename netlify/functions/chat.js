const { randomUUID } = require("crypto");

const DEFAULT_MODEL = "gemini-3.5-flash";
const MAX_QUESTION_LENGTH = 8000;
const MAX_BODY_LENGTH = 10000;
const MAX_KNOWLEDGE_BASE_LENGTH = 50000;
const REQUEST_TIMEOUT_MS = 30000;

const DEFAULT_CRAVINGS_KNOWLEDGE_BASE = `
CRAVINGS TO GO KNOWLEDGE BASE

BUSINESS INFORMATION

* Cravings To Go delivers within the Municipality of Mabini area only.
* Delivery fee depends on distance. Customers should provide their location to check the delivery charge.
* No minimum order required.
* At least 2 days advance order is required for party trays.
* No cancellation once an order is placed.
* No refund once an order is confirmed.

PAYMENT METHODS

* GCash
* Metrobank Bank Transfer
* Cash on Delivery (COD)

ORDERING PROCESS

To place an order, customers should send:

* Order details
* Delivery date
* Complete delivery address
* Contact number

PARTY TRAYS

* Small tray serves up to 10 pax.
* Big tray serves up to 20 pax.

CHICKEN WINGS

* Small tray: 26 pieces
* Big tray: 54 pieces

CORDON BLEU

* Small tray: 40 pieces
* Big tray: 85 pieces

SHANGHAI

* Small tray: 60 pieces
* Big tray: 135 pieces

DELIVERY FAQ

Q: Do you deliver?
A: Yes. Kindly send your location so we can check the delivery charge.

Q: Saan kayo nagde-deliver?
A: Within Municipality of Mabini area only.

Q: Magkano ang delivery fee?
A: Delivery fee depends on distance. Please message us with your location.

PAYMENT FAQ

Q: What mode of payment do you accept?
A: Metrobank Bank Transfer, GCash, and Cash on Delivery.

Q: Pwede po ba COD?
A: Yes, Cash on Delivery is available.

BUSINESS HOURS

* Open Monday to Friday.
* Usually open during lunch time until supplies last.
* Closed every Saturday and Sunday.

AVAILABILITY

Q: Available po ba today?
A: Please message us to check today's available menu.

PROMOS

* Bulk order discounts may be available.
* Customers should message for special pricing on bulk orders.

IMPORTANT AI INSTRUCTIONS

* Answer ONLY using the information in this knowledge base.
* If the answer is not available in the knowledge base, politely tell the customer that the information is unavailable and ask them to message Cravings To Go directly.
* Do not invent prices, schedules, locations, menu items, or policies not found in the knowledge base.
* Always answer in a friendly Filipino tone.
`;

function getHeader(headers, name) {
  if (!headers) return "";
  const lowerName = name.toLowerCase();
  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === lowerName);
  return matchingKey ? headers[matchingKey] : "";
}

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(event) {
  const allowedOrigins = getAllowedOrigins();
  const origin = getHeader(event.headers, "origin");

  if (allowedOrigins.length === 0) return true;
  if (!origin) return true;

  return allowedOrigins.includes(origin);
}

function getCorsHeaders(event) {
  const allowedOrigins = getAllowedOrigins();
  const origin = getHeader(event.headers, "origin");
  const allowAnyOrigin = allowedOrigins.length === 0;
  const allowedOrigin = allowAnyOrigin
    ? origin || "*"
    : allowedOrigins.includes(origin)
      ? origin
      : "null";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(statusCode, body, headers) {
  return {
    statusCode,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
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

  if (rawBody.length > MAX_BODY_LENGTH) {
    const error = new Error("Request body is too large");
    error.statusCode = 413;
    throw error;
  }

  return JSON.parse(rawBody);
}

function readApiKey() {
  const googleApiKey = (process.env.GOOGLE_API_KEY || "").trim();
  if (googleApiKey) {
    return { apiKey: googleApiKey, apiKeySource: "GOOGLE_API_KEY" };
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (geminiApiKey) {
    return { apiKey: geminiApiKey, apiKeySource: "GEMINI_API_KEY" };
  }

  return { apiKey: "", apiKeySource: null };
}

function readKnowledgeBase() {
  const cravingsKnowledgeBase = (process.env.CRAVINGS_KNOWLEDGE_BASE || "").trim();
  if (cravingsKnowledgeBase) {
    return {
      knowledgeBase: cravingsKnowledgeBase,
      knowledgeBaseSource: "CRAVINGS_KNOWLEDGE_BASE",
    };
  }

  const genericKnowledgeBase = (process.env.KNOWLEDGE_BASE || "").trim();
  if (genericKnowledgeBase) {
    return {
      knowledgeBase: genericKnowledgeBase,
      knowledgeBaseSource: "KNOWLEDGE_BASE",
    };
  }

  return {
    knowledgeBase: DEFAULT_CRAVINGS_KNOWLEDGE_BASE.trim(),
    knowledgeBaseSource: "DEFAULT_CRAVINGS_KNOWLEDGE_BASE",
  };
}

function normalizeModelName(model) {
  return model.trim().replace(/^models\//, "");
}

function buildGeminiEndpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function buildPrompt(question, knowledgeBase) {
  return `
You are the Cravings To Go FAQ Assistant.

Answer ONLY using the knowledge base below.

If the answer is not present in the knowledge base:
- Do not guess.
- Do not use general knowledge.
- Politely tell the customer the information is unavailable and ask them to contact Cravings To Go directly.

Tone and style:
- Use a friendly Filipino tone.
- Answer naturally in Filipino or Taglish when the customer asks in Filipino or Taglish.
- Keep answers short, clear, and helpful.
- Do not say you are Gemini, a generic AI assistant, or unable to deliver physical items.

Knowledge Base:
${knowledgeBase}

Customer Question:
${question}
`.trim();
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getPublicErrorForStatus(status) {
  if (status === 400) return "The AI request was invalid.";
  if (status === 401 || status === 403) return "The AI service is not authorized.";
  if (status === 429) return "The AI service is busy. Please try again later.";
  return "The AI service could not answer right now.";
}

exports.handler = async function handler(event, context) {
  const startedAt = Date.now();
  const requestId = context?.awsRequestId || randomUUID();
  const corsHeaders = getCorsHeaders(event);
  const method = event.httpMethod || "";
  const origin = getHeader(event.headers, "origin") || null;

  console.log("[cravings-chat]", {
    requestId,
    phase: "start",
    method,
    origin,
    path: event.path || null,
  });

  if (method === "OPTIONS") {
    console.log("[cravings-chat]", { requestId, phase: "cors-preflight" });
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: "",
    };
  }

  if (!isOriginAllowed(event)) {
    console.warn("[cravings-chat]", {
      requestId,
      phase: "cors-origin-blocked",
      origin,
    });
    return jsonResponse(403, { error: "Origin not allowed" }, corsHeaders);
  }

  if (method !== "POST") {
    console.warn("[cravings-chat]", {
      requestId,
      phase: "method-not-allowed",
      method,
    });
    return jsonResponse(405, { error: "Method not allowed" }, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }

  const { apiKey, apiKeySource } = readApiKey();
  const model = normalizeModelName(process.env.GEMINI_MODEL || DEFAULT_MODEL);
  const { knowledgeBase, knowledgeBaseSource } = readKnowledgeBase();
  const hasKnowledgeBase = Boolean(knowledgeBase);
  const knowledgeBaseLength = knowledgeBase.length;

  console.log("[cravings-chat]", {
    requestId,
    phase: "config",
    hasApiKey: Boolean(apiKey),
    apiKeySource,
    model,
    hasKnowledgeBase,
    knowledgeBaseLength,
    knowledgeBaseSource,
    nodeVersion: process.version,
    hasFetch: typeof fetch === "function",
  });

  if (!apiKey) {
    console.error("[cravings-chat]", {
      requestId,
      phase: "missing-api-key",
    });
    return jsonResponse(500, { error: "Server configuration error" }, corsHeaders);
  }

  if (typeof fetch !== "function") {
    console.error("[cravings-chat]", {
      requestId,
      phase: "missing-fetch",
      nodeVersion: process.version,
    });
    return jsonResponse(500, { error: "Server runtime does not support fetch" }, corsHeaders);
  }

  if (!hasKnowledgeBase) {
    console.error("[cravings-chat]", {
      requestId,
      phase: "missing-knowledge-base",
    });
    return jsonResponse(500, { error: "Server configuration error" }, corsHeaders);
  }

  if (knowledgeBaseLength > MAX_KNOWLEDGE_BASE_LENGTH) {
    console.error("[cravings-chat]", {
      requestId,
      phase: "knowledge-base-too-long",
      knowledgeBaseLength,
      maxKnowledgeBaseLength: MAX_KNOWLEDGE_BASE_LENGTH,
    });
    return jsonResponse(500, { error: "Server configuration error" }, corsHeaders);
  }

  let question = "";

  try {
    const body = parseBody(event);
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch (error) {
    const statusCode = error.statusCode || 400;
    console.warn("[cravings-chat]", {
      requestId,
      phase: "invalid-request-body",
      message: error.message,
      statusCode,
    });
    return jsonResponse(statusCode, { error: error.message || "Invalid request body" }, corsHeaders);
  }

  if (!question) {
    console.warn("[cravings-chat]", {
      requestId,
      phase: "missing-question",
    });
    return jsonResponse(400, { error: "question is required" }, corsHeaders);
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    console.warn("[cravings-chat]", {
      requestId,
      phase: "question-too-long",
      questionLength: question.length,
      maxQuestionLength: MAX_QUESTION_LENGTH,
    });
    return jsonResponse(413, { error: "question is too long" }, corsHeaders);
  }

  const prompt = buildPrompt(question, knowledgeBase);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 512,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const endpoint = buildGeminiEndpoint(model);

    console.log("[cravings-chat]", {
      requestId,
      phase: "gemini-request",
      model,
      questionLength: question.length,
      promptLength: prompt.length,
      sendsPromptToGemini: true,
      sendsRawQuestionToGemini: false,
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

    console.log("[cravings-chat]", {
      requestId,
      phase: "gemini-response",
      status: response.status,
      ok: response.ok,
      finishReason: data?.candidates?.[0]?.finishReason || null,
      promptTokenCount: data?.usageMetadata?.promptTokenCount || null,
      candidatesTokenCount: data?.usageMetadata?.candidatesTokenCount || null,
      totalTokenCount: data?.usageMetadata?.totalTokenCount || null,
    });

    if (!response.ok) {
      console.error("[cravings-chat]", {
        requestId,
        phase: "gemini-error",
        status: response.status,
        statusText: response.statusText,
        geminiErrorMessage: data?.error?.message || null,
        geminiErrorStatus: data?.error?.status || null,
      });

      return jsonResponse(
        response.status >= 500 ? 502 : response.status,
        {
          error: getPublicErrorForStatus(response.status),
          status: response.status,
        },
        corsHeaders
      );
    }

    const answer = extractGeminiText(data);

    if (!answer) {
      console.warn("[cravings-chat]", {
        requestId,
        phase: "empty-answer",
        finishReason: data?.candidates?.[0]?.finishReason || null,
      });
      return jsonResponse(502, {
        error: "The AI service returned no answer.",
      }, corsHeaders);
    }

    return jsonResponse(200, { answer }, corsHeaders);
  } catch (error) {
    const isTimeout = error.name === "AbortError";

    console.error("[cravings-chat]", {
      requestId,
      phase: isTimeout ? "timeout" : "unhandled-error",
      name: error.name,
      message: error.message,
      stack: error.stack,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(isTimeout ? 504 : 500, {
      error: isTimeout
        ? "The AI service timed out. Please try again."
        : "Internal server error",
    }, corsHeaders);
  } finally {
    clearTimeout(timeout);
    console.log("[cravings-chat]", {
      requestId,
      phase: "end",
      durationMs: Date.now() - startedAt,
    });
  }
};
